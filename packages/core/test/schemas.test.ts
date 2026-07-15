import { describe, expect, it } from "vitest";

import {
  checkpointManifestSchema,
  currentStateSchema,
  runtimeStateSchema,
  schemaVersion,
  sha256
} from "../src/index.js";

describe("core schemas", () => {
  it("parses a valid current state document", () => {
    const parsed = currentStateSchema.parse({
      schemaVersion,
      revision: 1,
      updatedAt: "2026-07-14T21:00:00.000Z",
      updatedBy: {
        agent: "codex",
        adapterVersion: "1.0.0",
        sessionId: "session-1"
      },
      project: {
        id: "project-1",
        rootFingerprint: sha256("/tmp/project"),
        defaultBranch: "main"
      },
      objective: {
        summary: "Implement the MVP",
        acceptanceCriteria: ["Tests pass"],
        constraints: ["Do not use destructive git commands"]
      },
      activeTask: {
        id: "TASK-001",
        title: "Milestone 0",
        status: "in_progress",
        startedAt: "2026-07-14T21:00:00.000Z",
        lastCheckpointId: null
      },
      completedSteps: [],
      inProgressSteps: ["Create workspace"],
      nextSteps: ["Run CI"],
      touchedFiles: {
        created: ["package.json"],
        modified: [],
        deleted: []
      },
      verification: {
        commands: ["npm run test"],
        passed: [],
        failed: [],
        notRunReason: null
      },
      knownIssues: [],
      blockers: [],
      decisions: [],
      conversationMemory: {
        userIntent:
          "Ship the MVP without losing user requirements across handoff.",
        userConstraints: ["Do not use destructive git commands"],
        userPreferences: ["Prefer compact summaries over full transcripts"],
        rejectedApproaches: ["Do not depend on hidden provider chat history"],
        openQuestions: ["Should full transcripts ever be optional?"],
        importantContext: [
          "The product currently stores work state, not chat history."
        ]
      },
      lastSuccessfulAction: null,
      lastFailedAction: null,
      recovery: {
        resumeFrom: "Run install and validate the workspace.",
        inspectFirst: ["package.json"],
        doNotRepeat: [],
        confidence: "high"
      },
      repositoryEvidence: {
        head: null,
        branch: null,
        isDirty: true,
        statusDigest: sha256("dirty"),
        diffDigest: null,
        capturedAt: "2026-07-14T21:00:00.000Z"
      }
    });

    expect(parsed.activeTask.status).toBe("in_progress");
  });

  it("parses a valid runtime state document", () => {
    const parsed = runtimeStateSchema.parse({
      schemaVersion,
      runtimeId: "runtime-1",
      projectRoot: "/tmp/project",
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

    expect(parsed.mcp.transport).toBe("stdio");
  });

  it("rejects absolute repository-relative file paths", () => {
    expect(() =>
      checkpointManifestSchema.parse({
        checkpointId: "cp-1",
        schemaVersion,
        timestamp: "2026-07-14T21:00:00.000Z",
        createdBy: {
          agent: "codex",
          adapterVersion: "1.0.0",
          sessionId: "session-1"
        },
        reason: "checkpoint",
        currentStateRevision: 1,
        gitHead: null,
        branch: null,
        statusDigest: sha256("status"),
        diffDigest: null,
        touchedPaths: {
          created: ["/tmp/file.ts"],
          modified: [],
          deleted: []
        },
        verificationResults: {
          passed: [],
          failed: []
        },
        safeToResume: true,
        parentCheckpointId: null,
        snapshotRefs: []
      })
    ).toThrowError(/repository-relative POSIX-style/);
  });
});
