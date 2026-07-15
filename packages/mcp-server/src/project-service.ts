import path from "node:path";

import {
  type CheckpointSummary,
  type ContinuityStore,
  type CurrentState,
  type DocumentName
} from "@acr/core";
import {
  applyAutomaticConversationMemory,
  createResumeEngine,
  createRepositoryInspector,
  createStatusDigest
} from "@acr/runtime";
import {
  createLocalStore,
  mergeManagedBlock,
  renderAgentsManagedBlock,
  renderClaudeManagedBlock,
  validateProjectState
} from "@acr/storage-local";

import { AcrToolError } from "./errors.js";

function nowIso(): string {
  return new Date().toISOString();
}

type StatePatch = Partial<
  Omit<
    CurrentState,
    | "objective"
    | "activeTask"
    | "touchedFiles"
    | "verification"
    | "recovery"
    | "conversationMemory"
  >
> & {
  objective?: Partial<CurrentState["objective"]>;
  activeTask?: Partial<CurrentState["activeTask"]>;
  touchedFiles?: Partial<CurrentState["touchedFiles"]>;
  verification?: Partial<CurrentState["verification"]>;
  recovery?: Partial<CurrentState["recovery"]>;
  conversationMemory?: Partial<CurrentState["conversationMemory"]>;
};

export interface ProjectServiceOptions {
  store?: ContinuityStore;
}

export class ProjectService {
  readonly store: ContinuityStore;
  readonly inspector = createRepositoryInspector();
  readonly resumeEngine: ReturnType<typeof createResumeEngine>;

  constructor(options: ProjectServiceOptions = {}) {
    this.store = options.store ?? createLocalStore();
    this.resumeEngine = createResumeEngine(this.store, this.inspector);
  }

  async refreshRepositoryEvidence(projectRoot: string): Promise<CurrentState> {
    const [currentState, snapshot, diff] = await Promise.all([
      this.store.readCurrentState(projectRoot),
      this.inspector.inspect(projectRoot),
      this.inspector.diff(projectRoot)
    ]);

    return this.store.writeCurrentState(
      projectRoot,
      {
        ...currentState,
        repositoryEvidence: {
          head: snapshot.head,
          branch: snapshot.branch,
          isDirty: snapshot.isDirty,
          statusDigest: createStatusDigest(snapshot),
          diffDigest: diff.text
            ? createStatusDigest({ ...snapshot, statusText: diff.text })
            : null,
          capturedAt: snapshot.capturedAt
        }
      },
      currentState.revision
    );
  }

  async inspectProject(projectRoot: string) {
    const [state, snapshot, reconcile] = await Promise.all([
      this.store.readCurrentState(projectRoot),
      this.inspector.inspect(projectRoot),
      this.resumeEngine.reconcile(projectRoot)
    ]);

    return {
      snapshot,
      reconcile,
      stateRevision: state.revision,
      activeTask: state.activeTask,
      warnings: reconcile.warnings
    };
  }

  async resumeProject(projectRoot: string, repairSafeDrift = false) {
    const reconcile = await this.resumeEngine.reconcile(projectRoot);
    if (
      repairSafeDrift &&
      (reconcile.drift === "stale_state" || reconcile.drift === "benign")
    ) {
      await this.refreshRepositoryEvidence(projectRoot);
    }

    const [brief, state] = await Promise.all([
      this.resumeEngine.generate(projectRoot),
      this.store.readCurrentState(projectRoot)
    ]);

    return {
      brief,
      stateRevision: state.revision
    };
  }

  async validate(projectRoot: string) {
    const issues = await validateProjectState(projectRoot);
    const reconcile = await this.resumeEngine.reconcile(projectRoot);
    for (const warning of reconcile.warnings) {
      issues.push({ severity: "warning", message: warning });
    }

    return {
      issues,
      drift: reconcile.drift,
      changedFiles: reconcile.changedFiles
    };
  }

