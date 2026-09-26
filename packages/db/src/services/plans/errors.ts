// Typed errors of the plan services; the API maps them to problem+json (ARC-5).
export type PlanServiceErrorCode = "not_found" | "invalid" | "refused" | "limit";

export class PlanServiceError extends Error {
  constructor(
    readonly code: PlanServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlanServiceError";
  }
}
