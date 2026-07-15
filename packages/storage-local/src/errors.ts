export class RevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Current state revision conflict: expected ${expectedRevision}, actual ${actualRevision}.`
    );
    this.name = "RevisionConflictError";
  }
}

export class StateNotInitializedError extends Error {
  constructor(readonly projectRoot: string) {
    super(`Continuity state is not initialized for ${projectRoot}.`);
    this.name = "StateNotInitializedError";
  }
}
