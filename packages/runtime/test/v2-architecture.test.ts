import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  pluginApiVersion,
  type AgentPlugin,
  type RegisteredAgent,
  type TransportMode
} from "@acr/core";
import { createFakeAgentAdapter } from "@acr/adapter-fake";

import {
  createAgentHealthStore,
  createAgentRegistry,
  createAgentScheduler,
  createFailureClassifier,
  createRuntimeEventPipeline,
  createRuntimeLauncher
} from "../src/index.js";

function pluginFor(id: string, displayName = id): AgentPlugin {
  return {
    manifest: {
      pluginId: `${id}.plugin`,
      displayName: `${displayName} Plugin`,
      version: "2.0.0",
      acrApiVersion: pluginApiVersion,
      agentId: id,
      agentDisplayName: displayName,
      declaredCapabilities: [],
      supportedTransports: ["pty", "stdio", "spawn"] as TransportMode[],
      executable: {
        command: process.execPath,
        args: ["--version"]
      }
    },
    createAdapter: () => createFakeAgentAdapter()
  };
}

function candidate(
  id: string,
  priority: number,
  options: {
    installed?: boolean;
    authenticated?: boolean | "unknown";
    capabilities?: string[];
    cooldownFailureType?:
      "usage_limit" | "authentication_failure" | "context_limit";
    cooldownActive?: boolean;
    consecutiveUses?: number;
  } = {}
): RegisteredAgent {
  return {
    id,
    displayName: id,
    adapter: createFakeAgentAdapter(),
    plugin: pluginFor(id),
    installation: {
      installed: options.installed ?? true,
      executablePath: (options.installed ?? true) ? `/tmp/${id}` : null,
      authenticated: options.authenticated ?? "unknown"
    },
    metadata: {
      priority,
      health: "healthy",
      costTier: "medium",
      vendor: id,
      capabilities: options.capabilities ?? [],
      transportPreferences: ["pty", "stdio", "spawn"]
    },
    health: {
      agentId: id,
      lastSuccessfulLaunchAt: null,
      lastSuccessfulCompletionAt: null,
      lastFailureAt: null,
      lastFailureType: options.cooldownFailureType ?? null,
      consecutiveFailures: 0,
      consecutiveUses: options.consecutiveUses ?? 0,
      cooldownStartedAt: options.cooldownActive
        ? new Date().toISOString()
        : null,
      cooldownExpiresAt: options.cooldownActive
        ? new Date(Date.now() + 60_000).toISOString()
        : null,
      availability: options.cooldownActive ? "cooldown" : "available",
      lastHealthCheck: null,
      recentFailures: []
    }
  };
}

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acr-v2-runtime-"));
}

