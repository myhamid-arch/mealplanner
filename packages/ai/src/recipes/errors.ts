// Typed errors of the recipe generator (REC-2: no silent failure).

export type RecipeGenerationErrorCode =
  /** No credential is configured; the planner falls back to the library and says so. */
  | "disabled"
  /** The first model call failed (refusal, max_tokens, parse_null, API error); see `cause`. */
  | "model_call"
  /** The ai_generation audit row could not be written (DM-7). */
  | "record_failed"
  /** The survivors could not be saved through the change-set port. */
  | "save_failed";

export class RecipeGenerationError extends Error {
  readonly code: RecipeGenerationErrorCode;

  constructor(code: RecipeGenerationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RecipeGenerationError";
    this.code = code;
  }
}
