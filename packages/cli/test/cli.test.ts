import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmUnknownTermination,
  postSessionChoices,
  promptPostSession,
  promptSelectAdapter,
  runCli,
  shortcutModeFromArgv
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const distEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../dist/acr.js"
);

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acr-cli-test-"));
}

describe("CLI", () => {
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  afterEach(() => {
    stdout.mockClear();
  });

  it("initializes and reports status for a project", async () => {
    const projectRoot = await createTempProject();

    await runCli(["node", "acr", "init", projectRoot]);
    await runCli(["node", "acr", "status", projectRoot]);

    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain(projectRoot);
    expect(output).toContain("stateRevision");
  });

  it("lists adapters and reports doctor output", async () => {
    await runCli(["node", "acr", "adapters", "list"]);
    await runCli(["node", "acr", "doctor"]);

    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("fake-agent");
    expect(output).toContain("claude-code");
    expect(output).toContain("codex");
    expect(output).toContain("gemini");
  });

  it("loads an external plugin package without runtime source changes", async () => {
    vi.stubEnv("ACR_AGENT_PLUGINS", "@acr/example-external-plugin");

    await runCli(["node", "acr", "adapters", "list"]);

    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("external-fake-agent");

    vi.unstubAllEnvs();
  });

  it("rejects unsafe plugin identifiers without crashing startup", async () => {
    vi.stubEnv("ACR_AGENT_PLUGINS", "../unsafe-plugin");

    await runCli(["node", "acr", "adapters", "list"]);

    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("fake-agent");
    expect(output).not.toContain("unsafe-plugin");

    vi.unstubAllEnvs();
  });

  it("runs when invoked through a symlinked bin (as npm link installs it)", async () => {
    // The built bundle guards its entry point; a symlinked `acr` must still run.
    // Requires a prior `npm run build`; skip if the bundle is absent.
    if (!existsSync(distEntry)) return;

    const dir = await mkdtemp(path.join(os.tmpdir(), "acr-bin-"));
    const linked = path.join(dir, "acr");
    try {
      await symlink(distEntry, linked);
      const { stdout } = await execFileAsync(process.execPath, [
        linked,
        "--help"
      ]);
      expect(stdout).toContain("Agent Continuity Runtime");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires explicit initialization before start", async () => {
    const projectRoot = await createTempProject();

    await expect(
      runCli(["node", "acr", "start", projectRoot, "--agent", "fake-agent"])
    ).rejects.toThrow(/acr init|--init/);
  });

  it("switches an active runtime and launches the replacement agent", async () => {
    const projectRoot = await createTempProject();

    await runCli(["node", "acr", "init", projectRoot]);

    const startPromise = runCli([
      "node",
      "acr",
      "start",
      projectRoot,
      "--agent",
      "fake-agent",
      "--scenario",
      "long_running"
    ]);

    await new Promise((resolve) => setTimeout(resolve, 250));

    await runCli(["node", "acr", "switch", projectRoot, "--to", "fake-agent"]);
    await startPromise;

    await expect(
      access(path.join(projectRoot, "fake-agent-output", "success.txt"))
    ).resolves.toBeUndefined();

    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("switchResult");
    expect(output).toContain("startResult");
  });

  it("asks for confirmation before accepting an unknown interactive stop", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    input.end("y\n");
    await expect(
      confirmUnknownTermination(input, output)
    ).resolves.toBeUndefined();
  });

  it("lets you pick a switch target from a numbered menu", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let prompted = "";
    output.on("data", (chunk) => {
      prompted += String(chunk);
      if (prompted.trimEnd().endsWith(":")) {
        // Answer the menu prompt with choice 2 once it is shown.
        input.write("2\n");
        prompted = "";
      }
    });

    const chosen = await promptSelectAdapter(
      [
        { id: "claude-code", displayName: "Claude Code" },
        { id: "codex", displayName: "Codex" }
      ],
      input,
      output
    );

    expect(chosen).toBe("codex");
  });

  it("offers switch/restart/quit in the post-session menu", () => {
    const fromClaude = postSessionChoices("claude-code");
    expect(fromClaude[0].action).toEqual({ kind: "switch", agentId: "codex" });
    expect(fromClaude[1].action).toEqual({
      kind: "switch",
      agentId: "claude-code-alt"
    });
    expect(fromClaude[2].action).toEqual({
      kind: "restart",
      agentId: "claude-code"
    });
    expect(fromClaude[3].action).toEqual({ kind: "quit" });

    // From an alt account, option 2 switches back to the main account.
    const fromAlt = postSessionChoices("claude-code-alt");
    expect(fromAlt[1].action).toEqual({
      kind: "switch",
      agentId: "claude-code"
    });
  });

  it("reads a post-session choice and defaults a blank answer to quit", async () => {
    const pick = new PassThrough();
    const out1 = new PassThrough();
    out1.on("data", (chunk) => {
      if (String(chunk).trimEnd().endsWith(":")) pick.write("1\n");
    });
    await expect(promptPostSession("codex", pick, out1)).resolves.toEqual({
      kind: "switch",
      agentId: "claude-code"
    });

    const blank = new PassThrough();
    const out2 = new PassThrough();
    out2.on("data", (chunk) => {
      if (String(chunk).trimEnd().endsWith(":")) blank.write("\n");
    });
    await expect(promptPostSession("codex", blank, out2)).resolves.toEqual({
      kind: "quit"
    });
  });

  it("detects shortcut entrypoints from the invoked binary name", async () => {
    expect(shortcutModeFromArgv(["node", "acr-claude"])).toBe("claude-code");
    expect(shortcutModeFromArgv(["node", "acr-codex"])).toBe("codex");
    expect(shortcutModeFromArgv(["node", "acr"])).toBeNull();
  });
});
