import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createFakeAgentAdapter } from "@acr/adapter-fake";
import { createLocalStore } from "@acr/storage-local";

import {
  createProcessRunner,
  acquireRuntimeLock,
  createRepositoryInspector,
  createResumeEngine,
  createRuntimeSupervisor,
  readRuntimeState
} from "../src/index.js";

const execFileAsync = promisify(execFile);

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acr-runtime-test-"));
}

async function runGit(projectRoot: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: projectRoot });
}

describe("repository inspector", () => {
  it("handles non-git repositories gracefully", async () => {
    const projectRoot = await createTempProject();
    const inspector = createRepositoryInspector();

    const snapshot = await inspector.inspect(projectRoot);

    expect(snapshot.isGitRepository).toBe(false);
    expect(snapshot.isDirty).toBe(false);
  });

  it("surfaces untracked and modified work in git repositories", async () => {
    const projectRoot = await createTempProject();
    const inspector = createRepositoryInspector();

    await runGit(projectRoot, ["init", "-b", "main"]);
    await runGit(projectRoot, ["config", "user.email", "acr@example.com"]);
    await runGit(projectRoot, ["config", "user.name", "ACR"]);
    await writeFile(path.join(projectRoot, "tracked.txt"), "one\n", "utf8");
    await runGit(projectRoot, ["add", "tracked.txt"]);
    await runGit(projectRoot, ["commit", "-m", "initial"]);
    await writeFile(path.join(projectRoot, "tracked.txt"), "two\n", "utf8");
    await writeFile(path.join(projectRoot, "new.txt"), "new\n", "utf8");

    const snapshot = await inspector.inspect(projectRoot);

    expect(snapshot.isGitRepository).toBe(true);
    expect(snapshot.isDirty).toBe(true);
    expect(snapshot.unstagedPaths).toContain("tracked.txt");
    expect(snapshot.untrackedPaths).toContain("new.txt");
  });
});

describe("resume engine", () => {
  it("generates a concrete next action and flags stale or partial state", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();

    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await runGit(projectRoot, ["init", "-b", "main"]);
    await runGit(projectRoot, ["config", "user.email", "acr@example.com"]);
    await runGit(projectRoot, ["config", "user.name", "ACR"]);
    await writeFile(path.join(projectRoot, "README.md"), "base\n", "utf8");
    await runGit(projectRoot, ["add", "README.md"]);
    await runGit(projectRoot, ["commit", "-m", "initial"]);

    await store.initialize(projectRoot);
    await writeFile(
      path.join(projectRoot, "src", "feature.ts"),
      "export const x = 1;\n",
      "utf8"
    );

    const engine = createResumeEngine(store);
    const brief = await engine.generate(projectRoot);

    expect(brief.nextAction.length).toBeGreaterThan(0);
    expect(brief.changedFiles).toContain("src/feature.ts");
    expect(["partial_edit", "benign"]).toContain(brief.drift);
  });
});

describe("runtime lock", () => {
  it("prevents two supervisors from acquiring the same runtime lock", async () => {
    const projectRoot = await createTempProject();
    await mkdir(path.join(projectRoot, ".acr"), { recursive: true });

    const firstLock = await acquireRuntimeLock(projectRoot);
    await expect(acquireRuntimeLock(projectRoot)).rejects.toThrow(
      /Runtime lock already exists/
    );

    await firstLock.release();
  });

  it("recovers stale runtime locks for dead processes after the threshold", async () => {
    const projectRoot = await createTempProject();
    await mkdir(path.join(projectRoot, ".acr", "locks"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".acr", "locks", "runtime.lock.json"),
      JSON.stringify(
        {
          pid: 999999,
          hostname: os.hostname(),
          runtimeId: "stale-runtime",
          purpose: "runtime-supervision",
          createdAt: "2000-01-01T00:00:00.000Z",
          heartbeatAt: "2000-01-01T00:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const lock = await acquireRuntimeLock(projectRoot);
    expect(lock.path).toContain("runtime.lock.json");
    await lock.release();
  });
});

describe("runtime supervisor", () => {
  it("writes a recovery checkpoint and fails over on usage limit", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const fakeAdapter = createFakeAgentAdapter();

    const result = await supervisor.startSession({
      projectRoot,
      agent: fakeAdapter,
      fallbacks: [fakeAdapter],
      scenario: "usage_limit",
      fallbackScenarios: ["success"]
    });

    expect(result.classification.kind).toBe("usage_limit");
    expect(result.fallbackAgentId).toBe("fake-agent");
    expect(result.checkpoints).toHaveLength(2);

    const usageFile = await readFile(
      path.join(projectRoot, "fake-agent-output", "usage-limit.txt"),
      "utf8"
    );
    const successFile = await readFile(
      path.join(projectRoot, "fake-agent-output", "success.txt"),
      "utf8"
    );

    expect(usageFile).toContain("edited before usage limit");
    expect(successFile).toContain("completed");
  });

  it("updates runtime state as sessions start and stop", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const fakeAdapter = createFakeAgentAdapter();

    await supervisor.startSession({
      projectRoot,
      agent: fakeAdapter,
      scenario: "success"
    });

    const runtimeState = await readRuntimeState(projectRoot);
    expect(runtimeState.status).toBe("stopped");
    expect(runtimeState.activeAgent).toBeNull();
    expect(runtimeState.startedAt).not.toBeNull();
    expect(runtimeState.lastHeartbeatAt).not.toBeNull();
  });

  it("preserves partial edits on crash before failover", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const fakeAdapter = createFakeAgentAdapter();

    const result = await supervisor.startSession({
      projectRoot,
      agent: fakeAdapter,
      fallbacks: [fakeAdapter],
      scenario: "partial_crash",
      fallbackScenarios: ["success"]
    });

    expect(result.classification.kind).toBe("process_crash");
    expect(result.fallbackAgentId).toBe("fake-agent");

    const partialFile = await readFile(
      path.join(projectRoot, "fake-agent-output", "partial-crash.txt"),
      "utf8"
    );
    expect(partialFile).toContain("partial edit");
  });

  it("stops safely on unknown failure without failover", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const fakeAdapter = createFakeAgentAdapter();

    const result = await supervisor.startSession({
      projectRoot,
      agent: fakeAdapter,
      fallbacks: [fakeAdapter],
      scenario: "unknown"
    });

    expect(result.classification.kind).toBe("unknown");
    expect(result.fallbackAgentId).toBeNull();
    expect(result.checkpoints).toHaveLength(1);
  });

  it("treats interrupted long-running sessions as user interrupts", async () => {
    const projectRoot = await createTempProject();
    const runner = createProcessRunner();
    const fakeAdapter = createFakeAgentAdapter();
    const spec = await fakeAdapter.buildLaunchSpec({
      projectRoot,
      resumeInstruction: "Resume here.",
      scenario: "long_running"
    });

    const runPromise = runner.run(spec);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await runner.terminate("test interrupt");
    const result = await runPromise;
    const classification = await fakeAdapter.classifyTermination(result);

    expect(classification.kind).toBe("user_interrupt");
    expect(classification.safeToFailover).toBe(false);
  });
});
