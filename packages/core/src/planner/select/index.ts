// Dish scoring and plan search (04 §6–8, PLN-9 … 12): @mealplanner/core/planner/select.
export * as selectConfig from "./config.js";
export { mealsOfDate, type MealSpec } from "./meals.js";
export { retargeted } from "./retarget.js";
export { scoreDish, type ScoreInput } from "./score.js";
export { planDays } from "./week.js";
export type {
  MealKind,
  MemberDayTotal,
  PlanComponent,
  PlanDish,
  PlanFlag,
  PlanFlagKind,
  PlanGenerationRequest,
  PlanIngredient,
  PlanInput,
  PlanMember,
  PlannedMeal,
  PlannedPlate,
  PlanOptions,
  PlanProgress,
  PlanResult,
  PlanVariant,
  PlanWeights,
  ScoreBreakdown,
} from "./types.js";
