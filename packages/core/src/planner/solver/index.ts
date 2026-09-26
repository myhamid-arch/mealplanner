// Portion solver (04 §4 PLN-5 … 8): @mealplanner/core/planner/solver.
export * as solverConfig from "./config.js";
export { adjusterOptions, variantAllowed, type AdjusterOption } from "./eligibility.js";
export { SolverError, type SolverErrorCode } from "./errors.js";
export { loadPortionSolver } from "./highs.js";
export { solvePlate } from "./solve.js";
export type {
  ComponentForSolve,
  DishForSolve,
  MacroKey,
  MemberCtx,
  PlateSolution,
  PlateStatus,
  SolvePlateInput,
  VariantForSolve,
} from "./types.js";
