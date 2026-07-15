import { z } from "zod";

import {
  agentIdentitySchema,
  isoDateTimeSchema,
  schemaVersion,
  touchedFilesSchema
} from "./common.js";

export const checkpointManifestSchema = z.object({
  checkpointId: z.string().min(1),
  schemaVersion: z.literal(schemaVersion),
  timestamp: isoDateTimeSchema,
  createdBy: agentIdentitySchema,
  reason: z.string().min(1),
  currentStateRevision: z.number().int().nonnegative(),
  gitHead: z.string().nullable(),
  branch: z.string().nullable(),
  statusDigest: z.string().min(1),
  diffDigest: z.string().nullable(),
  touchedPaths: touchedFilesSchema,
  verificationResults: z.object({
    passed: z.array(z.string()),
    failed: z.array(z.string())
  }),
  safeToResume: z.boolean(),
  parentCheckpointId: z.string().nullable(),
  snapshotRefs: z.array(z.string())
});

export type CheckpointManifest = z.infer<typeof checkpointManifestSchema>;
