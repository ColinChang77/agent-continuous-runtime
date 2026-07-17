#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { createReadStream, existsSync, mkdirSync, realpathSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  accountEnvOverrides,
  acrConfigPath,
  loadAcrConfig,
  saveAcrConfig
} from "./config.js";
import type { AcrConfig } from "./config.js";

import type { AgentPlugin } from "@acr/core";
import { pluginApiVersion, runtimeVersion } from "@acr/core";
import { createClaudeCodeAdapter } from "@acr/adapter-claude-code";
import { createCodexAdapter } from "@acr/adapter-codex";
import { createFakeAgentAdapter } from "@acr/adapter-fake";
import { createGeminiAdapter } from "@acr/adapter-gemini";
import { createAcrMcpServer, ProjectService } from "@acr/mcp-server";
import {
  RuntimeLockedError,
  createAgentHealthStore,
  createRuntimeEventPipeline,
  acquireRuntimeLock,
  createRuntimeLauncher,
  createRuntimeSupervisor,
  readRuntimeState,
  readSwitchResult,
  writeSwitchRequest
} from "@acr/runtime";
import { createLocalStore, StateNotInitializedError } from "@acr/storage-local";

function resolveProjectRoot(input?: string): string {
  return path.resolve(input ?? process.cwd());
}

function getFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function getFlagValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === name && value) {
      values.push(value);
    }
  }
  return values;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function renderHelp(): string {
  return [
    "Agent Continuity Runtime",
    "",
    "Shortcut Commands:",
    "  acr-claude [path]",
    "  acr-codex [path]",
    "",
    "Commands:",
    "  acr setup",
    "  acr init [path]",
    "  acr status [path]",
    "  acr validate [path]",
    "  acr repair [path] [--safe]",
    '  acr checkpoint [path] --summary "..." --next "..."',
    "  acr resume [path]",
    "  acr start [path] [--agent <id>] [--fallback <id>...] [--init]",
    "  acr switch [path] [--to <id>]   (prompts with a menu if --to is omitted)",
    "  acr health reset [path] [--agent <id>]",
    "  acr adapters list",
    "  acr mcp serve --project /absolute/path",
    "  acr doctor [path] [--json]"
  ].join("\n");
}

type ShortcutMode = "claude-code" | "codex" | null;

export function shortcutModeFromArgv(argv = process.argv): ShortcutMode {
  const executable = path.basename(argv[1] ?? "");
  if (executable === "acr-claude") return "claude-code";
  if (executable === "acr-codex") return "codex";
  return null;
}

function isFlag(value: string | undefined): boolean {
  return Boolean(value?.startsWith("-"));
}

async function runShortcut(
  agentId: "claude-code" | "codex",
  argv: string[],
  store: ReturnType<typeof createLocalStore>
) {
  const pathArg = argv[2];
  const projectRoot = resolveProjectRoot(isFlag(pathArg) ? undefined : pathArg);
  // Run the agent and, when it ends, offer the one-window menu to switch
  // tools/accounts, restart, or quit — no second terminal, no commands.
  await runAgentLoop(projectRoot, agentId, store);
}

