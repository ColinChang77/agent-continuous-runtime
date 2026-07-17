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
  createDiffDigest,
  createRepositoryInspector,
  createResumeEngine,
  createRuntimeSupervisor,
  createStatusDigest,
  readRuntimeState,
  InheritTransportStrategy
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

  it("includes structured conversation memory in the resume brief", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();

    await store.initialize(projectRoot);
    const current = await store.readCurrentState(projectRoot);
    await store.writeCurrentState(
      projectRoot,
      {
        ...current,
        conversationMemory: {
          userIntent: "Keep user intent across tool switches.",
          userConstraints: ["Do not store full raw transcripts by default."],
          userPreferences: ["Prefer concise structured memory."],
          rejectedApproaches: ["Do not rely on implicit provider-side memory."],
          openQuestions: ["Should transcript capture be opt-in?"],
          importantContext: ["Current handoff only carries task summary."]
        }
      },
      current.revision
    );

    const engine = createResumeEngine(store);
    const brief = await engine.generate(projectRoot);

    expect(brief.summary).toContain("## Conversation Memory");
    expect(brief.summary).toContain("Keep user intent across tool switches.");
    expect(brief.conversationMemory.userPreferences).toContain(
      "Prefer concise structured memory."
    );
  });

  it("marks repository-bound verification stale when tracked content changes", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();
    const inspector = createRepositoryInspector();

    await runGit(projectRoot, ["init", "-b", "main"]);
    await runGit(projectRoot, ["config", "user.email", "acr@example.com"]);
    await runGit(projectRoot, ["config", "user.name", "ACR"]);
    await writeFile(path.join(projectRoot, "tracked.txt"), "one\n", "utf8");
    await runGit(projectRoot, ["add", "tracked.txt"]);
    await runGit(projectRoot, ["commit", "-m", "initial"]);
    await store.initialize(projectRoot);

    await writeFile(path.join(projectRoot, "tracked.txt"), "two\n", "utf8");
    const [snapshot, diff] = await Promise.all([
      inspector.inspect(projectRoot),
      inspector.diff(projectRoot)
    ]);
    const repositoryEvidence = {
      head: snapshot.head,
      branch: snapshot.branch,
      isDirty: snapshot.isDirty,
      statusDigest: createStatusDigest(snapshot),
      diffDigest: createDiffDigest(diff),
      capturedAt: snapshot.capturedAt
    };
    const current = await store.readCurrentState(projectRoot);
    await store.writeCurrentState(
      projectRoot,
      {
        ...current,
        verification: {
          commands: ["npm test"],
          passed: ["npm test"],
          failed: [],
          notRunReason: null,
          repositoryEvidence
        },
        repositoryEvidence
      },
      current.revision
    );

    const engine = createResumeEngine(store);
    expect((await engine.generate(projectRoot)).verificationFreshness).toBe(
      "current"
    );

    await writeFile(path.join(projectRoot, "tracked.txt"), "three\n", "utf8");
    const staleBrief = await engine.generate(projectRoot);

    expect(staleBrief.verificationFreshness).toBe("stale");
    expect(staleBrief.summary).toContain("Evidence freshness: stale");
    expect(staleBrief.warnings).toContain(
      "Recorded verification evidence is stale because the repository changed after it was captured."
    );
  });

  it("marks verification stale when an untracked file changes in place", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();
    const inspector = createRepositoryInspector();

    await runGit(projectRoot, ["init", "-b", "main"]);
    await runGit(projectRoot, ["config", "user.email", "acr@example.com"]);
    await runGit(projectRoot, ["config", "user.name", "ACR"]);
    await writeFile(path.join(projectRoot, "README.md"), "base\n", "utf8");
    await runGit(projectRoot, ["add", "README.md"]);
    await runGit(projectRoot, ["commit", "-m", "initial"]);
    await store.initialize(projectRoot);
    await writeFile(path.join(projectRoot, "draft.ts"), "one\n", "utf8");

    const [snapshot, diff] = await Promise.all([
      inspector.inspect(projectRoot),
      inspector.diff(projectRoot)
    ]);
    const repositoryEvidence = {
      head: snapshot.head,
      branch: snapshot.branch,
      isDirty: snapshot.isDirty,
      statusDigest: createStatusDigest(snapshot),
      diffDigest: createDiffDigest(diff),
      capturedAt: snapshot.capturedAt
    };
    const current = await store.readCurrentState(projectRoot);
    await store.writeCurrentState(
      projectRoot,
      {
        ...current,
        verification: {
          commands: ["npm test"],
          passed: ["npm test"],
          failed: [],
          notRunReason: null,
          repositoryEvidence
        },
        repositoryEvidence
      },
      current.revision
    );

    const engine = createResumeEngine(store);
    expect((await engine.generate(projectRoot)).verificationFreshness).toBe(
      "current"
    );
    await writeFile(path.join(projectRoot, "draft.ts"), "two\n", "utf8");
    expect((await engine.generate(projectRoot)).verificationFreshness).toBe(
      "stale"
    );
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

  it("allows independent named runtime locks for concurrent windows", async () => {
    const projectRoot = await createTempProject();
    const first = await acquireRuntimeLock(
      projectRoot,
      "session-1",
      "runtime-supervision",
      "runtime-101"
    );
    const second = await acquireRuntimeLock(
      projectRoot,
      "session-2",
      "runtime-supervision",
      "runtime-202"
    );

    expect(first.path).not.toBe(second.path);
    await Promise.all([first.release(), second.release()]);
  });
});

describe("runtime supervisor", () => {
  it("runs multiple shortcut sessions concurrently in one project", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();
    await store.initialize(projectRoot);
    const fakeAdapter = createFakeAgentAdapter();

    const results = await Promise.all([
      createRuntimeSupervisor().startSession({
        projectRoot,
        agent: fakeAdapter,
        scenario: "success",
        allowConcurrent: true
      }),
      createRuntimeSupervisor().startSession({
        projectRoot,
        agent: fakeAdapter,
        scenario: "success",
        allowConcurrent: true
      })
    ]);

    expect(
      results.every((result) => result.classification.kind === "normal_exit")
    ).toBe(true);
    expect((await store.readCurrentState(projectRoot)).revision).toBe(5);
  });

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

  it("automatically enriches conversation memory before checkpointing handoff", async () => {
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
    const store = createLocalStore();
    const current = await store.readCurrentState(projectRoot);

    expect(current.conversationMemory.userIntent.length).toBeGreaterThan(0);
    expect(current.conversationMemory.userConstraints).toContain(
      "Inspect repository truth before trusting continuity state."
    );
    expect(
      current.conversationMemory.importantContext.some((item) =>
        item.includes("Latest handoff summary:")
      )
    ).toBe(true);
    expect(
      current.conversationMemory.openQuestions.some((item) =>
        item.includes("Next requested action:")
      )
    ).toBe(true);
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

  it("runs the attached (inherit) transport with no native dependency", async () => {
    const strategy = new InheritTransportStrategy();
    const result = await strategy.run({
      command: process.execPath,
      args: ["-e", "process.exit(3)"],
      cwd: process.cwd(),
      env: process.env as Record<string, string>
    });

    expect(strategy.mode).toBe("spawn");
    expect(result.exitCode).toBe(3);
    // Attached mode does not capture output.
    expect(result.output).toBe("");
  });
});
