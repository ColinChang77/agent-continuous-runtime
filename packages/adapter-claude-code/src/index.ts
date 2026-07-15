import type {
  AgentAdapter,
  AgentCapabilities,
  FailureClassification,
  LaunchInput,
  LaunchSpec,
  ResumeInstructionInput,
  TerminationEvidence
} from "@acr/core";
import {
  allowEnv,
  detectExecutableInstallation,
  safeArgs
} from "@acr/adapter-sdk";

const CLAUDE_ENV_KEYS = [
  "PATH",
  "HOME",
  "SHELL",
  "TERM",
  "COLORTERM",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY"
];

function classifyOutput(
  input: TerminationEvidence,
  label: string
): FailureClassification {
  const output = input.output.toLowerCase();

  if (input.signal === "SIGINT") {
    return {
      kind: "user_interrupt",
      confidence: "high",
      retryable: false,
      safeToFailover: false,
      evidence: ["Received SIGINT"],
      recommendedAction: `Stop ${label} without failover by default.`,
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

  if (/usage limit|rate limit|quota/.test(output)) {
    return {
      kind: "usage_limit",
      confidence: "medium",
      retryable: false,
      safeToFailover: true,
      evidence: ["Matched usage/rate/quota output"],
      recommendedAction: "Checkpoint and fail over to another adapter.",
      failoverAppropriate: true,
      cooldownMs: 30 * 60 * 1000
    };
  }

  if (/context limit|max context|too long/.test(output)) {
    return {
      kind: "context_limit",
      confidence: "medium",
      retryable: false,
      safeToFailover: true,
      evidence: ["Matched context-limit output"],
      recommendedAction: "Fail over with a compact resume brief.",
      failoverAppropriate: true,
      cooldownMs: 10 * 60 * 1000
    };
  }

  if (/auth|login|credential|token/.test(output)) {
    return {
      kind: "authentication_failure",
      confidence: "medium",
      retryable: false,
      safeToFailover: true,
      evidence: ["Matched authentication-related output"],
      recommendedAction: "Fail over only to a different vendor adapter.",
      failoverAppropriate: true,
      cooldownMs: 60 * 60 * 1000
    };
  }

  if (/network|econn|enotfound|timed out|timeout/.test(output)) {
    return {
      kind: "network_failure",
      confidence: "medium",
      retryable: true,
      safeToFailover: true,
      evidence: ["Matched network-related output"],
      recommendedAction: "Retry once or fail over.",
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
    recommendedAction: "Stop safely and require confirmation.",
    failoverAppropriate: false,
    cooldownMs: null
  };
}

export interface ClaudeCodeAdapterOptions {
  /** Adapter id. Defaults to "claude-code". Use a distinct id for alt accounts. */
  id?: string;
  /** Human-readable name shown in `adapters list`. */
  displayName?: string;
  /**
   * Environment overrides merged on top of the allow-listed process env when
   * launching `claude`. Use this to point at a different account, e.g. a
   * separate `HOME` (so `claude` reads a different `~/.claude` credential
   * store) or a different `ANTHROPIC_API_KEY`. Undefined/empty values are
   * ignored, so callers can pass `process.env.SOMETHING` without guarding.
   */
  envOverrides?: Record<string, string | undefined>;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  private readonly envOverrides: Record<string, string>;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.id = options.id ?? "claude-code";
    this.displayName = options.displayName ?? "Claude Code";
    this.envOverrides = {};
    for (const [key, value] of Object.entries(options.envOverrides ?? {})) {
      if (typeof value === "string" && value.length > 0) {
        this.envOverrides[key] = value;
      }
    }
  }

  async detectInstallation() {
    return detectExecutableInstallation("claude");
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
      command: "claude",
      args: safeArgs(input.resumeInstruction),
      cwd: input.projectRoot,
      env: { ...allowEnv(process.env, CLAUDE_ENV_KEYS), ...this.envOverrides }
    };
  }

  async classifyTermination(
    input: TerminationEvidence
  ): Promise<FailureClassification> {
    return classifyOutput(input, this.displayName);
  }

  async buildResumeInstruction(input: ResumeInstructionInput): Promise<string> {
    return input.brief.summary;
  }
}

export const claudeCodeAdapterDescriptor = {
  id: "claude-code",
  displayName: "Claude Code",
  description: "Anthropic Claude Code adapter."
};

export function createClaudeCodeAdapter(
  options?: ClaudeCodeAdapterOptions
): AgentAdapter {
  return new ClaudeCodeAdapter(options);
}
