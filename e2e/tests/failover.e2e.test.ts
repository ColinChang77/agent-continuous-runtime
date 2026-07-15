import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFakeAgentAdapter,
  createNamedFakeAgentAdapter
} from "@acr/adapter-fake";
import { createRuntimeSupervisor } from "@acr/runtime";

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acr-e2e-test-"));
}

describe("fake-agent e2e failover", () => {
  it("demonstrates full usage-limit failover with preserved edits", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const primary = createFakeAgentAdapter();
    const fallback = createNamedFakeAgentAdapter({
      id: "fake-agent-fallback",
      displayName: "Fake Agent Fallback"
    });

    const result = await supervisor.startSession({
      projectRoot,
      agent: primary,
      fallbacks: [fallback],
      scenario: "usage_limit",
      fallbackScenarios: ["success"]
    });

    const usageFile = await readFile(
      path.join(projectRoot, "fake-agent-output", "usage-limit.txt"),
      "utf8"
    );
    const successFile = await readFile(
      path.join(projectRoot, "fake-agent-output", "success.txt"),
      "utf8"
    );

    expect(result.classification.kind).toBe("usage_limit");
    expect(result.fallbackAgentId).toBe("fake-agent-fallback");
    expect(result.checkpoints).toHaveLength(2);
    expect(usageFile).toContain("edited before usage limit");
    expect(successFile).toContain("completed");
  });

  it("retries network failures once before failing over", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const primary = createFakeAgentAdapter();
    const fallback = createNamedFakeAgentAdapter({
      id: "fake-agent-fallback",
      displayName: "Fake Agent Fallback"
    });

    const result = await supervisor.startSession({
      projectRoot,
      agent: primary,
      fallbacks: [fallback],
      scenario: "network_failure",
      fallbackScenarios: ["success"],
      networkRetryCount: 1
    });

    expect(result.classification.kind).toBe("network_failure");
    expect(result.fallbackAgentId).toBe("fake-agent-fallback");
    expect(result.checkpoints).toHaveLength(2);
  });

  it("fails over on context-limit termination with a compact handoff path", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const primary = createFakeAgentAdapter();
    const fallback = createNamedFakeAgentAdapter({
      id: "fake-agent-fallback",
      displayName: "Fake Agent Fallback"
    });

    const result = await supervisor.startSession({
      projectRoot,
      agent: primary,
      fallbacks: [fallback],
      scenario: "context_limit",
      fallbackScenarios: ["success"]
    });

    expect(result.classification.kind).toBe("context_limit");
    expect(result.fallbackAgentId).toBe("fake-agent-fallback");
    expect(result.checkpoints).toHaveLength(2);
  });

  it("falls back on authentication failure only to a different vendor adapter", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const primary = createNamedFakeAgentAdapter({
      id: "claude-code",
      displayName: "Fake Claude"
    });
    const sameVendor = createNamedFakeAgentAdapter({
      id: "claude-code",
      displayName: "Fake Claude Same Vendor"
    });
    const differentVendor = createNamedFakeAgentAdapter({
      id: "codex",
      displayName: "Fake Codex"
    });

    const blocked = await supervisor.startSession({
      projectRoot,
      agent: primary,
      fallbacks: [sameVendor],
      scenario: "auth_failure"
    });

    expect(blocked.classification.kind).toBe("authentication_failure");
    expect(blocked.fallbackAgentId).toBeNull();

    const allowed = await supervisor.startSession({
      projectRoot: await createTempProject(),
      agent: primary,
      fallbacks: [differentVendor],
      scenario: "auth_failure",
      fallbackScenarios: ["success"]
    });

    expect(allowed.fallbackAgentId).toBe("codex");
  });

  it("enforces the failover loop limit", async () => {
    const projectRoot = await createTempProject();
    const supervisor = createRuntimeSupervisor();
    const primary = createFakeAgentAdapter();
    const fallbackA = createNamedFakeAgentAdapter({
      id: "fallback-a",
      displayName: "Fallback A"
    });
    const fallbackB = createNamedFakeAgentAdapter({
      id: "fallback-b",
      displayName: "Fallback B"
    });

    const result = await supervisor.startSession({
      projectRoot,
      agent: primary,
      fallbacks: [fallbackA, fallbackB],
      scenario: "usage_limit",
      fallbackScenarios: ["usage_limit", "usage_limit"],
      maxFailovers: 1
    });

    expect(result.fallbackAgentId).toBe("fallback-a");
    expect(result.checkpoints).toHaveLength(2);
  });
});
