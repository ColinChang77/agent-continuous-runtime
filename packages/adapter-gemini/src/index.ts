import type {
  AgentAdapter,
  AgentCapabilities,
  FailureClassification,
  LaunchInput,
  LaunchSpec,
  ResumeInstructionInput,
  TerminationEvidence
} from "@acr/core";
import { allowEnv, detectExecutableInstallation } from "@acr/adapter-sdk";

const GEMINI_ENV_KEYS = [
  "PATH",
  "HOME",
  "SHELL",
  "TERM",
  "COLORTERM",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY"
];

function classifyGemini(input: TerminationEvidence): FailureClassification {
  const output = input.output.toLowerCase();

  if (input.signal === "SIGINT") {
    return {
      kind: "user_interrupt",
      confidence: "high",
      retryable: false,
      safeToFailover: false,
      evidence: ["Received SIGINT"],
      recommendedAction: "Stop without failover by default.",
      failoverAppropriate: false,
      cooldownMs: null
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

  if (/quota|rate limit|resource exhausted|429/.test(output)) {
    return {
      kind: "usage_limit",
      confidence: "medium",
      retryable: false,
      safeToFailover: true,
      evidence: ["Matched quota/rate limit output"],
      recommendedAction: "Fail over to another eligible agent.",
      failoverAppropriate: true,
      cooldownMs: 30 * 60 * 1000
    };
  }

  if (/context|too long|token limit|maximum context/.test(output)) {
    return {
      kind: "context_limit",
      confidence: "medium",
      retryable: false,
      safeToFailover: true,
      evidence: ["Matched context-limit output"],
      recommendedAction: "Fail over with a compact recovery brief.",
      failoverAppropriate: true,
      cooldownMs: 10 * 60 * 1000
    };
  }

  if (/auth|login|credential|unauthorized|permission denied|403/.test(output)) {
    return {
      kind: "authentication_failure",
      confidence: "medium",
      retryable: false,
      safeToFailover: true,
      evidence: ["Matched authentication-related output"],
      recommendedAction:
        "Fail over to a different vendor or restore authentication.",
      failoverAppropriate: true,
      cooldownMs: 60 * 60 * 1000
    };
  }

  if (
    /network|econn|enotfound|timed out|timeout|unavailable|dns/.test(output)
  ) {
    return {
      kind: "network_failure",
      confidence: "medium",
      retryable: true,
      safeToFailover: true,
      evidence: ["Matched network-related output"],
      recommendedAction: "Retry conservatively or fail over.",
      failoverAppropriate: true,
      cooldownMs: 5 * 60 * 1000
    };
  }

  return {
    kind: "unknown",
    confidence: "low",
    retryable: false,
    safeToFailover: false,
    evidence: [`Exit code ${input.exitCode ?? "null"}`],
    recommendedAction: "Stop and require operator review.",
    failoverAppropriate: false,
    cooldownMs: null
  };
}

export class GeminiAdapter implements AgentAdapter {
  readonly id = "gemini";
  readonly displayName = "Gemini CLI";

  async detectInstallation() {
    return detectExecutableInstallation("gemini", ["--version"]);
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
      command: "gemini",
      args: ["--prompt-interactive", input.resumeInstruction, "--skip-trust"],
      cwd: input.projectRoot,
      env: allowEnv(process.env, GEMINI_ENV_KEYS)
    };
  }

  async classifyTermination(
    input: TerminationEvidence
  ): Promise<FailureClassification> {
    return classifyGemini(input);
  }

  async buildResumeInstruction(input: ResumeInstructionInput): Promise<string> {
    return [
      input.brief.summary,
      "",
      `Next action: ${input.brief.nextAction}`
    ].join("\n");
  }
}

export function createGeminiAdapter(): AgentAdapter {
  return new GeminiAdapter();
}
