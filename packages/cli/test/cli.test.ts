import { PassThrough } from "node:stream";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmUnknownTermination,
  runCli,
  shortcutModeFromArgv
} from "../src/index.js";

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

  it("detects shortcut entrypoints from the invoked binary name", async () => {
    expect(shortcutModeFromArgv(["node", "acr-claude"])).toBe("claude-code");
    expect(shortcutModeFromArgv(["node", "acr-codex"])).toBe("codex");
    expect(shortcutModeFromArgv(["node", "acr"])).toBeNull();
  });
});
