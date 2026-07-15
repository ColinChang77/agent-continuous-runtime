import type {
  FailureClassification,
  FailureClassifier,
  FailureClassifierInput,
  RuntimeEventInput
} from "@acr/core";

function sanitizedEvidence(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      return line
        .replace(/\b(sk-[A-Za-z0-9_-]{10,})\b/g, "[REDACTED]")
        .replace(/\b(Bearer\s+)([A-Za-z0-9._-]+)/gi, "$1[REDACTED]")
        .slice(0, 200);
    })
    .slice(0, 5);
}

function eventForFailure(
  agentId: string,
  classification: FailureClassification
): RuntimeEventInput | null {
  switch (classification.kind) {
    case "usage_limit":
      return {
        type: "UsageLimitDetected",
        agentId,
        evidence: sanitizedEvidence(classification.evidence),
        confidence: classification.confidence,
        failoverAppropriate:
          classification.failoverAppropriate ?? classification.safeToFailover,
        retryable: classification.retryable,
        cooldownMs: classification.cooldownMs ?? 30 * 60 * 1000
      };
    case "context_limit":
      return {
        type: "ContextLimitDetected",
        agentId,
        evidence: sanitizedEvidence(classification.evidence),
        confidence: classification.confidence,
        failoverAppropriate:
          classification.failoverAppropriate ?? classification.safeToFailover,
        retryable: classification.retryable,
        cooldownMs: classification.cooldownMs ?? 10 * 60 * 1000
      };
    case "authentication_failure":
      return {
        type: "AuthenticationFailure",
        agentId,
        evidence: sanitizedEvidence(classification.evidence),
        confidence: classification.confidence,
        failoverAppropriate:
          classification.failoverAppropriate ?? classification.safeToFailover,
        retryable: classification.retryable,
        cooldownMs: classification.cooldownMs ?? 60 * 60 * 1000
      };
    case "network_failure":
      return {
        type: "NetworkFailure",
        agentId,
        evidence: sanitizedEvidence(classification.evidence),
        confidence: classification.confidence,
        failoverAppropriate:
          classification.failoverAppropriate ?? classification.safeToFailover,
        retryable: classification.retryable,
        cooldownMs: classification.cooldownMs ?? 5 * 60 * 1000
      };
    case "unknown":
      return {
        type: "UnknownFailure",
        agentId,
        evidence: sanitizedEvidence(classification.evidence),
        confidence: classification.confidence,
        failoverAppropriate:
          classification.failoverAppropriate ?? classification.safeToFailover,
        retryable: classification.retryable,
        cooldownMs: classification.cooldownMs ?? null
      };
    default:
      return null;
  }
}

export class DefaultFailureClassifier implements FailureClassifier {
  async classify(
    input: FailureClassifierInput
  ): Promise<FailureClassification> {
    const classification = await input.agent.classifyTermination({
      exitCode: input.exitCode,
      signal: input.signal,
      stdout: input.stdout,
      stderr: input.stderr,
      output: [input.stdout, input.stderr].filter(Boolean).join("\n"),
      ...(typeof input.timedOut === "boolean"
        ? { timedOut: input.timedOut }
        : {}),
      ...(input.transportError ? { transportError: input.transportError } : {}),
      ...(input.structuredEvents
        ? { structuredEvents: input.structuredEvents }
        : {})
    });

    const relevantEvents = input.events.filter((event) => {
      return (
        event.type === "UsageLimitDetected" ||
        event.type === "ContextLimitDetected" ||
        event.type === "AuthenticationFailure" ||
        event.type === "NetworkFailure" ||
        event.type === "UnknownFailure"
      );
    });

    const evidence = sanitizedEvidence([
      ...classification.evidence,
      ...relevantEvents.flatMap((event) => {
        return "evidence" in event ? event.evidence : [];
      }),
      input.transportError ?? "",
      ...(input.timedOut ? ["process timed out"] : [])
    ]);

    return {
      ...classification,
      evidence,
      confidence:
        relevantEvents.length > 0 && classification.confidence === "low"
          ? "medium"
          : classification.confidence,
      cooldownMs:
        classification.cooldownMs ??
        (classification.kind === "usage_limit"
          ? 30 * 60 * 1000
          : classification.kind === "authentication_failure"
            ? 60 * 60 * 1000
            : classification.kind === "context_limit"
              ? 10 * 60 * 1000
              : classification.kind === "network_failure"
                ? 5 * 60 * 1000
                : null),
      failoverAppropriate:
        classification.failoverAppropriate ?? classification.safeToFailover
    };
  }

  toEvent(agentId: string, classification: FailureClassification) {
    return eventForFailure(agentId, classification);
  }
}

export function createFailureClassifier() {
  return new DefaultFailureClassifier();
}
