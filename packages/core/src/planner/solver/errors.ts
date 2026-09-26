// Typed errors of the portion solver.

export type SolverErrorCode = "not_loaded" | "invalid_input" | "engine_error";

export class SolverError extends Error {
  readonly code: SolverErrorCode;

  constructor(code: SolverErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SolverError";
    this.code = code;
  }
}
