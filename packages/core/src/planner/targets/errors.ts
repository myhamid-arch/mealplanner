// Typed errors of the target resolver (PLN-4).

export type TargetResolverErrorCode = "invalid_date" | "unknown_member" | "missing_profile";

export class TargetResolverError extends Error {
  readonly code: TargetResolverErrorCode;

  constructor(code: TargetResolverErrorCode, message: string) {
    super(message);
    this.name = "TargetResolverError";
    this.code = code;
  }
}
