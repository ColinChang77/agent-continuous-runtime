# Agent Continuity Runtime (ACR)

**Technical Product Specification**  
**Status:** Implementation-ready draft  
**Version:** 1.0.0  
**Date:** 2026-07-14  
**Primary implementation language:** TypeScript  
**Target runtime:** Node.js 22 LTS or newer  
**License recommendation:** Apache-2.0

---

## 0. How to use this specification

This document is normative. The implementation agent MUST treat the keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** as requirement levels.

The implementation objective is a working local-first MVP, not merely scaffolding or documentation. When this specification leaves a minor implementation detail open, the implementation agent SHOULD select the smallest safe design that preserves the public interfaces defined here.

The implementation agent MUST:

1. Read this document completely before changing the repository.
2. Create a milestone plan mapped to the acceptance criteria in Section 25.
3. Implement the milestones in order unless an explicit dependency requires otherwise.
4. Keep the repository buildable and testable after each milestone.
5. Prefer working code and automated tests over additional prose.
6. Record material deviations in `docs/DEVIATIONS.md`, including rationale and migration impact.
7. Never claim automatic failover works unless an end-to-end test demonstrates it for the relevant adapter.

---

## 1. Executive summary

Agent Continuity Runtime (ACR) is a local-first, vendor-neutral continuity layer for AI coding agents.

Its purpose is to allow one coding agent—initially Claude Code or OpenAI Codex CLI—to continue work performed by another agent in the same repository after an interruption such as:

- usage-limit exhaustion;
- context-window exhaustion;
- authentication failure;
- network failure;
- process crash;
- intentional model or vendor switching;
- terminal closure or machine restart.

ACR consists of three cooperating layers:

1. **Repository continuity state**: portable, human-readable and machine-readable files stored under `.agent/`.
2. **MCP server**: a standardized interface exposing continuity resources, tools, and prompts to MCP-compatible clients.
3. **Runtime/CLI orchestrator**: a process supervisor that starts supported coding agents, observes process termination, classifies failures, checkpoints recoverable state, and launches a fallback agent when safe.

The repository and Git working tree are always the source of truth. ACR state is a recovery index, not a replacement for inspecting code.

The MVP MUST support:

- local repositories;
- Claude Code CLI;
- OpenAI Codex CLI;
- stdio MCP transport;
- manual switching;
- best-effort automatic failover between Claude Code and Codex;
- portable `.agent/` state;
- checkpointing, validation, repair, and resume briefing;
- non-destructive operation;
- automated tests and a deterministic fake-agent test harness.

The MVP MUST NOT promise invisible continuation of an unfinished model response. It resumes at the latest durable repository state and checkpoint, then reconciles any uncheckpointed file changes.

---

## 2. Problem statement

AI coding tools maintain important working context inside vendor-specific sessions. That context is often unavailable to another model or disappears when a session stops unexpectedly. The code may remain on disk, but the next agent often lacks:

- the user's current objective;
- acceptance criteria;
- which steps were completed;
- which edits are partial;
- why architectural decisions were made;
- which commands failed;
- what must happen next;
- what must not be repeated.

Users therefore copy chat summaries, restate requirements, or ask the new agent to rediscover the repository. These approaches are slow, token-intensive, inconsistent, and unreliable.

MCP alone does not solve the full problem. MCP can expose shared context and tools, but it does not inherently supervise Claude Code or Codex processes, detect subscription usage limits, launch a replacement process, or ensure every agent writes checkpoints. ACR therefore combines MCP with a local runtime and repository-resident state.

---

## 3. Product vision

ACR aims to become a common continuity protocol for AI-assisted software development.

Git preserves source history. ACR preserves operational working state:

- active objective;
- agent progress;
- checkpoints;
- validation evidence;
- recovery instructions;
- cross-agent handoff metadata.

The long-term system may support additional agents, cloud synchronization, teams, routing, observability, and session replay. These are not required for the v1 MVP unless explicitly listed.

---

## 4. Goals

### 4.1 Primary goals

The v1 implementation MUST:

1. Let Claude Code and Codex read and update one canonical continuity state in the same repository.
2. Let either agent resume from the first genuinely unfinished step without requiring the user to restate recoverable context.
3. Preserve usable work after abrupt process termination.
4. Detect and reconcile drift between stored state and the actual working tree.
5. Provide a CLI that can manually start, resume, switch, inspect, validate, and checkpoint a project.
6. Provide best-effort automatic failover from one supported CLI agent to the other.
7. Be safe by default and avoid destructive Git or filesystem actions.
8. Be installable and usable by another developer without modifying source code.
9. Be vendor-neutral in the core domain and storage layers.
10. Expose MCP Resources, Tools, and Prompts using the official MCP TypeScript SDK.

### 4.2 User-experience goal

The desired experience is:

```text
$ acr start --agent claude-code --fallback codex

Claude Code works in the repository.
Claude Code exits because its usage allowance is exhausted.
ACR classifies the exit as a likely usage-limit failure.
ACR captures repository evidence and writes a recovery checkpoint.
ACR launches Codex in the same repository with a resume instruction.
Codex reads the canonical state, inspects the working tree, and continues.
```

A brief terminal notice is acceptable. “Invisible” means the user does not need to reconstruct context, not that the process switch is literally hidden.

---

## 5. Non-goals

The v1 MVP MUST NOT:

1. Bypass, evade, or circumvent vendor usage limits, billing controls, authentication controls, or terms of service.
2. Automatically rotate multiple accounts for the same vendor.
3. impersonate a user or transfer private vendor conversation history.
4. Guarantee detection of every usage-limit message; detection is adapter-specific and best effort.
5. Continue an incomplete model token stream exactly where it stopped.
6. run Claude Code and Codex concurrently against the same files by default.
7. merge conflicting simultaneous edits automatically.
8. provide a cloud-hosted multi-tenant service.
9. require a database.
10. replace Git or build a new version-control system.
11. support Cursor as a fully supervised process in v1; Cursor MAY consume the MCP server and repository state manually.
12. support remote repositories without a local working tree.
13. automatically commit, reset, clean, stash, checkout, or revert user code.
14. execute arbitrary generated shell commands through MCP state tools.
15. store secrets, full chat transcripts, model credentials, or API keys in `.agent/`.

