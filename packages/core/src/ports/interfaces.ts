import type { CurrentState } from "../schemas/current-state.js";
import type {
  AgentCapabilities,
  CommitSummary,
  DiffSummary,
  FailureClassification,
  InstallationStatus,
  LaunchInput,
  LaunchSpec,
  ReconcileResult,
  RepositorySnapshot,
  ResumeBrief,
  ResumeInstructionInput,
  TerminationEvidence
} from "../services/resume-types.js";

export type DocumentName =
  | "PROJECT_CONTEXT.md"
  | "TASKS.md"
  | "DECISIONS.md"
  | "RECENT_CONTEXT.md"
  | "PROGRESS.md";

export interface InitializeResult {
  created: string[];
  modified: string[];
  warnings: string[];
}

export interface CheckpointInput {
  checkpointId: string;
  reason: string;
  summary: string;
  handoff: string;
  currentState: CurrentState;
  safeToResume: boolean;
  parentCheckpointId?: string | null;
}

export interface CheckpointSummary {
  checkpointId: string;
  createdAt: string;
  reason: string;
  safeToResume: boolean;
}

export interface LockHandle {
  path: string;
  release(): Promise<void>;
}

export interface ContinuityStore {
  initialize(projectRoot: string): Promise<InitializeResult>;
  readCurrentState(projectRoot: string): Promise<CurrentState>;
  writeCurrentState(
    projectRoot: string,
    next: CurrentState,
    expectedRevision: number
  ): Promise<CurrentState>;
  readDocument(projectRoot: string, name: DocumentName): Promise<string>;
  writeDocument(
    projectRoot: string,
    name: DocumentName,
    content: string
  ): Promise<void>;
  createCheckpoint(
    projectRoot: string,
    input: CheckpointInput
  ): Promise<CheckpointSummary>;
  listCheckpoints(
    projectRoot: string,
    limit?: number
  ): Promise<CheckpointSummary[]>;
  acquireLock(projectRoot: string, purpose: string): Promise<LockHandle>;
}

export interface RepositoryInspector {
  inspect(projectRoot: string): Promise<RepositorySnapshot>;
  diff(projectRoot: string): Promise<DiffSummary>;
  recentHistory(projectRoot: string, limit: number): Promise<CommitSummary[]>;
}

export interface AgentAdapterDescriptor {
  id: string;
  displayName: string;
  description: string;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  detectInstallation(): Promise<InstallationStatus>;
  capabilities(): AgentCapabilities;
  buildLaunchSpec(input: LaunchInput): Promise<LaunchSpec>;
  classifyTermination(
    input: TerminationEvidence
  ): Promise<FailureClassification>;
  buildResumeInstruction(input: ResumeInstructionInput): Promise<string>;
}

export interface ResumeEngine {
  generate(projectRoot: string): Promise<ResumeBrief>;
  reconcile(projectRoot: string): Promise<ReconcileResult>;
}
