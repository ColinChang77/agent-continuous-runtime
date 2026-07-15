import { z } from "zod";

import { isoDateTimeSchema, schemaVersion } from "./common.js";

export const runtimeStatusSchema = z.enum([
  "idle",
  "starting",
  "running",
  "checkpointing",
  "failing_over",
  "stopped",
  "failed"
]);

export const runtimeStateSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  runtimeId: z.string().min(1),
  projectRoot: z.string().min(1),
  status: runtimeStatusSchema,
  activeAgent: z.string().nullable(),
  fallbackOrder: z.array(z.string()),
  startedAt: isoDateTimeSchema.nullable(),
  lastHeartbeatAt: isoDateTimeSchema.nullable(),
  mcp: z.object({
    transport: z.literal("stdio"),
    status: z.enum(["stopped", "starting", "running", "failed"])
  }),
  failover: z.object({
    attempt: z.number().int().nonnegative(),
    maxAttempts: z.number().int().nonnegative(),
    lastReason: z.string().nullable()
  })
});

export type RuntimeState = z.infer<typeof runtimeStateSchema>;