---

## 6. Personas and user stories

### 6.1 Solo developer

As a solo developer, I want Codex to continue after Claude Code reaches a usage limit, so that I do not have to repeat project context.

Acceptance:

- both agents operate in the same repository;
- Codex receives a resume briefing;
- Codex sees uncommitted Claude edits;
- no completed work is redone unless verification shows it is incomplete.

### 6.2 Open-source maintainer

As a maintainer, I want contributors to install one package and initialize continuity files, so that multiple agents follow the same recovery protocol.

Acceptance:

- `npx acr init` or an installed `acr init` command creates required files;
- existing `AGENTS.md` and `CLAUDE.md` are preserved and augmented safely;
- validation reports actionable problems.

### 6.3 Tool integrator

As an integrator, I want stable MCP tools and storage interfaces, so that I can build a new adapter without changing the continuity engine.

Acceptance:

- agent adapters implement a documented interface;
- storage adapters implement a documented interface;
- core services do not import vendor-specific modules.

---

## 7. Foundational principles

### 7.1 Repository-first truth

The following evidence order MUST be used when information conflicts:

1. actual files and filesystem metadata;
2. Git index and working-tree state;
3. test/build/type-check results;
4. latest valid checkpoint;
5. `CURRENT_STATE.json`;
6. narrative Markdown state;
7. prior agent claims.

ACR MUST never overwrite repository truth merely to make state files internally consistent.

### 7.2 Local-first and portable

Essential state MUST reside in ordinary files under the repository. The project MUST remain recoverable when the MCP server is not running.

### 7.3 Vendor neutrality

The core domain, state schemas, validation, checkpointing, and resume logic MUST NOT import Claude- or OpenAI-specific code. Vendor behavior belongs in adapters.

### 7.4 Crash safety

State writes MUST use atomic replacement where supported:

1. write to a temporary file in the same directory;
2. flush and close;
3. rename over the destination.

The system MUST retain the last valid state if a write is interrupted.

### 7.5 Idempotency

Initialization, validation, repair, and checkpoint operations SHOULD be safely repeatable. Calling `init` twice MUST NOT duplicate instruction blocks or erase user content.

### 7.6 Least privilege

The MCP server MUST expose only the repository roots explicitly configured for the process. It MUST reject path traversal and symlink escapes outside allowed roots.

### 7.7 Transparent uncertainty

Failure classification MUST include confidence and evidence. A regex match is not proof that a subscription limit was reached.

---

## 8. System boundary and component model

```text
┌───────────────────────────────────────────────────────────┐
│ User terminal                                             │
│                                                           │
│  acr CLI / Runtime Supervisor                             │
│     ├── Claude Code Adapter ──> claude process            │
│     ├── Codex Adapter ────────> codex process             │
│     ├── Failure Classifier                                │
│     └── Failover Coordinator                              │
│                                                           │
│  MCP Server (stdio initially)                             │
│     ├── Resources                                         │
│     ├── Tools                                             │
│     └── Prompts                                           │
│                                                           │
│  Core Continuity Services                                 │
│     ├── Repository Inspector                              │
│     ├── State Manager                                     │
│     ├── Checkpoint Engine                                 │
│     ├── Resume Engine                                     │
│     ├── Validator / Repairer                              │
│     └── Lock Manager                                      │
│                                                           │
│  Local Storage                                            │
│     ├── .agent/ canonical state                           │
│     ├── .acr/ local runtime state                         │
│     └── Git working tree                                  │
└───────────────────────────────────────────────────────────┘
```

### 8.1 Critical distinction

- The **MCP server** lets an agent read and mutate continuity state.
- The **runtime supervisor** owns child processes and failover.
- The **repository** contains actual work.

The MCP server MUST NOT attempt to terminate or launch the MCP client that is currently connected to it. Process orchestration belongs to the runtime.

---

## 9. Technology choices

### 9.1 Required

- TypeScript with strict type checking.
- Node.js 22 LTS or newer.
- ESM modules.
- Official `@modelcontextprotocol/sdk` package.
- A schema-validation library such as Zod.
- A unit-test framework such as Vitest.
- A workspace-capable package manager; `pnpm` is recommended.
- Structured logging with secret redaction.

### 9.2 Dependency policy

The implementation SHOULD minimize dependencies. Dependencies MUST be actively maintained and have a clear purpose. Core behavior MUST NOT require Docker, Python, a database, or a hosted service.

### 9.3 MCP protocol target

The implementation MUST use a stable MCP specification version supported by the selected official SDK at implementation time. The chosen protocol/SDK version MUST be pinned and documented. The implementation MUST NOT target an unreleased draft by default.

---

## 10. Monorepo layout

The recommended layout is:

```text
/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── LICENSE
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   ├── SPEC.md
│   ├── ARCHITECTURE.md
│   ├── THREAT_MODEL.md
│   ├── ADAPTERS.md
│   └── DEVIATIONS.md
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── domain/
│   │       ├── schemas/
│   │       ├── services/
│   │       ├── ports/
│   │       └── errors/
│   ├── storage-local/
│   │   └── src/
│   ├── mcp-server/
│   │   └── src/
│   ├── runtime/
│   │   └── src/
│   ├── adapter-claude-code/
│   │   └── src/
│   ├── adapter-codex/
│   │   └── src/
│   ├── cli/
│   │   └── src/
│   └── test-fixtures/
│       └── src/
└── e2e/
    ├── fixtures/
    └── tests/
```

A simpler layout MAY be used if it preserves the same module boundaries. Circular dependencies are prohibited.

---

## 11. Canonical project state

### 11.1 Directory structure

Initialization MUST create:

```text
.agent/
├── schema-version
├── PROJECT_CONTEXT.md
├── CURRENT_STATE.json
├── TASKS.md
├── DECISIONS.md
├── RECENT_CONTEXT.md
├── PROGRESS.md
├── checkpoints/
├── snapshots/
└── locks/
```