function builtinPlugins(config: AcrConfig = {}): AgentPlugin[] {
  return [
    {
      manifest: {
        pluginId: "builtin.fake-agent",
        displayName: "Fake Agent Plugin",
        version: runtimeVersion,
        acrApiVersion: pluginApiVersion,
        agentId: "fake-agent",
        agentDisplayName: "Fake Agent",
        declaredCapabilities: ["testing", "failover"],
        supportedTransports: ["pty", "stdio", "spawn"],
        executable: {
          command: process.execPath,
          args: ["--version"]
        }
      },
      source: "builtin",
      createAdapter: () => createFakeAgentAdapter()
    },
    {
      manifest: {
        pluginId: "builtin.claude-code",
        displayName: "Claude Code Plugin",
        version: runtimeVersion,
        acrApiVersion: pluginApiVersion,
        agentId: "claude-code",
        agentDisplayName: "Claude Code",
        declaredCapabilities: ["interactive", "coding", "real-cli"],
        supportedTransports: ["pty", "stdio", "spawn"],
        executable: {
          command: "claude",
          args: ["--version"]
        }
      },
      source: "builtin",
      createAdapter: () => createClaudeCodeAdapter()
    },
    {
      manifest: {
        pluginId: "builtin.claude-code-alt",
        displayName: "Claude Code (Alternate Account) Plugin",
        version: runtimeVersion,
        acrApiVersion: pluginApiVersion,
        agentId: "claude-code-alt",
        agentDisplayName: "Claude Code (Alt Account)",
        declaredCapabilities: ["interactive", "coding", "real-cli"],
        supportedTransports: ["pty", "stdio", "spawn"],
        executable: {
          command: "claude",
          args: ["--version"]
        }
      },
      source: "builtin",
      // Same `claude` binary, but launched against a different account. Account
      // settings come from `acr setup` (saved config) and can be overridden per
      // run with ACR_CLAUDE_ALT_HOME / _API_KEY / _BASE_URL. If neither is set
      // it behaves like the default account.
      createAdapter: () =>
        createClaudeCodeAdapter({
          id: "claude-code-alt",
          displayName: "Claude Code (Alt Account)",
          envOverrides: accountEnvOverrides(
            config.accounts?.["claude-code-alt"],
            process.env.ACR_CLAUDE_ALT_HOME,
            process.env.ACR_CLAUDE_ALT_API_KEY,
            process.env.ACR_CLAUDE_ALT_BASE_URL,
            "HOME",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_BASE_URL"
          )
        })
    },
    {
      manifest: {
        pluginId: "builtin.codex",
        displayName: "Codex Plugin",
        version: runtimeVersion,
        acrApiVersion: pluginApiVersion,
        agentId: "codex",
        agentDisplayName: "Codex",
        declaredCapabilities: ["interactive", "coding", "real-cli"],
        supportedTransports: ["pty", "stdio", "spawn"],
        executable: {
          command: "codex",
          args: ["--version"]
        }
      },
      source: "builtin",
      createAdapter: () => createCodexAdapter()
    },
    {
      manifest: {
        pluginId: "builtin.codex-alt",
        displayName: "Codex (Alternate Account) Plugin",
        version: runtimeVersion,
        acrApiVersion: pluginApiVersion,
        agentId: "codex-alt",
        agentDisplayName: "Codex (Alt Account)",
        declaredCapabilities: ["interactive", "coding", "real-cli"],
        supportedTransports: ["pty", "stdio", "spawn"],
        executable: {
          command: "codex",
          args: ["--version"]
        }
      },
      source: "builtin",
      // Same `codex` binary, but launched against a different account. Account
      // settings come from `acr setup` (saved config) and can be overridden per
      // run with ACR_CODEX_ALT_HOME / _API_KEY / _BASE_URL. If neither is set it
      // behaves like the default account.
      createAdapter: () =>
        createCodexAdapter({
          id: "codex-alt",
          displayName: "Codex (Alt Account)",
          envOverrides: accountEnvOverrides(
            config.accounts?.["codex-alt"],
            process.env.ACR_CODEX_ALT_HOME,
            process.env.ACR_CODEX_ALT_API_KEY,
            process.env.ACR_CODEX_ALT_BASE_URL,
            "CODEX_HOME",
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL"
          )
        })
    },
    {
      manifest: {
        pluginId: "builtin.gemini",
        displayName: "Gemini Plugin",
        version: runtimeVersion,
        acrApiVersion: pluginApiVersion,
        agentId: "gemini",
        agentDisplayName: "Gemini CLI",
        declaredCapabilities: ["interactive", "coding", "real-cli"],
        supportedTransports: ["pty", "stdio", "spawn"],
        executable: {
          command: "gemini",
          args: ["--version"]
        }
      },
      source: "builtin",
      createAdapter: () => createGeminiAdapter()
    }
  ];
}

function isSafePluginModuleId(moduleId: string): boolean {
  return !(
    moduleId.startsWith(".") ||
    moduleId.startsWith("/") ||
    moduleId.includes("\\") ||
    moduleId.includes("..")
  );
}

