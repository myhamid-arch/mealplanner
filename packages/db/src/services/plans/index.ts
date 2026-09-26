// @mealplanner/db/services/plans: the planner's database side (R-2 wiring of 04 §11): planner input,
// saving plans and swaps, alternatives, re-solving (`plates.resolve`, `plates.substitute`), the
// cook-sheet read model, nutrition recompute (`nutrition.recompute`) and the recipe generator's
// persistence ports.
export {
  loadDbCatalog,
  factorsById,
  per100gOf,
  type DbCatalog,
  type CatalogIngredientRow,
} from "./catalog.js";
export {
  recomputeNutrition,
  variantInputOf,
  type RecomputeInput,
  type RecomputeResult,
} from "./nutrition.js";
export {
  CONTEXT_DAYS,
  addDays,
  loadPlanInput,
  loadPlanPool,
  loadPlannedMeals,
  toPlanDishes,
  toJson,
  isUntargeted,
  type PlanPool,
  type StoredBreakdown,
  type StoredDeviation,
  type StoredTarget,
} from "./load-input.js";
export {
  GENERATOR_VERSION,
  adjusterRowsOp,
  cookMealOf,
  mealRows,
  saveDaysOp,
  savePlan,
  type ChangeActorInput,
} from "./store.js";
export {
  ALTERNATIVES,
  MEAL_SEED,
  loadMealState,
  planAlternatives,
  resolvePlates,
  solveMealWith,
  swapMeal,
  swapOp,
  type Alternative,
  type MealState,
  type ResolveReport,
} from "./meal.js";
export { cookSheetFor, type StoredDay } from "./cook-sheet.js";
export {
  generatePlan,
  generationProposal,
  type GeneratePlanArgs,
  type GeneratePlanResult,
} from "./generate.js";
export {
  SUBSTITUTE_DAYS,
  substituteUnavailable,
  type SubstituteReport,
  type SubstitutesPort,
} from "./substitute.js";
export {
  DEFAULT_AI_RECIPE_DAILY_LIMIT,
  aiDishesToday,
  localMidnight,
  recordAiGeneration,
  saveGeneratedDishes,
  type AiGenerationInput,
  type GeneratedDishInput,
  type NewIngredientInput,
  type SurvivorInput,
} from "./generation.js";
export { PlanServiceError, type PlanServiceErrorCode } from "./errors.js";
export {
  JOB_EVENT_CHANNEL,
  JOB_KINDS,
  TERMINAL_EVENTS,
  appendJobEvent,
  claimJob,
  createJob,
  failedJobs,
  finishJob,
  jobEventsAfter,
  jobOf,
  queuedJobs,
  type JobEventRow,
  type JobKind,
  type JobRow,
} from "./jobs.js";
export { followUpJobs, touchedEntityNames, type FollowUp } from "./followups.js";
export {
  copyPayload,
  dishTree,
  freeSlug,
  withNewIds,
  type DishTree,
  type TreeComponent,
  type TreeLine,
  type TreeVariant,
} from "./dish-tree.js";