### 11.2 Local runtime state

Machine-specific runtime state MUST be stored separately:

```text
.acr/
├── runtime.json
├── runtime.log
├── failover.log
├── sessions/
└── locks/
```

`.acr/` SHOULD be added to `.gitignore`. `.agent/` SHOULD be committed, except ephemeral lock files and optional snapshots if configured otherwise.

### 11.3 State ownership

`.agent/` is canonical portable continuity state. `.acr/` is local operational metadata and MUST NOT be required to resume manually on another machine.

---

## 12. State schemas

All JSON schemas MUST be versioned. Unknown additive fields SHOULD be preserved during read-modify-write operations when practical.

### 12.1 `CURRENT_STATE.json`

```json
{
  "schemaVersion": "1.0.0",
  "revision": 1,
  "updatedAt": "2026-07-14T21:00:00.000Z",
  "updatedBy": {
    "agent": "claude-code",
    "adapterVersion": "1.0.0",
    "sessionId": "uuid"
  },
  "project": {
    "id": "stable-project-id",
    "rootFingerprint": "sha256",
    "defaultBranch": "main"
  },
  "objective": {
    "summary": "Implement authentication flow",
    "acceptanceCriteria": ["..."],
    "constraints": ["..."]
  },
  "activeTask": {
    "id": "TASK-001",
    "title": "Add login endpoint",
    "status": "in_progress",
    "startedAt": "ISO-8601",
    "lastCheckpointId": "checkpoint-id-or-null"
  },
  "completedSteps": [],
  "inProgressSteps": [],
  "nextSteps": [],
  "touchedFiles": {
    "created": [],
    "modified": [],
    "deleted": []
  },
  "verification": {
    "commands": [],
    "passed": [],
    "failed": [],
    "notRunReason": null
  },
  "knownIssues": [],
  "blockers": [],
  "decisions": [],
  "lastSuccessfulAction": null,
  "lastFailedAction": null,
  "recovery": {
    "resumeFrom": "Exact next action",
    "inspectFirst": [],
    "doNotRepeat": [],
    "confidence": "high"
  },
  "repositoryEvidence": {
    "head": "git-sha-or-null",
    "branch": "branch-or-null",
    "isDirty": true,
    "statusDigest": "sha256",
    "diffDigest": "sha256-or-null",
    "capturedAt": "ISO-8601"
  }
}
```

Requirements:

- `revision` MUST increase monotonically on successful mutation.
- Writes MUST use optimistic concurrency via `expectedRevision` for MCP mutation tools.
- `status` enum: `not_started`, `in_progress`, `blocked`, `verifying`, `completed`, `abandoned`.
- `recovery.resumeFrom` MUST be concrete and actionable.
- Arrays MUST remain concise; full logs belong in `PROGRESS.md` or checkpoint files.
- File paths MUST be repository-relative POSIX-style paths.

### 12.2 Runtime state

`.acr/runtime.json` MUST include:

```json
{
  "schemaVersion": "1.0.0",
  "runtimeId": "uuid",
  "projectRoot": "/absolute/path",
  "status": "idle",
  "activeAgent": null,
  "fallbackOrder": ["codex"],
  "startedAt": null,
  "lastHeartbeatAt": null,
  "mcp": {
    "transport": "stdio",
    "status": "stopped"
  },
  "failover": {
    "attempt": 0,
    "maxAttempts": 2,
    "lastReason": null
  }
}
```

Runtime status enum: `idle`, `starting`, `running`, `checkpointing`, `failing_over`, `stopped`, `failed`.

### 12.3 Checkpoint manifest

Each checkpoint directory MUST contain `manifest.json` and `HANDOFF.md`:

```text
.agent/checkpoints/<timestamp>_<id>/
├── manifest.json
└── HANDOFF.md
```

Manifest fields:

- checkpoint ID;
- schema version;
- timestamp;
- creating agent/session;
- reason;
- current-state revision;
- Git HEAD and branch;
- status/diff digests;
- touched paths;
- verification results;
- safe-to-resume boolean;
- parent checkpoint ID;
- optional snapshot references.

Checkpoints MUST NOT copy the entire repository by default.

### 12.4 Markdown files

#### `PROJECT_CONTEXT.md`

Durable facts only:

- product purpose;
- architecture;
- technology stack;
- important directories;
- commands;
- conventions;
- environment requirements;
- external systems;
- durable constraints;
- definition of done.

#### `TASKS.md`

```markdown
# Active task

## Goal
## Acceptance criteria
## Status
## Completed
## In progress
## Next
## Blocked
## Out of scope
```

Exactly one immediate next action SHOULD be clearly marked.

#### `DECISIONS.md`

Append decisions using:

```markdown
## ADR-0001 — Title
- Date:
- Agent:
- Status: proposed | accepted | superseded | rejected
- Context:
- Decision:
- Alternatives:
- Consequences:
- Related files:
```

#### `RECENT_CONTEXT.md`

A compact, replaceable resume summary. It SHOULD remain under a configurable size limit, default 4,000 words.

#### `PROGRESS.md`

Append-only chronological log. Entries MUST include timestamp, agent, task, changes, verification, and remaining work.

---

## 13. Instruction-file integration

### 13.1 `AGENTS.md`

Initialization MUST create or augment a root `AGENTS.md` with a bounded managed block:

```markdown
<!-- ACR:BEGIN -->
...managed instructions...
<!-- ACR:END -->
```

The managed block MUST instruct agents to:

1. inspect `.agent/` state;
2. inspect the actual working tree;
3. call or emulate resume before work;
4. avoid destructive Git commands;
5. update continuity state after meaningful work;
6. validate before claiming completion.

Existing content outside the managed block MUST be preserved byte-for-byte where practical.

### 13.2 `CLAUDE.md`

Initialization MUST create or augment a root `CLAUDE.md` with an equivalent managed block appropriate for Claude Code. It MAY reference `AGENTS.md` and `.agent/` files using syntax supported by Claude Code, but correctness MUST NOT depend exclusively on vendor-specific imports.