async function loadConfiguredPlugins(): Promise<AgentPlugin[]> {
  const config = loadAcrConfig();
  const configured = process.env.ACR_AGENT_PLUGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!configured || configured.length === 0) {
    return builtinPlugins(config);
  }

  const plugins = [...builtinPlugins(config)];
  for (const moduleId of configured) {
    if (!isSafePluginModuleId(moduleId)) {
      process.stderr.write(
        `Skipping unsafe plugin module identifier: ${moduleId}\n`
      );
      continue;
    }

    try {
      const loaded = (await importPluginModule(moduleId)) as {
        agentPlugin?: AgentPlugin;
        agentPlugins?: AgentPlugin[];
      };
      if (loaded.agentPlugins) {
        plugins.push(
          ...loaded.agentPlugins.map((plugin) => ({
            ...plugin,
            source: plugin.source ?? moduleId
          }))
        );
        continue;
      }
      if (loaded.agentPlugin) {
        plugins.push({
          ...loaded.agentPlugin,
          source: loaded.agentPlugin.source ?? moduleId
        });
        continue;
      }
      process.stderr.write(
        `Skipping plugin module ${moduleId}: expected agentPlugin or agentPlugins export.\n`
      );
    } catch (error) {
      process.stderr.write(
        `Skipping plugin module ${moduleId}: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }

  return plugins;
}

async function importPluginModule(moduleId: string) {
  try {
    return await import(moduleId);
  } catch {
    const workspaceResolved = await resolveWorkspacePluginModule(moduleId);
    if (!workspaceResolved) {
      throw new Error(`Module ${moduleId} could not be resolved.`);
    }
    return import(pathToFileURL(workspaceResolved).href);
  }
}

async function resolveWorkspacePluginModule(
  moduleId: string
): Promise<string | null> {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );
  const packagesRoot = path.join(root, "packages");
  const packageDirs = await readdir(packagesRoot, {
    withFileTypes: true
  }).catch(() => []);

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesRoot, entry.name);
    const packageJsonPath = path.join(packageDir, "package.json");
    try {
      const packageJson = JSON.parse(
        await readFile(packageJsonPath, "utf8")
      ) as { name?: string };
      if (packageJson.name !== moduleId) {
        continue;
      }

      const distEntry = path.join(packageDir, "dist", "index.js");
      if (existsSync(distEntry)) {
        return distEntry;
      }
      const srcEntry = path.join(packageDir, "src", "index.ts");
      if (existsSync(srcEntry)) {
        return srcEntry;
      }
      return null;
    } catch {
      continue;
    }
  }

  return null;
}

async function createCliLauncher(projectRoot?: string) {
  const eventPipeline = createRuntimeEventPipeline({
    maxEvents: 64,
    ...(projectRoot ? { projectRoot } : {}),
    persist: Boolean(projectRoot)
  });
  return createRuntimeLauncher({
    plugins: await loadConfiguredPlugins(),
    ...(projectRoot ? { projectRoot } : {}),
    eventPipeline
  });
}

async function ensureInitialized(
  projectRoot: string,
  allowInitialize: boolean,
  store = createLocalStore()
) {
  try {
    await store.readCurrentState(projectRoot);
  } catch (error) {
    if (!(error instanceof StateNotInitializedError)) {
      throw error;
    }
    if (!allowInitialize) {
      throw new Error(
        "Continuity state is not initialized. Run `acr init` first or use `acr start --init`."
      );
    }
    await store.initialize(projectRoot);
  }
}

async function ensureInstalled(
  adapterId: string,
  launcher: Awaited<ReturnType<typeof createCliLauncher>>
) {
  const agent = launcher.registry().get(adapterId);
  if (!agent) {
    throw new Error(`Unknown adapter: ${adapterId}`);
  }

  const installation = agent.installation;
  if (!installation.installed) {
    throw new Error(
      `Adapter ${adapterId} is not installed: ${installation.details}`
    );
  }

  return agent.adapter;
}

async function detectFallbacks(
  adapterIds: string[],
  launcher: Awaited<ReturnType<typeof createCliLauncher>>
) {
  const resolved = [];
  for (const adapterId of adapterIds) {
    const agent = launcher.registry().get(adapterId);
    if (!agent) {
      throw new Error(`Unknown adapter: ${adapterId}`);
    }
    const installation = agent.installation;
    if (!installation.installed) {
      process.stderr.write(
        `Skipping unavailable fallback ${adapterId}: ${installation.details}\n`
      );
      continue;
    }
    resolved.push(agent.adapter);
  }
  return resolved;
}

function scheduledFallbacks(
  launcher: Awaited<ReturnType<typeof createCliLauncher>>,
  preferredAgentId: string,
  allowedAgentIds: string[]
) {
  const selected: string[] = [preferredAgentId];
  const fallbacks = [];

  while (true) {
    const currentAgentId = selected[selected.length - 1];
    const next = launcher.scheduler().selectNext(
      currentAgentId
        ? {
            preferredAgentId,
            allowedAgentIds,
            currentAgentId,
            excludedAgentIds: selected
          }
        : {
            preferredAgentId,
            allowedAgentIds,
            excludedAgentIds: selected
          },
      launcher.registry().list()
    );
    if (!next) break;
    selected.push(next.id);
    fallbacks.push(next.adapter);
  }

  return fallbacks;
}

async function waitForSwitchRelease(projectRoot: string, requestId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const result = await readSwitchResult(projectRoot).catch(() => null);
    if (result?.requestId === requestId) {
      if (result.status !== "ready") {
        throw new Error(result.message);
      }
      return result;
    }

    try {
      const lock = await acquireRuntimeLock(projectRoot, `switch-${requestId}`);
      await lock.release();
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if (!(error instanceof RuntimeLockedError)) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Timed out waiting for the active runtime to release.");
}

/**
 * Return an interactive input stream. Prefers the real terminal so the wizard
 * still works when stdin is a pipe (e.g. `curl install.sh | bash` spawning it).
 */
function interactiveInput(): Readable {
  if (process.stdin.isTTY) return process.stdin;
  try {
    return createReadStream("/dev/tty");
  } catch {
    return process.stdin;
  }
}

/**
 * Interactive first-run wizard. Asks for the primary agent and what should take
 * over on a usage limit (a second account of the same tool, or the other tool),
 * then saves defaults so everyday use is a bare `acr start .`.
 */
export async function runSetup(
  input: Readable = interactiveInput(),
  output: Writable = process.stdout
): Promise<void> {
  const rl = createInterface({ input, output });
  const ask = (question: string) => rl.question(question);
  try {
    const existing = loadAcrConfig();
    output.write("\nACR setup — configure your agent and its fallback.\n\n");

    const primaryAnswer = (
      await ask(
        "Which agent do you use most?\n  [1] Claude Code\n  [2] Codex\nChoice (default 1): "
      )
    ).trim();
    const primary = primaryAnswer === "2" ? "codex" : "claude-code";
    const otherTool = primary === "claude-code" ? "codex" : "claude-code";
    const otherToolName = otherTool === "codex" ? "Codex" : "Claude Code";
    const altId = `${primary}-alt`;

    const modeAnswer = (
      await ask(
        `\nWhen "${primary}" hits a usage limit, switch to:\n` +
          `  [1] a second account of the same tool\n` +
          `  [2] the other tool (${otherToolName})\n` +
          "Choice (default 1): "
      )
    ).trim();

    const config: AcrConfig = { ...existing, primary };

    if (modeAnswer === "2") {
      config.fallback = otherTool;
    } else {
      config.fallback = altId;
      const defaultHome = path.join(os.homedir(), ".acr", "accounts", altId);
      const homeAnswer = (
        await ask(
          `\nFolder to store the second account's login\n(default ${defaultHome}): `
        )
      ).trim();
      const home = homeAnswer || defaultHome;
      mkdirSync(home, { recursive: true });
      config.accounts = {
        ...(existing.accounts ?? {}),
        [altId]: { ...(existing.accounts?.[altId] ?? {}), home }
      };

      const loginCommand =
        primary === "claude-code"
          ? { command: "claude", args: [] as string[], envKey: "HOME" }
          : { command: "codex", args: ["login"], envKey: "CODEX_HOME" };
      const manualLogin =
        primary === "claude-code"
          ? `HOME="${home}" claude`
          : `CODEX_HOME="${home}" codex login`;

      const loginAnswer = (
        await ask(
          "\nLog in to that second account now? This opens the tool's login " +
            "flow. [Y/n]: "
        )
      )
        .trim()
        .toLowerCase();

      if (loginAnswer !== "n" && loginAnswer !== "no") {
        const result = spawnSync(loginCommand.command, loginCommand.args, {
          stdio: "inherit",
          env: { ...process.env, [loginCommand.envKey]: home }
        });
        if (result.error) {
          output.write(
            `\nCould not launch "${loginCommand.command}" automatically. ` +
              `Log in later with:\n  ${manualLogin}\n`
          );
        }
      } else {
        output.write(`\nLog in later with:\n  ${manualLogin}\n`);
      }
    }

    saveAcrConfig(config);

    output.write(`\nSaved to ${acrConfigPath()}:\n`);
    output.write(`  primary   ${config.primary}\n`);
    output.write(`  fallback  ${config.fallback}\n\n`);
    output.write("Done. From your project directory just run:\n");
    output.write("  acr start .\n\n");
    output.write(
      "ACR will run your primary agent and hand off to the fallback on a " +
        "usage limit.\n"
    );
  } finally {
    rl.close();
  }
}

