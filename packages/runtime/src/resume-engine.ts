import {
  type ContinuityStore,
  type DriftClass,
  type ReconcileResult,
  type RepositoryInspector,
  type ResumeBrief,
  type ResumeEngine,
  type VerificationFreshness
} from "@acr/core";

import {
  createDiffDigest,
  createRepositoryInspector,
  createStatusDigest
} from "./repository-inspector.js";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nonEmpty(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function verificationFreshness(
  state: Awaited<ReturnType<ContinuityStore["readCurrentState"]>>,
  currentEvidence: {
    head: string | null;
    branch: string | null;
    statusDigest: string;
    diffDigest: string | null;
  }
): VerificationFreshness {
  if (
    state.verification.passed.length === 0 &&
    state.verification.failed.length === 0
  ) {
    return "not_run";
  }

  const recorded = state.verification.repositoryEvidence;
  if (!recorded) return "unbound";

  return recorded.head === currentEvidence.head &&
    recorded.branch === currentEvidence.branch &&
    recorded.statusDigest === currentEvidence.statusDigest &&
    recorded.diffDigest === currentEvidence.diffDigest
    ? "current"
    : "stale";
}

export class DefaultResumeEngine implements ResumeEngine {
  constructor(
    private readonly store: ContinuityStore,
    private readonly inspector: RepositoryInspector = createRepositoryInspector()
  ) {}

  async reconcile(projectRoot: string): Promise<ReconcileResult> {
    const [state, snapshot, diff] = await Promise.all([
      this.store.readCurrentState(projectRoot),
      this.inspector.inspect(projectRoot),
      this.inspector.diff(projectRoot)
    ]);

    const changedFiles = unique([
      ...snapshot.stagedPaths,
      ...snapshot.unstagedPaths,
      ...snapshot.untrackedPaths
    ]);
    const expectedTouched = new Set([
      ...state.touchedFiles.created,
      ...state.touchedFiles.modified,
      ...state.touchedFiles.deleted
    ]);
    const currentDigest = createStatusDigest(snapshot);
    const currentDiffDigest = createDiffDigest(diff);
    const warnings: string[] = [];

    let drift: DriftClass = "none";
    if (
      snapshot.isDirty &&
      changedFiles.every((file) => expectedTouched.has(file))
    ) {
      drift = "benign";
    } else if (snapshot.isDirty) {
      drift = "partial_edit";
      warnings.push(
        "Working tree contains changes not fully described by the stored continuity state."
      );
    } else if (
      state.repositoryEvidence.statusDigest !== currentDigest ||
      state.repositoryEvidence.diffDigest !== currentDiffDigest ||
      state.repositoryEvidence.head !== snapshot.head ||
      state.repositoryEvidence.branch !== snapshot.branch
    ) {
      drift = "stale_state";
      warnings.push(
        "Stored repository evidence is stale relative to the current repository."
      );
    }

    const verificationStatus = verificationFreshness(state, {
      head: snapshot.head,
      branch: snapshot.branch,
      statusDigest: currentDigest,
      diffDigest: currentDiffDigest
    });
    if (verificationStatus === "stale") {
      warnings.push(
        "Recorded verification evidence is stale because the repository changed after it was captured."
      );
    } else if (verificationStatus === "unbound") {
      warnings.push(
        "Recorded verification results predate repository-bound evidence and cannot be proven current."
      );
    }

    return {
      drift,
      changedFiles,
      warnings,
      verificationFreshness: verificationStatus
    };
  }

  async generate(projectRoot: string): Promise<ResumeBrief> {
    const [state, snapshot, reconcileResult] = await Promise.all([
      this.store.readCurrentState(projectRoot),
      this.inspector.inspect(projectRoot),
      this.reconcile(projectRoot)
    ]);

    const nextAction =
      state.recovery.resumeFrom ||
      `Inspect changed files: ${reconcileResult.changedFiles.join(", ") || "none"}.`;
    const memory = {
      userIntent: state.conversationMemory.userIntent.trim(),
      userConstraints: nonEmpty(state.conversationMemory.userConstraints),
      userPreferences: nonEmpty(state.conversationMemory.userPreferences),
      rejectedApproaches: nonEmpty(state.conversationMemory.rejectedApproaches),
      openQuestions: nonEmpty(state.conversationMemory.openQuestions),
      importantContext: nonEmpty(state.conversationMemory.importantContext)
    };
    const summaryLines = [
      "# ACR Resume Brief",
      "",
      "## Objective",
      state.objective.summary,
      "",
      "## Conversation Memory",
      `- User intent: ${memory.userIntent || "Not recorded."}`,
      ...(memory.userConstraints.length > 0
        ? memory.userConstraints.map((item) => `- Constraint: ${item}`)
        : ["- Constraints: none recorded."]),
      ...(memory.userPreferences.length > 0
        ? memory.userPreferences.map((item) => `- Preference: ${item}`)
        : ["- Preferences: none recorded."]),
      ...(memory.rejectedApproaches.length > 0
        ? memory.rejectedApproaches.map((item) => `- Rejected: ${item}`)
        : []),
      ...(memory.openQuestions.length > 0
        ? memory.openQuestions.map((item) => `- Open question: ${item}`)
        : []),
      ...(memory.importantContext.length > 0
        ? memory.importantContext.map((item) => `- Context: ${item}`)
        : []),
      "",
      "## Acceptance criteria",
      ...state.objective.acceptanceCriteria.map(
        (criterion) => `- ${criterion}`
      ),
      "",
      "## Last known task",
      `- ${state.activeTask.title} (${state.activeTask.status})`,
      "",
      "## Changed files",
      ...(reconcileResult.changedFiles.length > 0
        ? reconcileResult.changedFiles.map((file) => `- ${file}`)
        : ["- none"]),
      "",
      "## Verification",
      `- Evidence freshness: ${reconcileResult.verificationFreshness}`,
      ...(state.verification.passed.length > 0
        ? state.verification.passed.map((value) => `- passed: ${value}`)
        : ["- No passing verification recorded."]),
      ...(state.verification.failed.length > 0
        ? state.verification.failed.map((value) => `- failed: ${value}`)
        : []),
      state.verification.notRunReason
        ? `- Not run: ${state.verification.notRunReason}`
        : "",
      "",
      "## Exact next action",
      nextAction
    ].filter(Boolean);

    return {
      drift: reconcileResult.drift,
      summary: summaryLines.join("\n"),
      nextAction,
      changedFiles: reconcileResult.changedFiles,
      warnings: reconcileResult.warnings,
      verificationFreshness: reconcileResult.verificationFreshness,
      repository: snapshot,
      conversationMemory: memory
    };
  }
}

export function createResumeEngine(
  store: ContinuityStore,
  inspector?: RepositoryInspector
): ResumeEngine {
  return new DefaultResumeEngine(store, inspector);
}