### 13.3 Idempotent merging

Repeated initialization MUST replace only the existing managed block. If malformed duplicate blocks exist, validation MUST report them and repair MAY consolidate them after creating a backup.

---

## 14. Core service interfaces

The domain layer MUST define interfaces equivalent to the following.

### 14.1 Storage port

```ts
export interface ContinuityStore {
  initialize(projectRoot: string): Promise<InitializeResult>;
  readCurrentState(projectRoot: string): Promise<CurrentState>;
  writeCurrentState(
    projectRoot: string,
    next: CurrentState,
    expectedRevision: number,
  ): Promise<CurrentState>;
  readDocument(projectRoot: string, name: DocumentName): Promise<string>;
  writeDocument(projectRoot: string, name: DocumentName, content: string): Promise<void>;
  createCheckpoint(projectRoot: string, input: CheckpointInput): Promise<Checkpoint>;
  listCheckpoints(projectRoot: string, limit?: number): Promise<CheckpointSummary[]>;
  acquireLock(projectRoot: string, purpose: string): Promise<LockHandle>;
}
```

### 14.2 Repository inspector

```ts
export interface RepositoryInspector {
  inspect(projectRoot: string, options?: InspectOptions): Promise<RepositorySnapshot>;
  diff(projectRoot: string, options?: DiffOptions): Promise<DiffSummary>;
  recentHistory(projectRoot: string, limit: number): Promise<CommitSummary[]>;
}
```

It MUST handle non-Git directories gracefully.

### 14.3 Agent adapter

```ts
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  detectInstallation(): Promise<InstallationStatus>;
  capabilities(): AgentCapabilities;
  buildLaunchSpec(input: LaunchInput): Promise<LaunchSpec>;
  classifyTermination(input: TerminationEvidence): Promise<FailureClassification>;
  buildResumeInstruction(input: ResumeBrief): Promise<string>;
}
```

Adapters MUST NOT spawn processes directly. The runtime owns spawning.

### 14.4 Process runner

```ts
export interface ProcessRunner {
  run(spec: LaunchSpec, handlers: ProcessHandlers): Promise<ProcessResult>;
  terminate(reason: string): Promise<void>;
}
```

### 14.5 Resume engine

```ts
export interface ResumeEngine {
  generate(projectRoot: string, options?: ResumeOptions): Promise<ResumeBrief>;
  reconcile(projectRoot: string, options?: ReconcileOptions): Promise<ReconcileResult>;
}
```

### 14.6 Failure classification

```ts
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
}
```

---

## 15. MCP server specification

### 15.1 Transport

The MVP MUST support stdio transport. Streamable HTTP MAY be added behind an experimental flag but is not required for acceptance.

### 15.2 Server identity

Recommended server name: `acr-continuity`. Version MUST match the package version.

### 15.3 Project-root selection

The server MUST receive one or more allowed project roots through explicit CLI arguments or environment configuration. It MUST NOT default to unrestricted filesystem access.

For stdio single-project mode:

```bash
acr mcp serve --project /absolute/path/to/repo
```

### 15.4 MCP Resources

Resources MUST be read-only views. Recommended URIs:

```text
acr://project/summary
acr://project/context
acr://project/current-state
acr://project/tasks
acr://project/decisions
acr://project/recent-context
acr://project/progress
acr://project/repository-status
acr://project/resume-brief
acr://project/checkpoints
```

Resource responses SHOULD include MIME types and last-updated metadata where supported.

`acr://project/resume-brief` MUST be generated from both stored state and a fresh repository inspection. It MUST clearly flag stale or contradictory state.

### 15.5 MCP Tools

All mutation tools MUST validate paths, acquire a project lock, and return structured output.

#### `initialize_project`

Input:

```json
{
  "projectRoot": "/absolute/path",
  "force": false
}
```

Behavior:

- validate allowed root;
- inspect repository;
- create `.agent/` files;
- augment instruction files;
- add recommended ignore entries without deleting existing patterns;
- create an initial checkpoint;
- return files created/modified and warnings.

#### `inspect_project`

Returns repository snapshot, state revision, drift, active task, and warnings. It MUST NOT mutate state.

#### `resume_project`

Input options MAY include `repairSafeDrift` and `maxContextChars`.

Behavior:

- inspect repository and Git;
- load state;
- detect drift;
- perform only explicitly safe repairs if requested;
- generate compact resume briefing;
- return exact next action and evidence.

#### `update_state`

Input MUST include:

- `expectedRevision`;
- a typed patch, not an arbitrary replacement document;
- agent/session identity;
- reason.

The tool MUST reject stale revisions with a conflict result.

#### `checkpoint`

Input:

- reason;
- summary;
- completed work;
- next action;
- verification evidence;
- optional `safeToResume` override subject to validation.

The server MUST capture fresh repository evidence itself rather than trusting all caller claims.

#### `record_decision`

Appends a structured decision and adds its ID to current state when relevant.

#### `record_progress`

Appends a concise progress entry. It MUST NOT accept unbounded transcript data.

#### `complete_task`

Must require verification evidence or a documented reason verification could not run. It updates state and creates a milestone checkpoint.

#### `validate_state`

Performs schema, filesystem, instruction-block, reference, lock, checkpoint, and repository-drift validation. It MUST return machine-readable issues with severity and repairability.

#### `repair_state`

Only safe, deterministic repairs MAY run without explicit confirmation. Examples:

- regenerate missing derived resume summary;
- remove stale lock owned by a dead local PID after age threshold;
- repair formatting in managed instruction blocks;
- update repository evidence digest.

Potentially destructive or semantic repairs MUST be proposed, not executed automatically.

#### `prepare_handoff`

Creates a fresh checkpoint and returns a provider-neutral handoff brief suitable for another agent.

### 15.6 MCP Prompts

Expose at least:

- `initialize-repository`;
- `resume-project`;
- `checkpoint-project`;
- `prepare-handoff`;
- `repair-continuity-state`.