/**
 * Show a numbered menu of switchable agents and return the chosen adapter id.
 * Used when `acr switch` is run without `--to` in an interactive terminal, so
 * the user sees the available tools/accounts instead of an error.
 */
export async function promptSelectAdapter(
  choices: Array<{ id: string; displayName: string }>,
  input: Readable = interactiveInput(),
  output: Writable = process.stdout
): Promise<string> {
  if (choices.length === 0) {
    throw new Error("No installed agents are available to switch to.");
  }
  const rl = createInterface({ input, output });
  try {
    output.write("\nSwitch to which agent?\n");
    choices.forEach((choice, index) => {
      output.write(`  [${index + 1}] ${choice.displayName} (${choice.id})\n`);
    });
    const answer = (await rl.question(`Choice (1-${choices.length}): `)).trim();
    const picked = Number.parseInt(answer, 10);
    const chosen =
      Number.isInteger(picked) && picked >= 1 && picked <= choices.length
        ? choices[picked - 1]
        : choices.find((choice) => choice.id === answer);
    if (!chosen) {
      throw new Error(`Invalid selection: ${answer}`);
    }
    return chosen.id;
  } finally {
    rl.close();
  }
}

export type SessionAction =
  | { kind: "switch"; agentId: string }
  | { kind: "restart"; agentId: string }
  | { kind: "quit" };

