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

const emptyConversationMemory = {
  userIntent: "",
  userConstraints: [] as string[],
  userPreferences: [] as string[],
  rejectedApproaches: [] as string[],
  openQuestions: [] as string[],
  importantContext: [] as string[]
};

export const conversationMemorySchema = z
  .object({
    userIntent: z.string().default(""),
    userConstraints: z.array(z.string()).default([]),
    userPreferences: z.array(z.string()).default([]),
    rejectedApproaches: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
    importantContext: z.array(z.string()).default([])
  })
  // State created before conversation memory was introduced must remain
  // readable. The next normal state write persists this migrated shape.
  .default(emptyConversationMemory);

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
    notRunReason: z.string().nullable(),
    // Legacy state did not bind verification results to repository evidence.
    // Keep it readable, but treat those results as unbound during resume.
    repositoryEvidence: repositoryEvidenceSchema.nullable().default(null)
  }),
  knownIssues: z.array(z.string()),
  blockers: z.array(z.string()),
  decisions: z.array(z.string()),
  conversationMemory: conversationMemorySchema,
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