Prompts MUST be vendor-neutral and MUST instruct the receiving model to inspect repository truth before editing.

### 15.7 Tool result conventions

Every tool result MUST include:

```json
{
  "ok": true,
  "operation": "checkpoint",
  "projectRoot": "/path",
  "stateRevision": 4,
  "warnings": [],
  "data": {}
}
```

Errors MUST use stable codes such as:

- `ACR_INVALID_INPUT`;
- `ACR_PATH_OUTSIDE_ROOT`;
- `ACR_STATE_NOT_INITIALIZED`;
- `ACR_REVISION_CONFLICT`;
- `ACR_LOCKED`;
- `ACR_INVALID_STATE`;
- `ACR_GIT_UNAVAILABLE`;
- `ACR_UNSAFE_REPAIR`;
- `ACR_INTERNAL_ERROR`.

Do not leak stack traces or secrets in normal MCP output.

---

## 16. Resume and reconciliation engine

### 16.1 Inputs

The resume engine MUST consider:

- current continuity state;
- recent checkpoint;
- project context;
- task queue;
- recent context;
- Git HEAD and branch;
- staged, unstaged, and untracked paths;
- recent commits;
- relevant test evidence;
- stale locks;
- prior runtime failure evidence when available.

### 16.2 Drift classes

The engine MUST classify drift:

1. `none`: state matches repository evidence.
2. `benign`: files changed after checkpoint but changes are inspectable and state can be refreshed.
3. `stale_state`: stored claims conflict with repository evidence.
4. `partial_edit`: likely interrupted work exists.
5. `conflict`: concurrent or ambiguous modifications make automatic continuation unsafe.
6. `invalid_state`: schema or integrity failure.

### 16.3 Resume brief

A resume brief MUST contain:

- project summary;
- user's current objective;
- acceptance criteria;
- last known agent and checkpoint;
- completed work supported by evidence;
- unfinished or uncertain work;
- changed files;
- verification status;
- known failures/blockers;
- exact first action;
- actions not to repeat;
- drift/confidence warnings.

It SHOULD fit within a configurable maximum, default 12,000 characters. When truncated, it MUST preserve the next action and warnings.

### 16.4 Reconciliation rules

The engine MUST NOT infer that a feature is complete only because a file exists. Completion requires state plus repository evidence and, where feasible, verification.

When stored state says “not started” but Git diff contains substantial relevant changes, the engine SHOULD mark the work `in_progress` and request inspection rather than redoing it.

---

## 17. Runtime supervisor

### 17.1 Commands

The CLI MUST provide:

```text
acr init [path]
acr status [path]
acr validate [path]
acr repair [path] [--safe]
acr checkpoint [path] --summary "..." --next "..."
acr resume [path] [--agent <id>]
acr start [path] --agent <id> [--fallback <id>...]
acr switch [path] --to <id>
acr adapters list
acr mcp serve --project <path>
acr doctor
```

Help text and exit codes MUST be documented.

### 17.2 Start flow

`acr start` MUST:

1. resolve and validate project root;
2. initialize state if explicitly allowed or fail with guidance;
3. acquire a single-runtime lock;
4. detect requested agent installation;
5. detect fallback installations;
6. start MCP availability required by the selected adapter/configuration;
7. generate a fresh resume brief;
8. launch the selected agent in the project root;
9. stream terminal I/O interactively;
10. capture bounded stdout/stderr evidence with secret redaction;
11. observe exit status and signals;
12. classify termination;
13. checkpoint repository evidence;
14. decide whether failover is safe;
15. launch the next fallback when policy permits;
16. stop after configured attempts or on user interruption.

### 17.3 Interactive terminal requirements

Claude Code and Codex are interactive CLIs. The process runner MUST use a pseudo-terminal where required. Terminal resizing and Ctrl+C handling SHOULD work predictably.

The runtime MUST distinguish:

- Ctrl+C intended for the child agent;
- repeated Ctrl+C or explicit runtime escape intended to stop ACR.

The chosen interaction contract MUST be documented and tested.

### 17.4 Failover policy

Default behavior:

- `normal_exit`: do not fail over.
- `user_interrupt`: do not fail over unless `--failover-on-interrupt` is explicitly set.
- `usage_limit`: fail over when confidence is medium/high and a fallback is installed.
- `context_limit`: fail over or restart another agent with a compact resume brief.
- `authentication_failure`: fail over only to a different vendor adapter; do not retry the same credentials repeatedly.
- `network_failure`: retry once with exponential backoff, then optionally fail over.
- `process_crash`: fail over after checkpointing.
- `unknown`: ask for confirmation in interactive mode; in non-interactive mode stop safely unless policy says otherwise.

A maximum failover count MUST prevent loops. Default: 2 transitions per invocation.

### 17.5 Checkpoint on abrupt termination

After child termination, the runtime can still inspect files and Git. It MUST create a **recovery checkpoint** even if the agent could not call MCP immediately before exit.

The checkpoint MUST clearly state that narrative intent may lag behind repository state.

### 17.6 Manual switch

`acr switch --to codex` MUST:

1. request graceful child termination when possible;
2. checkpoint;
3. launch the target adapter;
4. provide the target with a resume instruction.

It MUST NOT kill unrelated processes.

---

## 18. Agent adapters

### 18.1 General adapter responsibilities

An adapter is responsible only for:

- installation detection;
- supported version probing;
- launch command construction;
- environment/config hints;
- resume instruction construction;
- termination classification using vendor-specific evidence;
- capabilities declaration.

An adapter MUST NOT contain storage or checkpoint logic.

### 18.2 Claude Code adapter

The adapter MUST support:

- detecting the `claude` executable;
- launching it in the project directory;
- ensuring repository instructions point to ACR continuity state;
- documenting MCP installation/configuration steps;
- classifying common usage-limit, authentication, network, and crash outcomes using exit code and sanitized terminal evidence;
- avoiding assumptions that exact error wording is stable.

Claude Code hooks MAY be generated as optional automation. They MUST be idempotent, clearly marked, and non-destructive. Hook support MUST be treated as an optimization, not the sole checkpoint mechanism.