function baseTool(agentId: string): "claude-code" | "codex" {
  return agentId.startsWith("codex") ? "codex" : "claude-code";
}

function toolDisplayName(base: "claude-code" | "codex"): string {
  return base === "codex" ? "Codex" : "Claude Code";
}

/**
 * The menu shown after an agent session ends, in one window: switch tool, switch
 * account of the same tool, restart, or quit. Pure so it can be unit-tested.
 */
export function postSessionChoices(
  currentAgentId: string
): Array<{ label: string; action: SessionAction }> {
  const base = baseTool(currentAgentId);
  const otherTool = base === "claude-code" ? "codex" : "claude-code";
  const isAlt = currentAgentId.endsWith("-alt");
  const otherAccountId = isAlt ? base : `${base}-alt`;
  const currentName = toolDisplayName(base);

  return [
    {
      label: `Continue with ${toolDisplayName(otherTool)} (use this if you hit a usage limit)`,
      action: { kind: "switch", agentId: otherTool }
    },
    {
      label: isAlt
        ? `Switch back to your main ${currentName} account`
        : `Continue with a second ${currentName} account`,
      action: { kind: "switch", agentId: otherAccountId }
    },
    {
      label: `Restart ${currentName}`,
      action: { kind: "restart", agentId: currentAgentId }
    },
    { label: "Quit", action: { kind: "quit" } }
  ];
}

/**
 * Show the post-session menu and return the chosen action.
 */
export async function promptPostSession(
  currentAgentId: string,
  input: Readable = interactiveInput(),
  output: Writable = process.stdout
): Promise<SessionAction> {
  const choices = postSessionChoices(currentAgentId);
  const rl = createInterface({ input, output });
  try {
    const name = toolDisplayName(baseTool(currentAgentId));
    output.write(`\n──────────────────────────────────────────\n`);
    output.write(`${name} ended. What would you like to do next?\n`);
    choices.forEach((choice, index) => {
      output.write(`  [${index + 1}] ${choice.label}\n`);
    });
    output.write(`──────────────────────────────────────────\n`);
    const answer = (await rl.question(`Choose (1-${choices.length}): `)).trim();
    const picked = Number.parseInt(answer, 10);
    const chosen =
      Number.isInteger(picked) && picked >= 1 && picked <= choices.length
        ? choices[picked - 1]
        : undefined;
    // Default to quit on an empty/invalid answer so a stray Enter is harmless.
    return chosen ? chosen.action : { kind: "quit" };
  } finally {
    rl.close();
  }
}

/**
 * Ensure a second-account adapter (e.g. claude-code-alt) has its own login
 * directory configured, setting it up inline if not. Returns true when the
 * account is ready to use.
 */
async function ensureAltAccountConfigured(
  altId: string,
  input: Readable = interactiveInput(),
  output: Writable = process.stdout
): Promise<boolean> {
  const config = loadAcrConfig();
  if (config.accounts?.[altId]?.home) return true;

  const base = baseTool(altId);
  const home = path.join(os.homedir(), ".acr", "accounts", altId);
  const rl = createInterface({ input, output });
  try {
    output.write(
      `\nYou haven't set up a second ${toolDisplayName(base)} account yet.\n`
    );
    const go = (await rl.question("Set one up now? It opens a login. [Y/n]: "))
      .trim()
      .toLowerCase();
    if (go === "n" || go === "no") return false;

    mkdirSync(home, { recursive: true });
    saveAcrConfig({
      ...config,
      accounts: {
        ...(config.accounts ?? {}),
        [altId]: { ...(config.accounts?.[altId] ?? {}), home }
      }
    });

    const login =
      base === "claude-code"
        ? { command: "claude", args: [] as string[], envKey: "HOME" }
        : { command: "codex", args: ["login"], envKey: "CODEX_HOME" };
    output.write(
      `\nOpening ${login.command} to log in the second account...\n`
    );
    const result = spawnSync(login.command, login.args, {
      stdio: "inherit",
      env: { ...process.env, [login.envKey]: home }
    });
    if (result.error) {
      output.write(
        `Could not open ${login.command} automatically. Set it up later with 'acr setup'.\n`
      );
      return false;
    }
    return true;
  } finally {
    rl.close();
  }
}

/**
 * Run an agent, then present the one-window menu when it ends, looping so the
 * user can switch tools/accounts, restart, or quit — all in the same terminal
 * without extra commands. This backs the `acr-claude` / `acr-codex` shortcuts.
 */
/**
 * Explain, before the first launch, how to get back to the switch menu. The
 * agent's own UI often clears the screen on startup, so this is gated behind
 * "Press Enter" to make sure a first-time user actually reads it.
 */
