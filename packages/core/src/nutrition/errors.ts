// Errors for inputs the engine cannot compute honestly (ADR-1, SPEC-Q-6).

export type NutritionErrorCode =
  | "unknown_ingredient"
  | "missing_method_yield"
  | "duplicate_method_yield"
  | "invalid_input"
  | "zero_cooked_mass";

export class NutritionError extends Error {
  readonly code: NutritionErrorCode;

  constructor(code: NutritionErrorCode, message: string) {
    super(message);
    this.name = "NutritionError";
    this.code = code;
  }
}