  async repair(projectRoot: string, safe = false) {
    if (!safe) {
      throw new AcrToolError(
        "ACR_UNSAFE_REPAIR",
        "Only safe, deterministic repairs are implemented."
      );
    }

    const repaired: string[] = [];
    const updatedState = await this.refreshRepositoryEvidence(projectRoot);
    repaired.push(".agent/CURRENT_STATE.json");

    const brief = await this.resumeEngine.generate(projectRoot);
    await this.store.writeDocument(
      projectRoot,
      "RECENT_CONTEXT.md",
      `${brief.summary}\n`
    );
    repaired.push(".agent/RECENT_CONTEXT.md");

    const agentsPath = path.join(projectRoot, "AGENTS.md");
    const claudePath = path.join(projectRoot, "CLAUDE.md");
    const existingAgents = await this.readOptional(agentsPath);
    const existingClaude = await this.readOptional(claudePath);
    await this.writeFileText(
      agentsPath,
      mergeManagedBlock(existingAgents, renderAgentsManagedBlock()).content
    );
    await this.writeFileText(
      claudePath,
      mergeManagedBlock(existingClaude, renderClaudeManagedBlock()).content
    );
    repaired.push("AGENTS.md", "CLAUDE.md");

    return {
      repaired,
      stateRevision: updatedState.revision
    };
  }

  async updateState(
    projectRoot: string,
    expectedRevision: number,
    patch: StatePatch
  ): Promise<CurrentState> {
    const current = await this.store.readCurrentState(projectRoot);
    const next: CurrentState = {
      ...current,
      ...patch,
      objective: patch.objective
        ? { ...current.objective, ...patch.objective }
        : current.objective,
      activeTask: patch.activeTask
        ? { ...current.activeTask, ...patch.activeTask }
        : current.activeTask,
      touchedFiles: patch.touchedFiles
        ? { ...current.touchedFiles, ...patch.touchedFiles }
        : current.touchedFiles,
      verification: patch.verification
        ? { ...current.verification, ...patch.verification }
        : current.verification,
      conversationMemory: patch.conversationMemory
        ? { ...current.conversationMemory, ...patch.conversationMemory }
        : current.conversationMemory,
      recovery: patch.recovery
        ? { ...current.recovery, ...patch.recovery }
        : current.recovery
    };

    return this.store.writeCurrentState(projectRoot, next, expectedRevision);
  }

  async createCheckpoint(
    projectRoot: string,
    reason: string,
    summary: string,
    nextAction: string,
    safeToResume = true
  ): Promise<{ checkpoint: CheckpointSummary; state: CurrentState }> {
    const refreshed = await this.refreshRepositoryEvidence(projectRoot);
    const checkpointId = `${nowIso().replaceAll(":", "-")}_${reason.replace(/\s+/g, "-")}`;
    const checkpoint = await this.store.createCheckpoint(projectRoot, {
      checkpointId,
      reason,
      summary,
      handoff: nextAction,
      currentState: refreshed,
      safeToResume
    });

    const updated = await this.store.writeCurrentState(
      projectRoot,
      {
        ...refreshed,
        activeTask: {
          ...refreshed.activeTask,
          lastCheckpointId: checkpoint.checkpointId
        }
      },
      refreshed.revision
    );

    return { checkpoint, state: updated };
  }

  async appendProgress(
    projectRoot: string,
    entry: {
      agent: string;
      task: string;
      changes: string;
      verification: string;
      remainingWork: string;
    }
  ): Promise<void> {
    const existing = await this.store.readDocument(projectRoot, "PROGRESS.md");
    const block = [
      `## ${nowIso()} — ${entry.agent}`,
      `- Task: ${entry.task}`,
      `- Changes: ${entry.changes}`,
      `- Verification: ${entry.verification}`,
      `- Remaining work: ${entry.remainingWork}`,
      ""
    ].join("\n");
    await this.store.writeDocument(
      projectRoot,
      "PROGRESS.md",
      `${existing.trimEnd()}\n\n${block}`
    );
  }

