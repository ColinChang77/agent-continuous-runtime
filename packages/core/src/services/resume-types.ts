export interface RepositorySnapshot {
  projectRoot: string;
  isGitRepository: boolean;
  head: string | null;
  branch: string | null;
  isDirty: boolean;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  statusText: string;
  diffStat: string;
  capturedAt: string;
}

export interface DiffSummary {
  files: string[];
  text: string;
}

export interface CommitSummary {
  sha: string;
  subject: string;
}

export type DriftClass =
  | "none"
  | "benign"
  | "stale_state"
  | "partial_edit"
  | "conflict"
  | "invalid_state";

export interface ResumeBrief {
  drift: DriftClass;
  summary: string;
  nextAction: string;
  changedFiles: string[];
  warnings: string[];
  repository: RepositorySnapshot;
  conversationMemory: {
    userIntent: string;
    userConstraints: string[];
    userPreferences: string[];
    rejectedApproaches: string[];
    openQuestions: string[];
    importantContext: string[];
  };
}

export interface ReconcileResult {
  drift: DriftClass;
  changedFiles: string[];
  warnings: string[];
}

export type FailureKind =
  | "normal_exit"
  | "usage_limit"
  | "context_limit"
  | "authentication_failure"
  | "network_failure"
  | "process_crash"
  | "user_interrupt"
  | "unknown";

export interface FailureClassification {
  kind: FailureKind;
  confidence: "low" | "medium" | "high";
  retryable: boolean;
  safeToFailover: boolean;
  evidence: string[];
  recommendedAction: string;
  cooldownMs?: number | null;
  failoverAppropriate?: boolean;
}

export interface InstallationStatus {
  installed: boolean;
  executablePath: string | null;
  details?: string;
  version?: string;
  authenticated?: boolean | "unknown";
}

export interface AgentCapabilities {
  interactive: boolean;
  usesMcp: boolean;
  supportsAutomaticFailoverHints: boolean;
}

export interface LaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface ResumeInstructionInput {
  brief: ResumeBrief;
}

export interface LaunchInput {
  projectRoot: string;
  resumeInstruction: string;
  scenario?: string;
}

export interface TerminationEvidence {
  exitCode: number | null;
  signal: string | null;
  stdout?: string;
  stderr?: string;
  output: string;
  timedOut?: boolean;
  transportError?: string | null;
  structuredEvents?: Array<{
    type: string;
    message?: string;
  }>;
}
