import type {
  AgentScheduler,
  RegisteredAgent,
  SchedulingDecision,
  SchedulerRequest
} from "@acr/core";

function cooldownActive(candidate: RegisteredAgent): boolean {
  const expiresAt = candidate.health?.cooldownExpiresAt;
  return (
    typeof expiresAt === "string" && new Date(expiresAt).getTime() > Date.now()
  );
}

function excludedReasons(
  request: SchedulerRequest,
  candidate: RegisteredAgent
): string[] {
  const reasons: string[] = [];

  if (!candidate.installation.installed) {
    reasons.push("not_installed");
  }
  if (candidate.installation.authenticated === false) {
    reasons.push("authentication_unavailable");
  }
  if (candidate.metadata.health === "unavailable") {
    reasons.push("plugin_marked_unavailable");
  }
  if (candidate.health?.availability === "unavailable") {
    reasons.push("runtime_health_unavailable");
  }
  if (
    request.allowedAgentIds &&
    !request.allowedAgentIds.includes(candidate.id)
  ) {
    reasons.push("not_allowlisted");
  }
  if (request.deniedAgentIds?.includes(candidate.id)) {
    reasons.push("denylisted");
  }
  if (request.excludedAgentIds?.includes(candidate.id)) {
    reasons.push("explicitly_excluded");
  }
  if (
    request.requiredCapabilities &&
    request.requiredCapabilities.some((capability) => {
      return !candidate.metadata.capabilities.includes(capability);
    })
  ) {
    reasons.push("capability_mismatch");
  }
  if (
    request.preferredTransport &&
    !candidate.metadata.transportPreferences.includes(
      request.preferredTransport
    )
  ) {
    reasons.push("transport_mismatch");
  }
  if (
    request.currentAgentId &&
    request.currentAgentId === candidate.id &&
    !request.explicitReuseFailedAgent
  ) {
    reasons.push("same_as_current_agent");
  }
  if (
    typeof request.maxConsecutiveUses === "number" &&
    (candidate.health?.consecutiveUses ?? 0) >= request.maxConsecutiveUses
  ) {
    reasons.push("max_consecutive_uses_reached");
  }
  if (
    cooldownActive(candidate) &&
    !request.explicitReuseFailedAgent &&
    ["usage_limit", "authentication_failure", "context_limit"].includes(
      candidate.health?.lastFailureType ?? ""
    )
  ) {
    reasons.push("cooldown_active");
  }
  if (
    request.currentAgentId &&
    candidate.health?.lastFailureType &&
    ["usage_limit", "authentication_failure", "context_limit"].includes(
      candidate.health.lastFailureType
    ) &&
    candidate.id === request.currentAgentId &&
    !request.explicitReuseFailedAgent
  ) {
    reasons.push("failover_loop_prevention");
  }

  return reasons;
}

function sortCandidates(candidates: RegisteredAgent[]) {
  const costRank = { low: 0, medium: 1, high: 2 };
  const healthRank = {
    healthy: 0,
    unknown: 1,
    degraded: 2,
    cooldown: 3,
    unavailable: 4
  };

  return [...candidates].sort((left, right) => {
    if (left.metadata.priority !== right.metadata.priority) {
      return right.metadata.priority - left.metadata.priority;
    }

    const leftHealth = healthRank[left.metadata.health] ?? 5;
    const rightHealth = healthRank[right.metadata.health] ?? 5;
    if (leftHealth !== rightHealth) {
      return leftHealth - rightHealth;
    }

    if (left.metadata.costTier !== right.metadata.costTier) {
      return (
        costRank[left.metadata.costTier] - costRank[right.metadata.costTier]
      );
    }

    return left.id.localeCompare(right.id);
  });
}

export class PriorityAgentScheduler implements AgentScheduler {
  decide(
    request: SchedulerRequest,
    candidates: RegisteredAgent[]
  ): SchedulingDecision {
    const timestamp = new Date().toISOString();
    const excludedCandidates = candidates
      .map((candidate) => ({
        agentId: candidate.id,
        reasons: excludedReasons(request, candidate)
      }))
      .filter((candidate) => candidate.reasons.length > 0);

    const eligibleCandidates = sortCandidates(
      candidates.filter((candidate) => {
        return !excludedCandidates.some((excluded) => {
          return excluded.agentId === candidate.id;
        });
      })
    );

    const preferred = request.preferredAgentId
      ? eligibleCandidates.find(
          (candidate) => candidate.id === request.preferredAgentId
        )
      : undefined;
    const selected = preferred ?? eligibleCandidates[0];

    return {
      selectedAgentId: selected?.id ?? null,
      eligibleCandidates: eligibleCandidates.map((candidate) => candidate.id),
      excludedCandidates,
      policy: "priority-availability-health-cost",
      timestamp
    };
  }

  selectPrimary(
    request: SchedulerRequest,
    candidates: RegisteredAgent[]
  ): RegisteredAgent | undefined {
    const decision = this.decide(request, candidates);
    return candidates.find(
      (candidate) => candidate.id === decision.selectedAgentId
    );
  }

  selectNext(
    request: SchedulerRequest,
    candidates: RegisteredAgent[]
  ): RegisteredAgent | undefined {
    const decision = this.decide(
      {
        ...request,
        excludedAgentIds: [
          ...(request.excludedAgentIds ?? []),
          ...(request.currentAgentId ? [request.currentAgentId] : [])
        ]
      },
      candidates
    );
    return candidates.find(
      (candidate) => candidate.id === decision.selectedAgentId
    );
  }
}

export function createAgentScheduler() {
  return new PriorityAgentScheduler();
}
