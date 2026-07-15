#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { existsSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    "  acr init [path]",
    "  acr status [path]",
    "  acr validate [path]",
    "  acr repair [path] [--safe]",
    '  acr checkpoint [path] --summary "..." --next "..."',
    "  acr resume [path]",
    "  acr start [path] --agent <id> [--fallback <id>...] [--init]",
    "  acr switch [path] --to <id>",
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
  const fallbackId = agentId === "claude-code" ? "codex" : "claude-code";
  const pathArg = argv[2];
  const projectRoot = resolveProjectRoot(isFlag(pathArg) ? undefined : pathArg);
  const rest = isFlag(pathArg) ? argv.slice(2) : argv.slice(3);
  const launcher = await createCliLauncher(projectRoot);
  await ensureInitialized(projectRoot, true, store);
  const primary = await ensureInstalled(agentId, launcher);
  const fallbacks = await detectFallbacks([fallbackId], launcher);
  const scenario = getFlag(rest, "--scenario");
  const fallbackScenarios = getFlagValues(rest, "--fallback-scenario");
  const supervisor = createRuntimeSupervisor();
  const result = await supervisor.startSession({
    projectRoot,
    agent: primary,
    fallbacks,
    ...(scenario ? { scenario } : {}),
    fallbackScenarios,
    resolveAdapterById: (adapterId) =>
      launcher.registry().get(adapterId)?.adapter
  });

  if (result.classification.kind === "unknown" && process.stdin.isTTY) {
    await confirmUnknownTermination();
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function builtinPlugins(): AgentPlugin[] {
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
      // Same `claude` binary, but launched against a different account by
      // overriding HOME / API key from env. Configure with:
      //   ACR_CLAUDE_ALT_HOME       separate ~/.claude credential store
      //   ACR_CLAUDE_ALT_API_KEY    alternate ANTHROPIC_API_KEY
      //   ACR_CLAUDE_ALT_BASE_URL   alternate ANTHROPIC_BASE_URL
      // If none are set it behaves like the default account.
      createAdapter: () =>
        createClaudeCodeAdapter({
          id: "claude-code-alt",
          displayName: "Claude Code (Alt Account)",
          envOverrides: {
            HOME: process.env.ACR_CLAUDE_ALT_HOME,
            ANTHROPIC_API_KEY: process.env.ACR_CLAUDE_ALT_API_KEY,
            ANTHROPIC_BASE_URL: process.env.ACR_CLAUDE_ALT_BASE_URL
          }
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
      // Same `codex` binary, but launched against a different account by
      // overriding CODEX_HOME / API key from env. Configure with:
      //   ACR_CODEX_ALT_HOME       separate ~/.codex credential store
      //   ACR_CODEX_ALT_API_KEY    alternate OPENAI_API_KEY
      //   ACR_CODEX_ALT_BASE_URL   alternate OPENAI_BASE_URL
      // If none are set it behaves like the default account.
      createAdapter: () =>
        createCodexAdapter({
          id: "codex-alt",
          displayName: "Codex (Alt Account)",
          envOverrides: {
            CODEX_HOME: process.env.ACR_CODEX_ALT_HOME,
            OPENAI_API_KEY: process.env.ACR_CODEX_ALT_API_KEY,
            OPENAI_BASE_URL: process.env.ACR_CODEX_ALT_BASE_URL
          }
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
  const configured = process.env.ACR_AGENT_PLUGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!configured || configured.length === 0) {
    return builtinPlugins();
  }

  const plugins = [...builtinPlugins()];
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
    await import("node-pty");
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
      const agent = getFlag(rest, "--agent");
      const fallback = getFlagValues(rest, "--fallback");
      const scenario = getFlag(rest, "--scenario");
      const fallbackScenarios = getFlagValues(rest, "--fallback-scenario");
      if (!agent) throw new Error("start requires --agent <id>.");
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
      const target = getFlag(rest, "--to");
      if (!target) throw new Error("switch requires --to <id>.");
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  });
}
