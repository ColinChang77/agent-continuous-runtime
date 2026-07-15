import { createHash } from "node:crypto";
import { z } from "zod";

export const schemaVersion = "1.0.0" as const;

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const posixRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.includes("\\"), {
    message: "Path must be repository-relative POSIX-style."
  });

export const agentIdentitySchema = z.object({
  agent: z.string().min(1),
  adapterVersion: z.string().min(1),
  sessionId: z.string().min(1)
});

export const repositoryEvidenceSchema = z.object({
  head: z.string().nullable(),
  branch: z.string().nullable(),
  isDirty: z.boolean(),
  statusDigest: z.string().min(1),
  diffDigest: z.string().nullable(),
  capturedAt: isoDateTimeSchema
});

export const touchedFilesSchema = z.object({
  created: z.array(posixRelativePathSchema),
  modified: z.array(posixRelativePathSchema),
  deleted: z.array(posixRelativePathSchema)
});

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
