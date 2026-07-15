export type AcrErrorCode =
  | "ACR_INVALID_INPUT"
  | "ACR_PATH_OUTSIDE_ROOT"
  | "ACR_STATE_NOT_INITIALIZED"
  | "ACR_REVISION_CONFLICT"
  | "ACR_LOCKED"
  | "ACR_INVALID_STATE"
  | "ACR_GIT_UNAVAILABLE"
  | "ACR_UNSAFE_REPAIR"
  | "ACR_INTERNAL_ERROR";

export class AcrToolError extends Error {
  constructor(
    readonly code: AcrErrorCode,
    message: string,
    readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AcrToolError";
  }
}
