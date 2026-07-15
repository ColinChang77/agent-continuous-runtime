import {
  RevisionConflictError,
  StateNotInitializedError
} from "@acr/storage-local";

import { AcrToolError, type AcrErrorCode } from "./errors.js";

export interface ToolEnvelope<T> {
  ok: boolean;
  operation: string;
  projectRoot: string;
  stateRevision: number | null;
  warnings: string[];
  data: T;
}

export function okResult<T>(
  operation: string,
  projectRoot: string,
  stateRevision: number | null,
  data: T,
  warnings: string[] = []
): ToolEnvelope<T> {
  return {
    ok: true,
    operation,
    projectRoot,
    stateRevision,
    warnings,
    data
  };
}

export function toolSuccess<T>(
  operation: string,
  projectRoot: string,
  stateRevision: number | null,
  data: T,
  warnings: string[] = []
) {
  const payload = okResult(
    operation,
    projectRoot,
    stateRevision,
    data,
    warnings
  );
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
  };
}

function normalizeError(error: unknown): {
  code: AcrErrorCode;
  message: string;
  data?: Record<string, unknown>;
} {
  if (error instanceof AcrToolError) {
    return error.data
      ? { code: error.code, message: error.message, data: error.data }
      : { code: error.code, message: error.message };
  }

  if (error instanceof RevisionConflictError) {
    return {
      code: "ACR_REVISION_CONFLICT",
      message: error.message,
      data: {
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision
      }
    };
  }

  if (error instanceof StateNotInitializedError) {
    return {
      code: "ACR_STATE_NOT_INITIALIZED",
      message: error.message,
      data: { projectRoot: error.projectRoot }
    };
  }

  return {
    code: "ACR_INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown internal error."
  };
}

export function toolFailure(
  operation: string,
  projectRoot: string,
  error: unknown,
  stateRevision: number | null = null
) {
  const normalized = normalizeError(error);
  const payload = {
    ok: false,
    operation,
    projectRoot,
    stateRevision,
    warnings: [],
    error: normalized
  };

  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
  };
}