async function printSessionIntro(
  agentId: string,
  input: Readable = interactiveInput(),
  output: Writable = process.stdout
): Promise<void> {
  const name = toolDisplayName(baseTool(agentId));
  output.write(`\n──────────────────────────────────────────\n`);
  output.write(` Starting ${name}.\n\n`);
  output.write(` When you are done — or if you hit a usage limit — type\n`);
  output.write(`   /exit\n`);
  output.write(` inside ${name} (or press Ctrl-C). A menu will appear right\n`);
  output.write(` here so you can switch to another tool or account and keep\n`);
  output.write(` going. Your progress is saved automatically.\n`);
  output.write(`──────────────────────────────────────────\n`);
  const rl = createInterface({ input, output });
  try {
    await rl.question("Press Enter to start... ");
  } finally {
    rl.close();
  }
}

async function runAgentLoop(
  projectRoot: string,
  startAgentId: string,
  store: ReturnType<typeof createLocalStore>
): Promise<void> {
  await ensureInitialized(projectRoot, true, store);
  let currentAgentId = startAgentId;
  let firstLaunch = true;

  for (;;) {
    const launcher = await createCliLauncher(projectRoot);
    const adapter = await ensureInstalled(currentAgentId, launcher);
    if (process.stdout.isTTY && process.stdin.isTTY) {
      if (firstLaunch) {
        await printSessionIntro(currentAgentId);
      } else {
        const name = toolDisplayName(baseTool(currentAgentId));
        process.stdout.write(
          `\nStarting ${name} — type /exit inside it to return to the menu.\n`
        );
      }
    }
    firstLaunch = false;
    const supervisor = createRuntimeSupervisor();
    const result = await supervisor.startSession({
      projectRoot,
      agent: adapter,
      fallbacks: [],
      allowConcurrent: true,
      resolveAdapterById: (adapterId) =>
        launcher.registry().get(adapterId)?.adapter
    });

    // Non-interactive (piped/CI): keep the old behavior and stop.
    if (!process.stdin.isTTY) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    const action = await promptPostSession(currentAgentId);
    if (action.kind === "quit") {
      process.stdout.write("\nDone. Your progress is saved.\n");
      return;
    }
    if (action.kind === "restart") {
      currentAgentId = action.agentId;
      continue;
    }
    // action.kind === "switch"
    if (
      action.agentId.endsWith("-alt") &&
      !(await ensureAltAccountConfigured(action.agentId).catch(() => false))
    ) {
      // Setup declined/failed — return to the same agent's menu next loop.
      continue;
    }
    currentAgentId = action.agentId;
  }
}

export async function confirmUnknownTermination(
  input: Readable = process.stdin,
  output: Writable = process.stdout
) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      "Unknown termination detected. Stop safely? [Y/n] "
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === "n" || normalized === "no") {
      throw new Error(
        "Manual intervention requested after unknown termination."
      );
    }
  } finally {
    rl.close();
  }
}

async function detectPtyAvailability() {
  try {
    const pty = (await import("node-pty")).default;
    // Importing is not enough — the native binding can load yet fail to spawn
    // (e.g. node-pty vs. a very new Node). Probe an actual spawn to be honest.
    const probe = pty.spawn(process.execPath, ["-e", "0"], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>
    });
    probe.kill();
    return true;
  } catch {
    return false;
  }
}

async function collectDoctorReport(
  launcher: Awaited<ReturnType<typeof createCliLauncher>>,
  projectRoot?: string
) {
  const healthStore = createAgentHealthStore();
  const localStore = createLocalStore();
  const ptyAvailable = await detectPtyAvailability();
  let repositoryInitialized = false;
  let runtimeState = null;
  let lockStatus: { locked: boolean; details?: unknown } = { locked: false };
  let stateDirectoryWritable: boolean | null = null;
  let healthRecords: Record<
    string,
    Awaited<ReturnType<typeof healthStore.read>>
  > = {};

  if (projectRoot) {
    await access(projectRoot, fsConstants.W_OK)
      .then(() => {
        stateDirectoryWritable = true;
      })
      .catch(() => {
        stateDirectoryWritable = false;
      });

    await localStore
      .readCurrentState(projectRoot)
      .then(() => {
        repositoryInitialized = true;
      })
      .catch(() => {
        repositoryInitialized = false;
      });

    runtimeState = await readRuntimeState(projectRoot).catch(() => null);
    healthRecords = await healthStore.readAll(projectRoot).catch(() => ({}));

    try {
      const probe = await acquireRuntimeLock(
        projectRoot,
        `doctor-${process.pid}`
      );
      await probe.release();
    } catch (error) {
      if (error instanceof RuntimeLockedError) {
        lockStatus = {
          locked: true,
          details: error.owner
        };
      }
    }
  }

  return {
    runtimeVersion,
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    availableTransports: ["stdio", "spawn", ...(ptyAvailable ? ["pty"] : [])],
    ptyAvailable,
    projectRoot: projectRoot ?? null,
    repositoryInitialized,
    mcpReadiness: projectRoot
      ? "project-scoped-stdio-ready"
      : "global-stdio-ready",
    stateDirectoryWritable,
    lockStatus,
    runtimeState,
    agents: launcher
      .registry()
      .list()
      .map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        pluginId: agent.plugin.manifest.pluginId,
        pluginSource: agent.plugin.source ?? "builtin",
        adapterVersion: agent.plugin.manifest.version,
        executable: agent.plugin.manifest.executable.command,
        installation: agent.installation,
        metadata: agent.metadata,
        health: projectRoot ? (healthRecords[agent.id] ?? null) : null,
        cooldown: projectRoot
          ? (healthRecords[agent.id]?.cooldownExpiresAt ?? null)
          : null,
        recentFailures: projectRoot
          ? (healthRecords[agent.id]?.recentFailures ?? [])
          : []
      }))
  };
}

