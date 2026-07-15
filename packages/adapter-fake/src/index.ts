import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  AgentAdapter,
  AgentCapabilities,
  FailureClassification,
  LaunchInput,
  LaunchSpec,
  ResumeInstructionInput,
  TerminationEvidence
} from "@acr/core";
import { allowEnv } from "@acr/adapter-sdk";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

function resolveFakeAgentScriptPath(): string {
  const candidates = [
    path.resolve(packageDir, "./fake-agent.mjs"),
    path.resolve(packageDir, "../../test-fixtures/fake-agent.mjs")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate fake-agent.mjs. Checked: ${candidates.join(", ")}`
  );
}

export interface FakeAgentAdapterOptions {
  id?: string;
  displayName?: string;
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly id: string;
  readonly displayName: string;

  constructor(options: FakeAgentAdapterOptions = {}) {
    this.id = options.id ?? "fake-agent";
    this.displayName = options.displayName ?? "Fake Agent";
  }

  async detectInstallation() {
    return {
      installed: true,
      executablePath: process.execPath,
      details: "Bundled deterministic fake agent for tests."
    };
  }

  capabilities(): AgentCapabilities {
    return {
      interactive: true,
      usesMcp: false,
      supportsAutomaticFailoverHints: true
    };
  }

  async buildLaunchSpec(input: LaunchInput): Promise<LaunchSpec> {
    return {
      command: process.execPath,
      args: [resolveFakeAgentScriptPath()],
      cwd: input.projectRoot,
      env: {
        ...allowEnv(process.env, ["PATH", "HOME", "TMPDIR"]),
        ACR_FAKE_RESUME_INSTRUCTION: input.resumeInstruction,
        ACR_FAKE_SCENARIO: input.scenario ?? "success"
      }
    };
  }

  async classifyTermination(
    input: TerminationEvidence
  ): Promise<FailureClassification> {
    const output = input.output;

    if (
      input.signal === "SIGINT" ||
      input.exitCode === 130 ||
      output.includes("FAKE_SIGINT")
    ) {
      return {
        kind: "user_interrupt",
        confidence: "high",
        retryable: false,
        safeToFailover: false,
        evidence: ["Received SIGINT"],
        recommendedAction:
          "Stop the runtime unless interrupt failover is enabled.",
        failoverAppropriate: false,
        cooldownMs: null
      };
    }

    if (output.includes("FAKE_USAGE_LIMIT")) {
      return {
        kind: "usage_limit",
        confidence: "high",
        retryable: false,
        safeToFailover: true,
        evidence: ["FAKE_USAGE_LIMIT marker"],
        recommendedAction: "Fail over to the next configured adapter.",
        failoverAppropriate: true,
        cooldownMs: 30 * 60 * 1000
      };
    }

    if (output.includes("FAKE_AUTH_FAILURE")) {
      return {
        kind: "authentication_failure",
        confidence: "high",
        retryable: false,
        safeToFailover: true,
        evidence: ["FAKE_AUTH_FAILURE marker"],
        recommendedAction: "Fail over only to a different vendor adapter.",
        failoverAppropriate: true,
        cooldownMs: 60 * 60 * 1000
      };
    }

    if (output.includes("FAKE_NETWORK_FAILURE")) {
      return {
        kind: "network_failure",
        confidence: "high",
        retryable: true,
        safeToFailover: true,
        evidence: ["FAKE_NETWORK_FAILURE marker"],
        recommendedAction: "Retry once or fail over.",
        failoverAppropriate: true,
        cooldownMs: 5 * 60 * 1000
      };
    }

    if (output.includes("FAKE_CONTEXT_LIMIT")) {
      return {
        kind: "context_limit",
        confidence: "high",
        retryable: false,
        safeToFailover: true,
        evidence: ["FAKE_CONTEXT_LIMIT marker"],
        recommendedAction: "Fail over with a compact resume brief.",
        failoverAppropriate: true,
        cooldownMs: 10 * 60 * 1000
      };
    }

    if ((input.exitCode ?? 0) === 0) {
      return {
        kind: "normal_exit",
        confidence: "high",
        retryable: false,
        safeToFailover: false,
        evidence: ["Exit code 0"],
        recommendedAction: "Stop without failover.",
        failoverAppropriate: false,
        cooldownMs: null
      };
    }

    if (output.includes("FAKE_CRASH")) {
      return {
        kind: "process_crash",
        confidence: "high",
        retryable: false,
        safeToFailover: true,
        evidence: ["FAKE_CRASH marker"],
        recommendedAction: "Checkpoint and fail over.",
        failoverAppropriate: true,
        cooldownMs: null
      };
    }

    return {
      kind: "unknown",
      confidence: "low",
      retryable: false,
      safeToFailover: false,
      evidence: [`Exit code ${input.exitCode ?? "null"}`],
      recommendedAction: "Stop safely and require manual confirmation.",
      failoverAppropriate: false,
      cooldownMs: null
    };
  }

  async buildResumeInstruction(input: ResumeInstructionInput): Promise<string> {
    return input.brief.summary;
  }
}

export function createFakeAgentAdapter(): AgentAdapter {
  return new FakeAgentAdapter();
}

export function createNamedFakeAgentAdapter(
  options: FakeAgentAdapterOptions
): AgentAdapter {
  return new FakeAgentAdapter(options);
}