describe("V2 event pipeline", () => {
  it("keeps ordered bounded history and isolates subscriber failures", () => {
    const pipeline = createRuntimeEventPipeline({ maxEvents: 2 });
    const seen: string[] = [];
    pipeline.subscribe(() => {
      throw new Error("subscriber failure");
    });
    pipeline.subscribe((event) => {
      seen.push(event.type);
    });

    pipeline.emit({
      type: "ResumeStarted",
      agentId: "a"
    });
    pipeline.emit({
      type: "ResumeFinished",
      agentId: "a"
    });
    pipeline.emit({
      type: "UnknownFailure",
      agentId: "a",
      evidence: ["token=sk-secret-value"],
      confidence: "low",
      failoverAppropriate: false,
      retryable: false,
      cooldownMs: null
    });

    expect(seen).toEqual(["ResumeStarted", "ResumeFinished", "UnknownFailure"]);
    expect(pipeline.list()).toHaveLength(2);
    expect(pipeline.list()[0]?.type).toBe("ResumeFinished");
    expect(JSON.stringify(pipeline.list()[1]).includes("sk-secret-value")).toBe(
      false
    );
    expect(pipeline.replay()).toHaveLength(2);
  });

  it("persists serialized events when configured", async () => {
    const projectRoot = await createTempProject();
    const pipeline = createRuntimeEventPipeline({
      projectRoot,
      persist: true,
      sessionId: "session-test",
      runId: "run-test"
    });

    pipeline.emit({
      type: "ResumeStarted",
      agentId: "a"
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const persisted = await readFile(
      path.join(projectRoot, ".acr", "events", "session-test.jsonl"),
      "utf8"
    );

    expect(persisted).toContain('"type":"ResumeStarted"');
    expect(persisted).toContain('"sequence":1');
  });
});

describe("V2 scheduler", () => {
  it("selects by priority during normal operation", () => {
    const scheduler = createAgentScheduler();
    const decision = scheduler.decide({}, [
      candidate("gemini", 90),
      candidate("codex", 100)
    ]);

    expect(decision.selectedAgentId).toBe("codex");
    expect(decision.eligibleCandidates).toEqual(["codex", "gemini"]);
  });

  it("excludes unavailable preferred agents and explains why", () => {
    const scheduler = createAgentScheduler();
    const decision = scheduler.decide({ preferredAgentId: "codex" }, [
      candidate("codex", 100, { installed: false }),
      candidate("gemini", 90)
    ]);

    expect(decision.selectedAgentId).toBe("gemini");
    expect(decision.excludedCandidates).toContainEqual({
      agentId: "codex",
      reasons: ["not_installed"]
    });
  });

  it("enforces usage-limit cooldowns and failover loop prevention", () => {
    const scheduler = createAgentScheduler();
    const decision = scheduler.decide({ currentAgentId: "claude-code" }, [
      candidate("claude-code", 100, {
        cooldownFailureType: "usage_limit",
        cooldownActive: true
      }),
      candidate("codex", 90)
    ]);

    expect(decision.selectedAgentId).toBe("codex");
    expect(
      decision.excludedCandidates.find(
        (entry) => entry.agentId === "claude-code"
      )?.reasons
    ).toContain("cooldown_active");
  });

  it("excludes unauthenticated agents, capability mismatches, and max consecutive use overflow", () => {
    const scheduler = createAgentScheduler();
    const decision = scheduler.decide(
      {
        requiredCapabilities: ["repo-write"],
        maxConsecutiveUses: 1
      },
      [
        candidate("claude-code", 100, {
          authenticated: false,
          capabilities: ["repo-write"]
        }),
        candidate("codex", 90, {
          capabilities: ["read-only"],
          consecutiveUses: 2
        }),
        candidate("gemini", 80, {
          capabilities: ["repo-write"]
        })
      ]
    );

    expect(decision.selectedAgentId).toBe("gemini");
    expect(decision.excludedCandidates).toEqual(
      expect.arrayContaining([
        {
          agentId: "claude-code",
          reasons: ["authentication_unavailable"]
        },
        {
          agentId: "codex",
          reasons: ["capability_mismatch", "max_consecutive_uses_reached"]
        }
      ])
    );
  });

  it("returns no selection when all agents are unavailable", () => {
    const scheduler = createAgentScheduler();
    const decision = scheduler.decide({}, [
      candidate("claude-code", 100, { installed: false }),
      candidate("codex", 90, { authenticated: false })
    ]);

    expect(decision.selectedAgentId).toBeNull();
  });
});

describe("V2 failure classifier", () => {
  it("centralizes adapter classification and exposes normalized failure events", async () => {
    const classifier = createFailureClassifier();
    const adapter = createFakeAgentAdapter();
    const classification = await classifier.classify({
      agent: adapter,
      stdout: "FAKE_USAGE_LIMIT",
      stderr: "",
      exitCode: 1,
      signal: null,
      events: []
    });

    expect(classification.kind).toBe("usage_limit");
    expect(classifier.toEvent(adapter.id, classification)?.type).toBe(
      "UsageLimitDetected"
    );
    const event = classifier.toEvent(adapter.id, classification);
    expect(event && "cooldownMs" in event ? event.cooldownMs : null).toBe(
      30 * 60 * 1000
    );
  });
});

describe("V2 launcher, registry, and health persistence", () => {
  it("registers validated plugins into a dynamic agent pool", async () => {
    const registry = createAgentRegistry();
    await registry.register(pluginFor("fake-agent", "Fake Agent"));

    const launcher = await createRuntimeLauncher({
      plugins: [pluginFor("another-fake-agent", "Another Fake Agent")]
    });

    expect(registry.get("fake-agent")?.id).toBe("fake-agent");
    expect(launcher.registry().get("another-fake-agent")?.id).toBe(
      "another-fake-agent"
    );
  });

  it("rejects incompatible plugins without crashing registration", async () => {
    const registry = createAgentRegistry();
    const registered = await registry.register({
      manifest: {
        ...pluginFor("broken-agent").manifest,
        acrApiVersion: "9.9.9"
      },
      createAdapter: () => createFakeAgentAdapter()
    });

    expect(registered).toBeNull();
  });

  it("persists health records across store reads", async () => {
    const projectRoot = await createTempProject();
    const store = createAgentHealthStore();

    await store.markLaunch(projectRoot, "fake-agent");
    await store.markFailure(projectRoot, "fake-agent", "usage_limit", 60_000);

    const record = await store.read(projectRoot, "fake-agent");
    expect(record.lastFailureType).toBe("usage_limit");
    expect(record.cooldownExpiresAt).toBeTruthy();
  });
});
