import { z } from "zod";

import {
  agentIdentitySchema,
  isoDateTimeSchema,
  repositoryEvidenceSchema,
  schemaVersion,
  touchedFilesSchema
} from "./common.js";

export const taskStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "verifying",
  "completed",
  "abandoned"
]);

export const confidenceSchema = z.enum(["low", "medium", "high"]);

export const currentStateSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  revision: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
  updatedBy: agentIdentitySchema,
  project: z.object({
    id: z.string().min(1),
    rootFingerprint: z.string().min(1),
    defaultBranch: z.string().min(1)
  }),
  objective: z.object({
    summary: z.string().min(1),
    acceptanceCriteria: z.array(z.string()),
    constraints: z.array(z.string())
  }),
  activeTask: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: taskStatusSchema,
    startedAt: isoDateTimeSchema,
    lastCheckpointId: z.string().nullable()
  }),
  completedSteps: z.array(z.string()),
  inProgressSteps: z.array(z.string()),
  nextSteps: z.array(z.string()),
  touchedFiles: touchedFilesSchema,
  verification: z.object({
    commands: z.array(z.string()),
    passed: z.array(z.string()),
    failed: z.array(z.string()),
    notRunReason: z.string().nullable()
  }),
  knownIssues: z.array(z.string()),
  blockers: z.array(z.string()),
  decisions: z.array(z.string()),
  lastSuccessfulAction: z.string().nullable(),
  lastFailedAction: z.string().nullable(),
  recovery: z.object({
    resumeFrom: z.string().min(1),
    inspectFirst: z.array(z.string()),
    doNotRepeat: z.array(z.string()),
    confidence: confidenceSchema
  }),
  repositoryEvidence: repositoryEvidenceSchema
});

export type CurrentState = z.infer<typeof currentStateSchema>;