### 18.3 Codex adapter

The adapter MUST support:

- detecting the `codex` executable;
- launching it in the project directory;
- relying on `AGENTS.md` for durable project guidance;
- documenting or automating MCP registration where safely supported;
- constructing a provider-neutral resume instruction;
- classifying common rate/usage, authentication, network, and crash outcomes.

The adapter MUST not confuse “Codex exposed as an MCP server” with “Codex consuming the ACR MCP server.” ACR requires the latter for agent access to continuity tools.

### 18.4 Cursor and Gemini

For v1:

- Cursor MAY be documented as a manual MCP consumer and repository-state reader; no automatic process failover guarantee is required.
- Gemini CLI MAY be implemented as experimental only after Claude Code and Codex acceptance tests pass.

### 18.5 Fake adapter

A deterministic fake agent adapter MUST be included for end-to-end tests. It MUST simulate:

- successful work and normal exit;
- file modification followed by usage-limit exit;
- partial file write followed by crash;
- authentication failure;
- network failure;
- long-running interactive session;
- user interrupt.

---

## 19. Automatic checkpointing strategy

### 19.1 Layers

Checkpointing MUST be defense in depth:

1. **Agent-invoked checkpoints** through MCP after meaningful work.
2. **Instruction-based checkpoints** through `AGENTS.md`/`CLAUDE.md`.
3. **Optional vendor hooks** where supported.
4. **Runtime recovery checkpoints** after any child process exits.
5. **Periodic evidence snapshots** MAY be enabled, but MUST not interrupt interactive work or write noisy narrative state.

### 19.2 Meaningful work

Examples:

- implementing a function or component;
- changing an API or schema;
- fixing a defect;
- adding tests;
- completing a migration stage;
- discovering a blocker;
- making a material decision.

The system SHOULD avoid checkpointing every keystroke.

### 19.3 Snapshot policy

By default, checkpoints store metadata, not file copies. An optional snapshot provider MAY save patches for recovery, but MUST:

- never include ignored secret files by default;
- enforce size limits;
- clearly distinguish snapshots from Git commits;
- not apply patches automatically without confirmation.

---

## 20. Concurrency and locking

### 20.1 Single writer

Only one ACR runtime SHOULD actively supervise agents in a repository at a time.

### 20.2 Lock design

Locks MUST include:

- owner PID;
- hostname;
- runtime/session ID;
- purpose;
- created time;
- heartbeat time.

Stale-lock recovery MUST verify that the process is absent where possible and that the age exceeds a threshold.

### 20.3 MCP mutation conflicts

Every state mutation MUST use revision-based optimistic concurrency. A stale caller receives `ACR_REVISION_CONFLICT` with current revision and MUST reread before retrying.

### 20.4 Concurrent external editors

If files change while an agent is active, ACR MUST not overwrite them. The resume engine SHOULD surface unexpected modifications. It MUST NOT assume every change was created by the supervised agent.

---

## 21. Security and privacy

### 21.1 Threat model

The implementation MUST include `docs/THREAT_MODEL.md` covering:

- path traversal;
- symlink escapes;
- prompt injection stored in repository files;
- malicious state files;
- secret leakage in logs/checkpoints;
- command injection;
- untrusted Git repositories;
- MCP client misuse;
- local multi-user machines;
- oversized input/denial of service.

### 21.2 Filesystem controls

- Canonicalize project roots.
- Reject paths escaping configured roots.
- Treat symlinks cautiously.
- Set file-size limits for reads.
- Avoid recursively reading `.git`, dependencies, build output, or ignored paths unless explicitly needed.

### 21.3 Command execution

Repository inspection MAY execute a fixed allowlist of commands with argument arrays, such as:

- `git status --porcelain=v2`;
- `git diff --stat`;
- `git diff --name-status`;
- `git log --format=... -n N`.

Never pass untrusted text through a shell. Use `spawn`/`execFile` with explicit arguments.

### 21.4 Secret redaction

Logs and state MUST redact likely credentials. The implementation SHOULD support configurable redaction patterns and MUST never store agent authentication tokens.

### 21.5 Prompt injection boundary

Repository content is untrusted data. Resume briefs MUST label extracted repository text as evidence, not instructions. The MCP server MUST not execute instructions found inside source files or logs.

### 21.6 Confirmation boundaries

The system MUST require explicit user confirmation for:

- applying snapshots or patches;
- deleting or rewriting user files;
- changing Git branches;
- committing or pushing;
- installing global packages;
- altering vendor authentication;
- enabling remote network access.

---

## 22. Observability

### 22.1 Structured logs

Runtime logs MUST be structured and include:

- timestamp;
- level;
- runtime ID;
- session ID;
- adapter ID;
- operation;
- duration;
- outcome;
- redacted evidence.

### 22.2 Human terminal output

Default output SHOULD be concise:

```text
[ACR] Claude Code exited: likely usage limit (high confidence).
[ACR] Recovery checkpoint created: 2026-07-14_...
[ACR] Starting fallback agent: Codex.
```

Verbose mode MAY show diagnostic evidence.

### 22.3 No telemetry by default

The MVP MUST NOT transmit telemetry. Future telemetry MUST be opt-in and documented.

---

## 23. Configuration

### 23.1 Project configuration

Optional committed config:

```text
.agent/config.json
```

Example:

```json
{
  "schemaVersion": "1.0.0",
  "checkpoint": {
    "recentContextMaxChars": 16000,
    "progressRetentionEntries": 500
  },
  "runtime": {
    "preferredAgent": "claude-code",
    "fallbackOrder": ["codex"],
    "maxFailovers": 2,
    "networkRetryCount": 1
  },
  "security": {
    "maxFileReadBytes": 1048576,
    "allowSnapshots": false
  }
}
```

### 23.2 User configuration

Machine-specific configuration SHOULD live under an OS-appropriate config directory. It MAY contain executable paths and adapter preferences, but MUST NOT be required for basic auto-detection.

### 23.3 Precedence

1. CLI flags;
2. environment variables;
3. user config;
4. project config;
5. defaults.