export async function runCli(argv = process.argv): Promise<void> {
  const shortcutMode = shortcutModeFromArgv(argv);
  const store = createLocalStore();
  if (shortcutMode) {
    await runShortcut(shortcutMode, argv, store);
    return;
  }

  const [, , command, ...rest] = argv;
  const service = new ProjectService();

  switch (command) {
    case undefined:
    case "--help":
    case "help":
      process.stdout.write(`${renderHelp()}\n`);
      return;
    case "setup": {
      await runSetup();
      return;
    }
    case "init": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const result = await store.initialize(projectRoot);
      process.stdout.write(
        `${JSON.stringify({ projectRoot, ...result }, null, 2)}\n`
      );
      return;
    }
    case "status": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const result = await service.inspectProject(projectRoot);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "validate": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const result = await service.validate(projectRoot);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "repair": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const result = await service.repair(projectRoot, hasFlag(rest, "--safe"));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "checkpoint": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const summary = getFlag(rest, "--summary");
      const nextAction = getFlag(rest, "--next");
      if (!summary || !nextAction) {
        throw new Error("checkpoint requires --summary and --next.");
      }
      const result = await service.createCheckpoint(
        projectRoot,
        "manual",
        summary,
        nextAction,
        true
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "resume": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const result = await service.resumeProject(projectRoot, false);
      process.stdout.write(`${result.brief.summary}\n`);
      return;
    }
    case "start": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const launcher = await createCliLauncher(projectRoot);
      const config = loadAcrConfig();
      // Fall back to saved `acr setup` defaults so `acr start .` works flag-free.
      const agent = getFlag(rest, "--agent") ?? config.primary;
      const flagFallbacks = getFlagValues(rest, "--fallback");
      const fallback =
        flagFallbacks.length > 0
          ? flagFallbacks
          : config.fallback
            ? [config.fallback]
            : [];
      const scenario = getFlag(rest, "--scenario");
      const fallbackScenarios = getFlagValues(rest, "--fallback-scenario");
      if (!agent) {
        throw new Error(
          "start requires --agent <id> (or run `acr setup` to save a default)."
        );
      }
      await ensureInitialized(projectRoot, hasFlag(rest, "--init"), store);
      const primary = await ensureInstalled(agent, launcher);
      const installedFallbacks =
        fallback.length > 0
          ? scheduledFallbacks(launcher, agent, [agent, ...fallback])
          : await detectFallbacks(fallback, launcher);
      const supervisor = createRuntimeSupervisor();
      const result = await supervisor.startSession({
        projectRoot,
        agent: primary,
        fallbacks: installedFallbacks,
        ...(scenario ? { scenario } : {}),
        fallbackScenarios,
        resolveAdapterById: (adapterId) =>
          launcher.registry().get(adapterId)?.adapter
      });
      if (result.classification.kind === "unknown" && process.stdin.isTTY) {
        await confirmUnknownTermination();
      }
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "switch": {
      const projectRoot = resolveProjectRoot(rest[0]);
      const launcher = await createCliLauncher(projectRoot);
      let target = getFlag(rest, "--to");
      if (!target) {
        // No explicit target: show an interactive picker of installed agents so
        // the user can choose a tool/account instead of hitting an error.
        const choices = launcher
          .registry()
          .list()
          .filter(
            (agent) => agent.id !== "fake-agent" && agent.installation.installed
          )
          .map((agent) => ({ id: agent.id, displayName: agent.displayName }));
        if (process.stdin.isTTY) {
          target = await promptSelectAdapter(choices);
        } else {
          const ids = choices.map((choice) => choice.id).join(", ");
          throw new Error(
            `switch requires --to <id>. Available: ${ids || "(none installed)"}.`
          );
        }
      }
      await ensureInitialized(projectRoot, false, store);
      const adapter = await ensureInstalled(target, launcher);
      const runtimeState = await readRuntimeState(projectRoot).catch(
        () => null
      );
      const fallbackIds = runtimeState?.fallbackOrder ?? [];

      try {
        const probeLock = await acquireRuntimeLock(
          projectRoot,
          `switch-probe-${process.pid}`
        );
        await probeLock.release();
        const checkpoint = await service.createCheckpoint(
          projectRoot,
          "switch",
          "Manual switch requested without an active runtime session.",
          `Resume using the requested target adapter: ${adapter.id}.`,
          true
        );
        const startResult = await createRuntimeSupervisor().startSession({
          projectRoot,
          agent: adapter,
          fallbacks: scheduledFallbacks(launcher, target, [
            target,
            ...fallbackIds.filter((adapterId) => adapterId !== target)
          ]),
          resolveAdapterById: (adapterId) =>
            launcher.registry().get(adapterId)?.adapter
        });
        process.stdout.write(
          `${JSON.stringify({ checkpoint, startResult }, null, 2)}\n`
        );
        return;
      } catch (error) {
        if (!(error instanceof RuntimeLockedError)) {
          throw error;
        }
      }

      const requestId = randomUUID();
      await writeSwitchRequest(projectRoot, {
        requestId,
        targetAdapterId: adapter.id,
        requestedAt: new Date().toISOString(),
        requesterPid: process.pid
      });
      const switchResult = await waitForSwitchRelease(projectRoot, requestId);
      const startResult = await createRuntimeSupervisor().startSession({
        projectRoot,
        agent: adapter,
        fallbacks: scheduledFallbacks(launcher, target, [
          target,
          ...fallbackIds.filter((adapterId) => adapterId !== target)
        ]),
        resolveAdapterById: (adapterId) =>
          launcher.registry().get(adapterId)?.adapter
      });
      process.stdout.write(
        `${JSON.stringify({ switchResult, startResult }, null, 2)}\n`
      );
      return;
    }
    case "adapters":
      if (rest[0] === "list") {
        const launcher = await createCliLauncher();
        process.stdout.write(
          `${JSON.stringify(
            launcher
              .registry()
              .list()
              .map((agent) => ({
                id: agent.id,
                displayName: agent.displayName,
                installation: agent.installation,
                metadata: agent.metadata
              })),
            null,
            2
          )}\n`
        );
        return;
      }
      break;
    case "health":
      if (rest[0] === "reset") {
        const projectRoot = resolveProjectRoot(rest[1]);
        const agentId = getFlag(rest, "--agent");
        await createAgentHealthStore().reset(projectRoot, agentId);
        process.stdout.write(
          `${JSON.stringify(
            { projectRoot, reset: agentId ?? "all" },
            null,
            2
          )}\n`
        );
        return;
      }
      break;
    case "mcp":
      if (rest[0] === "serve") {
        const projectRoot = getFlag(rest, "--project");
        if (!projectRoot) {
          throw new Error("mcp serve requires --project /absolute/path");
        }
        const server = createAcrMcpServer({
          projectRoot: resolveProjectRoot(projectRoot),
          allowedRoots: [resolveProjectRoot(projectRoot)]
        });
        await server.startStdio();
        return;
      }
      break;
    case "doctor": {
      const projectRoot = rest[0] ? resolveProjectRoot(rest[0]) : undefined;
      const launcher = await createCliLauncher(projectRoot);
      const report = await collectDoctorReport(launcher, projectRoot);
      if (!hasFlag(rest, "--json")) {
        const lines = [
          `runtime: ${report.runtimeVersion}`,
          `platform: ${report.platform}`,
          `node: ${report.node}`,
          `transports: ${report.availableTransports.join(", ")}`,
          `pty available: ${String(report.ptyAvailable)}`,
          `project: ${report.projectRoot ?? "(none)"}`,
          `initialized: ${String(report.repositoryInitialized)}`,
          `lock: ${report.lockStatus.locked ? "locked" : "clear"}`
        ];
        for (const agent of report.agents) {
          lines.push(
            `agent ${agent.id}: installed=${String(agent.installation.installed)} plugin=${agent.pluginId} cooldown=${agent.cooldown ?? "none"}`
          );
        }
        process.stdout.write(`${lines.join("\n")}\n`);
        return;
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    default:
      break;
  }

  throw new Error(`Unknown command: ${command}`);
}

/**
 * True when this file is the program's entry point. Resolves symlinks on both
 * sides so it still matches when invoked through a linked bin (`npm link` /
 * global install create a symlinked `acr`), where the raw argv path and the
 * module URL differ.
 */
function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invoked)
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void runCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  });
}
