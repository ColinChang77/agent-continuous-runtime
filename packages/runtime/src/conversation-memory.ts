import type { CurrentState, FailureKind } from "@acr/core";

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export interface AutoConversationMemoryInput {
  agentId?: string;
  targetAgentId?: string;
  failureKind?: FailureKind | "switch";
  handoffSummary?: string;
  nextAction?: string;
  changedFiles?: string[];
}

export function applyAutomaticConversationMemory(
  state: CurrentState,
  input: AutoConversationMemoryInput
): CurrentState["conversationMemory"] {
  const memory = state.conversationMemory;
  const importantContext = [...memory.importantContext];
  const openQuestions = [...memory.openQuestions];

  if (input.agentId) {
    const route = input.targetAgentId
      ? `${input.agentId} -> ${input.targetAgentId}`
      : input.agentId;
    const reason = input.failureKind ? ` because of ${input.failureKind}` : "";
    importantContext.push(`Last handoff route: ${route}${reason}.`);
  }

  if (input.handoffSummary) {
    importantContext.push(`Latest handoff summary: ${input.handoffSummary}`);
  }

  const nextAction = input.nextAction || state.recovery.resumeFrom;
  if (nextAction) {
    openQuestions.push(`Next requested action: ${nextAction}`);
  }

  if ((input.changedFiles ?? []).length > 0) {
    importantContext.push(
      `Files in flight at handoff: ${(input.changedFiles ?? []).join(", ")}`
    );
  }

  return {
    userIntent: memory.userIntent.trim() || state.objective.summary,
    userConstraints: unique([
      ...memory.userConstraints,
      ...state.objective.constraints
    ]),
    userPreferences: unique(memory.userPreferences),
    rejectedApproaches: unique(memory.rejectedApproaches),
    openQuestions: unique(openQuestions),
    importantContext: unique(importantContext)
  };
}