Secrets MUST only be accepted through safe environment or vendor-native mechanisms, never project config.

---

## 24. Testing strategy

### 24.1 Unit tests

Must cover:

- JSON schemas;
- revision conflicts;
- atomic writes;
- managed-block merging;
- path validation;
- digest generation;
- drift classification;
- failure classification;
- resume truncation;
- lock acquisition/staleness;
- redaction.

### 24.2 Integration tests

Must cover:

- initialization in empty and existing repositories;
- preserving existing instruction files;
- Git and non-Git project inspection;
- MCP resource reads;
- all MCP tool success and error paths;
- checkpoint creation;
- safe repair;
- manual handoff.

### 24.3 End-to-end tests

Using fake adapters, demonstrate:

1. Agent A modifies files and exits normally; no failover.
2. Agent A modifies files and reports usage limit; checkpoint then Agent B resumes.
3. Agent A crashes during partial work; Agent B receives partial-edit warning.
4. Authentication failure falls back to a different vendor only.
5. Unknown failure stops safely in non-interactive default mode.
6. Failover loop limit is enforced.
7. Ctrl+C stops without unexpected failover.
8. Concurrent runtime lock prevents two supervisors.

### 24.4 Real-adapter smoke tests

Provide opt-in tests that verify installed Claude Code and Codex commands can be detected and launched. They MUST NOT consume paid model usage in default CI.

### 24.5 MCP compliance testing

Use the official MCP Inspector or equivalent official tooling to verify tool, resource, prompt, lifecycle, and transport behavior.

### 24.6 CI

CI MUST run:

- formatting check;
- lint;
- type check;
- unit tests;
- integration tests;
- fake-agent e2e tests;
- package build;
- dependency/security audit at a reasonable severity threshold.

---

## 25. Milestones and acceptance criteria

### Milestone 0 — Repository foundation

Deliver:

- monorepo/build setup;
- strict TypeScript;
- lint/format/test/CI;
- core schemas;
- documented development commands.

Acceptance:

- clean install and build;
- tests run in CI;
- no placeholder package with empty exports.

### Milestone 1 — Local continuity store

Deliver:

- `.agent/` initialization;
- atomic state writes;
- instruction-file managed blocks;
- revision conflicts;
- checkpoints;
- validation.

Acceptance:

- repeated `acr init` is idempotent;
- existing user instructions survive;
- interrupted-write test preserves valid prior JSON;
- checkpoint manifests validate.

### Milestone 2 — Repository inspector and resume engine

Deliver:

- Git/non-Git inspection;
- drift classifier;
- resume brief;
- safe reconciliation.

Acceptance:

- uncommitted and untracked work is surfaced;
- stale state is flagged;
- exact next action is always present when resumable;
- no destructive commands run.

### Milestone 3 — MCP server

Deliver:

- stdio server;
- required Resources, Tools, Prompts;
- structured errors;
- allowed-root enforcement.

Acceptance:

- official MCP Inspector can list/invoke features;
- path escape tests fail safely;
- revision conflicts are observable;
- all required tools have tests.

### Milestone 4 — CLI and runtime foundation

Deliver:

- required CLI commands;
- PTY process runner;
- runtime lock;
- fake adapter;
- interactive signal behavior.

Acceptance:

- fake agent can be supervised interactively;
- recovery checkpoint is written on abnormal exit;
- Ctrl+C behavior is documented and tested.

### Milestone 5 — Claude Code and Codex adapters

Deliver:

- installation/version detection;
- launch specs;
- MCP/config guidance;
- resume instructions;
- conservative failure classifiers.

Acceptance:

- adapters are separate packages/modules;
- core has no vendor imports;
- smoke tests can be run locally;
- exact known error strings are data/config, not scattered logic.

### Milestone 6 — Automatic failover

Deliver:

- failover coordinator;
- retry policy;
- fallback order;
- loop prevention;
- handoff checkpoint;
- launch of replacement agent.

Acceptance:

- fake-agent e2e demonstrates full usage-limit failover;
- partial edits are preserved;
- unknown errors do not trigger unsafe loops;
- user interruption does not fail over by default.

### Milestone 7 — Release readiness

Deliver:

- README installation and quickstart;
- example Claude Code and Codex MCP configuration;
- architecture and threat-model docs;
- npm package metadata;
- changelog/release workflow;
- sample repository/demo script.

Acceptance:

- a new developer can install, initialize, run fake demo, configure agents, and validate a project by following README only;
- package tarballs contain required runtime files;
- no secrets or local paths are published.

---

## 26. Definition of done for v1.0

The product is v1.0-ready only when all of the following are true:

1. `acr init` safely initializes an existing repository.
2. Claude Code and Codex can both access the same `.agent/` state, directly and/or through MCP.
3. `acr resume` produces a compact evidence-backed handoff.
4. MCP Resources, Tools, and Prompts function over stdio.
5. A supervised fake Claude-like process can hit a simulated usage limit and automatically fail over to a fake Codex-like process.
6. The replacement process receives an exact resume instruction and sees prior filesystem changes.
7. Real Claude Code and Codex adapters can be detected and launched on supported systems.
8. Failure detection is presented as best effort with confidence/evidence.
9. The system does not rotate accounts or bypass usage controls.
10. State writes are atomic and revision-safe.
11. Existing `AGENTS.md` and `CLAUDE.md` content is preserved.
12. Security tests cover path traversal, command injection, secret redaction, and stale locks.
13. CI is green.
14. Documentation describes limitations honestly.

---

## 27. Required README content

The final README MUST include:

1. concise product statement;
2. what ACR can and cannot do;
3. prerequisites;
4. installation;
5. five-minute quickstart;
6. `acr init`, `start`, `resume`, `switch`, `status`, and `doctor` examples;
7. Claude Code setup;
8. Codex setup;
9. manual cross-agent handoff;
10. automatic failover setup;
11. security model;
12. troubleshooting;
13. adapter development;
14. storage development;
15. architecture diagram;
16. limitations of usage-limit detection;
17. contribution and release instructions.

