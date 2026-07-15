import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  checkpointManifestSchema,
  currentStateSchema,
  runtimeStateSchema,
  schemaVersion,
  sha256,
  type CheckpointInput,
  type CheckpointSummary,
  type ContinuityStore,
  type CurrentState,
  type DocumentName,
  type InitializeResult,
  type LockHandle
} from "@acr/core";

import { atomicWriteFile } from "./atomic-write.js";
import { RevisionConflictError, StateNotInitializedError } from "./errors.js";
import {
  mergeManagedBlock,
  renderAgentsManagedBlock,
  renderClaudeManagedBlock
} from "./managed-blocks.js";
import {
  acrDir,
  agentDir,
  checkpointsDir,
  currentStatePath,
  documentNames,
  locksDir,
  runtimeStatePath
} from "./paths.js";
import { validateProjectState } from "./validation.js";

function nowIso(): string {
  return new Date().toISOString();
}

function defaultCurrentState(projectRoot: string): CurrentState {
  const now = nowIso();
  return {
    schemaVersion,
    revision: 1,
    updatedAt: now,
    updatedBy: {
      agent: "acr",
      adapterVersion: schemaVersion,
      sessionId: "bootstrap"
    },
    project: {
      id: sha256(projectRoot),
      rootFingerprint: sha256(projectRoot),
      defaultBranch: "main"
    },
    objective: {
      summary: "Set and refine the active repository objective.",
      acceptanceCriteria: [],
      constraints: [
        "Inspect repository truth before trusting continuity state."
      ]
    },
    activeTask: {
      id: "BOOTSTRAP",
      title: "Initialize continuity state",
      status: "in_progress",
      startedAt: now,
      lastCheckpointId: null
    },
    completedSteps: [],
    inProgressSteps: ["Initialize repository continuity state."],
    nextSteps: ["Inspect the repository and set a concrete task goal."],
    touchedFiles: {
      created: [],
      modified: [],
      deleted: []
    },
    verification: {
      commands: [],
      passed: [],
      failed: [],
      notRunReason: "No project-specific verification has run yet."
    },
    knownIssues: [],
    blockers: [],
    decisions: [],
    lastSuccessfulAction: "Initialized continuity state.",
    lastFailedAction: null,
    recovery: {
      resumeFrom:
        "Inspect the working tree and update the active objective before further edits.",
      inspectFirst: [".agent/CURRENT_STATE.json", ".agent/TASKS.md"],
      doNotRepeat: [],
      confidence: "medium"
    },
    repositoryEvidence: {
      head: null,
      branch: null,
      isDirty: false,
      statusDigest: sha256(""),
      diffDigest: null,
      capturedAt: now
    }
  };
}

function defaultRuntimeState(projectRoot: string) {
  return runtimeStateSchema.parse({
    schemaVersion,
    runtimeId: `runtime-${sha256(`${projectRoot}:${nowIso()}`).slice(0, 12)}`,
    projectRoot,
    status: "idle",
    activeAgent: null,
    fallbackOrder: ["codex"],
    startedAt: null,
    lastHeartbeatAt: null,
    mcp: {
      transport: "stdio",
      status: "stopped"
    },
    failover: {
      attempt: 0,
      maxAttempts: 2,
      lastReason: null
    }
  });
}

function defaultDocument(name: DocumentName): string {
  const templates: Record<DocumentName, string> = {
    "PROJECT_CONTEXT.md": [
      "# Project Context",
      "",
      "- Product purpose:",
      "- Architecture:",
      "- Technology stack:",
      "- Important directories:",
      "- Commands:",
      "- Conventions:",
      "- Environment requirements:",
      "- External systems:",
      "- Durable constraints:",
      "- Definition of done:"
    ].join("\n"),
    "TASKS.md": [
      "# Active task",
      "",
      "## Goal",
      "",
      "## Acceptance criteria",
      "",
      "## Status",
      "",
      "## Completed",
      "",
      "## In progress",
      "",
      "## Next",
      "",
      "## Blocked",
      "",
      "## Out of scope"
    ].join("\n"),
    "DECISIONS.md": "# Decisions\n",
    "RECENT_CONTEXT.md": "# Recent Context\n",
    "PROGRESS.md": "# Progress\n"
  };

  return `${templates[name]}\n`;
}

async function ensureDirectory(targetPath: string): Promise<boolean> {
  try {
    const result = await stat(targetPath);
    return result.isDirectory();
  } catch {
    await mkdir(targetPath, { recursive: true });
    return false;
  }
}