  async appendDecision(
    projectRoot: string,
    decision: {
      id: string;
      title: string;
      agent: string;
      status: "proposed" | "accepted" | "superseded" | "rejected";
      context: string;
      decision: string;
      alternatives: string;
      consequences: string;
      relatedFiles: string[];
    }
  ): Promise<void> {
    const existing = await this.store.readDocument(projectRoot, "DECISIONS.md");
    const block = [
      `## ${decision.id} — ${decision.title}`,
      `- Date: ${nowIso().slice(0, 10)}`,
      `- Agent: ${decision.agent}`,
      `- Status: ${decision.status}`,
      `- Context: ${decision.context}`,
      `- Decision: ${decision.decision}`,
      `- Alternatives: ${decision.alternatives}`,
      `- Consequences: ${decision.consequences}`,
      `- Related files: ${decision.relatedFiles.join(", ") || "none"}`,
      ""
    ].join("\n");
    await this.store.writeDocument(
      projectRoot,
      "DECISIONS.md",
      `${existing.trimEnd()}\n\n${block}`
    );
  }

  async readResource(projectRoot: string, name: DocumentName) {
    return this.store.readDocument(projectRoot, name);
  }

  async recordConversationMemory(
    projectRoot: string,
    expectedRevision: number,
    memory: {
      userIntent?: string;
      userConstraints?: string[];
      userPreferences?: string[];
      rejectedApproaches?: string[];
      openQuestions?: string[];
      importantContext?: string[];
    }
  ): Promise<CurrentState> {
    const normalizeList = (values?: string[]) =>
      (values ?? []).map((value) => value.trim()).filter(Boolean);

    return this.updateState(projectRoot, expectedRevision, {
      conversationMemory: {
        ...(typeof memory.userIntent === "string"
          ? { userIntent: memory.userIntent.trim() }
          : {}),
        ...(memory.userConstraints
          ? { userConstraints: normalizeList(memory.userConstraints) }
          : {}),
        ...(memory.userPreferences
          ? { userPreferences: normalizeList(memory.userPreferences) }
          : {}),
        ...(memory.rejectedApproaches
          ? {
              rejectedApproaches: normalizeList(memory.rejectedApproaches)
            }
          : {}),
        ...(memory.openQuestions
          ? { openQuestions: normalizeList(memory.openQuestions) }
          : {}),
        ...(memory.importantContext
          ? { importantContext: normalizeList(memory.importantContext) }
          : {})
      }
    });
  }

  async autoRecordHandoffMemory(
    projectRoot: string,
    input: {
      agentId?: string;
      targetAgentId?: string;
      failureKind?: Parameters<
        typeof applyAutomaticConversationMemory
      >[1]["failureKind"];
      handoffSummary?: string;
      nextAction?: string;
      changedFiles?: string[];
    }
  ): Promise<CurrentState> {
    const current = await this.store.readCurrentState(projectRoot);
    const normalizedInput = {
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.targetAgentId !== undefined
        ? { targetAgentId: input.targetAgentId }
        : {}),
      ...(input.failureKind !== undefined
        ? { failureKind: input.failureKind }
        : {}),
      ...(input.handoffSummary !== undefined
        ? { handoffSummary: input.handoffSummary }
        : {}),
      ...(input.nextAction !== undefined
        ? { nextAction: input.nextAction }
        : {}),
      ...(input.changedFiles !== undefined
        ? { changedFiles: input.changedFiles }
        : {})
    };
    return this.store.writeCurrentState(
      projectRoot,
      {
        ...current,
        conversationMemory: applyAutomaticConversationMemory(
          current,
          normalizedInput
        )
      },
      current.revision
    );
  }

  async listCheckpoints(projectRoot: string) {
    return this.store.listCheckpoints(projectRoot, 50);
  }

  private async readOptional(filePath: string): Promise<string> {
    try {
      const { readFile } = await import("node:fs/promises");
      return await readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }

  private async writeFileText(
    filePath: string,
    content: string
  ): Promise<void> {
    const { atomicWriteFile } = await import("@acr/storage-local");
    await atomicWriteFile(
      filePath,
      content.endsWith("\n") ? content : `${content}\n`
    );
  }
}
