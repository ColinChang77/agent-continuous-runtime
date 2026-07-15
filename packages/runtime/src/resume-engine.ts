import {
  type ContinuityStore,
  type DriftClass,
  type ReconcileResult,
  type RepositoryInspector,
  type ResumeBrief,
  type ResumeEngine
} from "@acr/core";

import {
  createRepositoryInspector,
  createStatusDigest
} from "./repository-inspector.js";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class DefaultResumeEngine implements ResumeEngine {
  constructor(
    private readonly store: ContinuityStore,
    private readonly inspector: RepositoryInspector = createRepositoryInspector()
  ) {}

  async reconcile(projectRoot: string): Promise<ReconcileResult> {
    const [state, snapshot] = await Promise.all([
      this.store.readCurrentState(projectRoot),
      this.inspector.inspect(projectRoot)
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
      state.repositoryEvidence.head !== snapshot.head ||
      state.repositoryEvidence.branch !== snapshot.branch
    ) {
      drift = "stale_state";
      warnings.push(
        "Stored repository evidence is stale relative to the current repository."
      );
    }

    return {
      drift,
      changedFiles,
      warnings
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
    const summaryLines = [
      "# ACR Resume Brief",
      "",
      "## Objective",
      state.objective.summary,
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
      repository: snapshot
    };
  }
}

export function createResumeEngine(
  store: ContinuityStore,
  inspector?: RepositoryInspector
): ResumeEngine {
  return new DefaultResumeEngine(store, inspector);
}