The README MUST explicitly say that both agents must operate on the same working tree, or changes must be synchronized by another mechanism.

---

## 28. Packaging and distribution

Recommended packages:

- `@acr/core`;
- `@acr/mcp-server`;
- `@acr/runtime`;
- `@acr/adapter-claude-code`;
- `@acr/adapter-codex`;
- `acr` CLI meta-package.

For the MVP, a single npm package MAY bundle internal workspaces if this makes installation materially simpler. Public APIs MUST still preserve module boundaries.

The CLI SHOULD support:

```bash
npm install -g acr
# or
npx acr init
```

Do not publish until package-name availability and trademark considerations are checked. The implementation SHOULD make product naming configurable because `ACR` may be a temporary name.

---

## 29. Compatibility and support policy

The project MUST document:

- supported Node versions;
- supported operating systems;
- tested Claude Code versions;
- tested Codex CLI versions;
- MCP SDK/spec version;
- known adapter limitations.

Adapter classifiers SHOULD be data-driven and version-aware because CLI messages change over time.

---

## 30. Future roadmap, explicitly out of v1 scope

Possible later work:

- Streamable HTTP and remote MCP;
- encrypted cloud sync;
- team coordination;
- SQLite/Postgres/Supabase stores;
- Cursor desktop orchestration;
- Gemini CLI stable adapter;
- task-based model routing;
- cost/latency policies;
- web dashboard;
- session replay;
- patch snapshots;
- IDE extensions;
- signed checkpoints;
- shared continuity protocol specification independent of this implementation.

These features MUST NOT delay a reliable local MVP.

---

## 31. Implementation guidance for Codex

When implementing this specification:

1. Begin with schemas and ports, then local storage and repository inspection.
2. Build the fake-agent harness before real automatic failover.
3. Prove process supervision and failover deterministically before adding vendor-specific regexes.
4. Keep vendor adapters thin.
5. Use fixtures for Git repository states.
6. Avoid a “god service”; orchestration should compose small services.
7. Do not create empty interfaces for speculative future systems unless they are required by a current extension point.
8. Do not implement remote cloud sync in v1.
9. Do not spend a milestone generating documentation without executable behavior.
10. After each milestone, run format, lint, type check, tests, and build.
11. Update `docs/IMPLEMENTATION_STATUS.md` with completed acceptance criteria and remaining failures.
12. If a requirement is infeasible due to current vendor CLI limitations, implement the safest degraded behavior and record it in `docs/DEVIATIONS.md`; do not fake support.

---

## 32. Reference sources

The design is based on the following official sources. The implementation agent MUST verify current APIs against the latest stable documentation before coding because SDK and CLI interfaces may change.

- Model Context Protocol specification: https://modelcontextprotocol.io/specification/2025-11-25
- MCP architecture introduction: https://modelcontextprotocol.io/docs/getting-started/intro
- MCP tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP resources: https://modelcontextprotocol.io/specification/2025-11-25/server/resources
- MCP prompts: https://modelcontextprotocol.io/specification/2025-11-25/server/prompts
- MCP transports: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- Official MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- OpenAI Codex MCP documentation: https://developers.openai.com/codex/mcp
- OpenAI Codex `AGENTS.md` documentation: https://developers.openai.com/codex/agent-configuration/agents-md
- OpenAI Codex customization overview: https://developers.openai.com/codex/concepts/customization
- Anthropic Claude Code MCP documentation: https://docs.anthropic.com/en/docs/claude-code/mcp
- Anthropic Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Anthropic Claude Code project memory/instructions: https://docs.anthropic.com/en/docs/claude-code/memory

---

## Appendix A — Example resume briefing

```markdown
# ACR Resume Brief

## Objective
Implement email/password authentication without changing the public API contract.

## Last durable checkpoint
- ID: 2026-07-14T20-31-04Z_8f2a
- Agent: claude-code
- State revision: 12
- Git HEAD: a8c913f

## Evidence-backed completed work
- Added validation schema in `src/auth/schema.ts`.
- Added endpoint tests; 4 tests passed at checkpoint time.

## Work in progress
- `src/auth/service.ts` has uncommitted edits made after the checkpoint.
- Stored state does not describe the last 27 changed lines.
- Treat this as a partial edit and inspect before modifying.

## Verification
- `pnpm test auth`: passed before the latest uncheckpointed edits.
- Type check has not run after the latest edits.

## Exact next action
Inspect `git diff -- src/auth/service.ts`, determine whether password hashing is complete, then run the auth test suite before writing new code.

## Do not repeat
- Do not recreate `src/auth/schema.ts`.
- Do not change the endpoint response shape.

## Warnings
Continuity state is slightly stale relative to the working tree. Repository evidence takes precedence.
```

---

## Appendix B — Example automatic failover sequence

```text
User runs:
  acr start . --agent claude-code --fallback codex

Runtime:
  validates repository
  acquires lock
  refreshes resume brief
  launches Claude Code in PTY

Claude Code:
  edits source files
  optionally checkpoints through MCP
  exits with output matching a known usage-limit signature

Runtime:
  captures exit code and bounded redacted output
  classifies usage_limit, confidence=high
  inspects Git and filesystem
  creates recovery checkpoint
  launches Codex in the same project root
  supplies resume instruction

Codex:
  reads AGENTS.md
  invokes resume_project or reads acr://project/resume-brief
  inspects actual diff
  continues from exact next action
```

---

## Appendix C — Honest limitations

The implementation and README MUST preserve these limitations:

1. Vendor CLI output and exit codes may change, so usage-limit detection cannot be universally guaranteed.
2. ACR cannot recover reasoning that was never written to disk or continuity state.
3. Abrupt termination can leave a partially written source file; ACR identifies and surfaces it but cannot always infer intended code.
4. Automatic failover requires both agent CLIs to be installed and authenticated independently.
5. Both agents need access to the same repository state.
6. Some MCP clients may not automatically call checkpoint tools; runtime recovery inspection is therefore mandatory.
7. ACR does not bypass usage limits; it switches to another independently available agent when configured.