async function ensureTextFile(
  targetPath: string,
  content: string
): Promise<"created" | "unchanged"> {
  try {
    await stat(targetPath);
    return "unchanged";
  } catch {
    await atomicWriteFile(targetPath, content);
    return "created";
  }
}

async function updateInstructionFile(
  projectRoot: string,
  fileName: "AGENTS.md" | "CLAUDE.md",
  block: string
): Promise<"created" | "modified" | "unchanged"> {
  const targetPath = path.join(projectRoot, fileName);
  let original = "";

  try {
    original = await readFile(targetPath, "utf8");
  } catch {
    original = "";
  }

  const merged = mergeManagedBlock(original, block).content;
  if (merged === original) {
    return original.length === 0 ? "created" : "unchanged";
  }

  await atomicWriteFile(targetPath, merged);
  return original.length === 0 ? "created" : "modified";
}

async function ensureGitIgnore(projectRoot: string): Promise<boolean> {
  const gitIgnorePath = path.join(projectRoot, ".gitignore");
  const requiredEntries = [".acr/", ".agent/locks/"];
  let original = "";

  try {
    original = await readFile(gitIgnorePath, "utf8");
  } catch {
    original = "";
  }

  const missing = requiredEntries.filter((entry) => !original.includes(entry));
  if (missing.length === 0) {
    return false;
  }

  const next = `${original.trimEnd()}${original.trimEnd() ? "\n" : ""}${missing.join(
    "\n"
  )}\n`;
  await atomicWriteFile(gitIgnorePath, next);
  return true;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export class LocalContinuityStore implements ContinuityStore {
  async initialize(projectRoot: string): Promise<InitializeResult> {
    const created: string[] = [];
    const modified: string[] = [];
    const warnings: string[] = [];

    for (const dirPath of [
      agentDir(projectRoot),
      checkpointsDir(projectRoot),
      path.join(agentDir(projectRoot), "snapshots"),
      locksDir(projectRoot),
      acrDir(projectRoot),
      path.join(acrDir(projectRoot), "sessions"),
      path.join(acrDir(projectRoot), "locks")
    ]) {
      const existed = await ensureDirectory(dirPath);
      if (!existed) {
        created.push(
          path.relative(projectRoot, dirPath) || path.basename(dirPath)
        );
      }
    }

    if (
      (await ensureTextFile(
        path.join(agentDir(projectRoot), "schema-version"),
        `${schemaVersion}\n`
      )) === "created"
    ) {
      created.push(".agent/schema-version");
    }

    for (const name of documentNames) {
      const filePath = path.join(agentDir(projectRoot), name);
      if (
        (await ensureTextFile(filePath, defaultDocument(name))) === "created"
      ) {
        created.push(`.agent/${name}`);
      }
    }

    if (
      (await ensureTextFile(
        currentStatePath(projectRoot),
        `${JSON.stringify(defaultCurrentState(projectRoot), null, 2)}\n`
      )) === "created"
    ) {
      created.push(".agent/CURRENT_STATE.json");
    }

    if (
      (await ensureTextFile(
        runtimeStatePath(projectRoot),
        `${JSON.stringify(defaultRuntimeState(projectRoot), null, 2)}\n`
      )) === "created"
    ) {
      created.push(".acr/runtime.json");
    }

    for (const logFile of ["runtime.log", "failover.log"]) {
      if (
        (await ensureTextFile(path.join(acrDir(projectRoot), logFile), "")) ===
        "created"
      ) {
        created.push(`.acr/${logFile}`);
      }
    }

    const agentsResult = await updateInstructionFile(
      projectRoot,
      "AGENTS.md",
      renderAgentsManagedBlock()
    );
    if (agentsResult === "created") created.push("AGENTS.md");
    if (agentsResult === "modified") modified.push("AGENTS.md");

    const claudeResult = await updateInstructionFile(
      projectRoot,
      "CLAUDE.md",
      renderClaudeManagedBlock()
    );
    if (claudeResult === "created") created.push("CLAUDE.md");
    if (claudeResult === "modified") modified.push("CLAUDE.md");

    if (await ensureGitIgnore(projectRoot)) {
      modified.push(".gitignore");
    }

    const checkpointList = await this.listCheckpoints(projectRoot);
    if (checkpointList.length === 0) {
      const currentState = await this.readCurrentState(projectRoot);
      const checkpointId = `${nowIso().replaceAll(":", "-")}_initial`;
      await this.createCheckpoint(projectRoot, {
        checkpointId,
        reason: "initialization",
        summary: "Initialized ACR continuity state.",
        handoff: "Inspect the repository and update the active objective.",
        currentState,
        safeToResume: true,
        parentCheckpointId: null
      });
      created.push(`.agent/checkpoints/${checkpointId}`);
    }

    const validationIssues = await validateProjectState(projectRoot);
    for (const issue of validationIssues) {
      if (issue.severity === "warning") {
        warnings.push(issue.message);
      }
    }

    return { created, modified, warnings };
  }

  async readCurrentState(projectRoot: string): Promise<CurrentState> {
    try {
      return currentStateSchema.parse(
        await readJsonFile(currentStatePath(projectRoot))
      );
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        throw new StateNotInitializedError(projectRoot);
      }
      throw error;
    }
  }

  async writeCurrentState(
    projectRoot: string,
    next: CurrentState,
    expectedRevision: number
  ): Promise<CurrentState> {
    const current = await this.readCurrentState(projectRoot);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }

    const parsed = currentStateSchema.parse({
      ...next,
      revision: expectedRevision + 1,
      updatedAt: nowIso()
    });
    await atomicWriteFile(
      currentStatePath(projectRoot),
      `${JSON.stringify(parsed, null, 2)}\n`
    );
    return parsed;
  }

  async readDocument(projectRoot: string, name: DocumentName): Promise<string> {
    return readFile(path.join(agentDir(projectRoot), name), "utf8");
  }

  async writeDocument(
    projectRoot: string,
    name: DocumentName,
    content: string
  ): Promise<void> {
    await atomicWriteFile(path.join(agentDir(projectRoot), name), content);
  }

  async createCheckpoint(
    projectRoot: string,
    input: CheckpointInput
  ): Promise<CheckpointSummary> {
    const checkpointPath = path.join(
      checkpointsDir(projectRoot),
      input.checkpointId
    );
    await mkdir(checkpointPath, { recursive: true });

    const manifest = checkpointManifestSchema.parse({
      checkpointId: input.checkpointId,
      schemaVersion,
      timestamp: nowIso(),
      createdBy: input.currentState.updatedBy,
      reason: input.reason,
      currentStateRevision: input.currentState.revision,
      gitHead: input.currentState.repositoryEvidence.head,
      branch: input.currentState.repositoryEvidence.branch,
      statusDigest: input.currentState.repositoryEvidence.statusDigest,
      diffDigest: input.currentState.repositoryEvidence.diffDigest,
      touchedPaths: input.currentState.touchedFiles,
      verificationResults: {
        passed: input.currentState.verification.passed,
        failed: input.currentState.verification.failed
      },
      safeToResume: input.safeToResume,
      parentCheckpointId: input.parentCheckpointId ?? null,
      snapshotRefs: []
    });

    await atomicWriteFile(
      path.join(checkpointPath, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    await atomicWriteFile(
      path.join(checkpointPath, "HANDOFF.md"),
      `${input.summary}\n\n${input.handoff}\n`
    );

    return {
      checkpointId: manifest.checkpointId,
      createdAt: manifest.timestamp,
      reason: manifest.reason,
      safeToResume: manifest.safeToResume
    };
  }

  async listCheckpoints(
    projectRoot: string,
    limit = 20
  ): Promise<CheckpointSummary[]> {
    try {
      const entries = await readdir(checkpointsDir(projectRoot), {
        withFileTypes: true
      });
      const summaries: CheckpointSummary[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const manifest = checkpointManifestSchema.parse(
            await readJsonFile(
              path.join(
                checkpointsDir(projectRoot),
                entry.name,
                "manifest.json"
              )
            )
          );
          summaries.push({
            checkpointId: manifest.checkpointId,
            createdAt: manifest.timestamp,
            reason: manifest.reason,
            safeToResume: manifest.safeToResume
          });
        } catch {
          continue;
        }
      }

      return summaries
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async acquireLock(projectRoot: string, purpose: string): Promise<LockHandle> {
    await mkdir(locksDir(projectRoot), { recursive: true });
    const lockPath = path.join(locksDir(projectRoot), `${purpose}.lock.json`);

    await atomicWriteFile(
      lockPath,
      `${JSON.stringify(
        {
          pid: process.pid,
          hostname: os.hostname(),
          purpose,
          createdAt: nowIso(),
          heartbeatAt: nowIso()
        },
        null,
        2
      )}\n`
    );

    return {
      path: lockPath,
      async release() {
        try {
          await unlink(lockPath);
        } catch {
          return;
        }
      }
    };
  }
}

export function createLocalStore(): ContinuityStore {
  return new LocalContinuityStore();
}
