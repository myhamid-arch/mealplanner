// Shared shapes of the REC-5 validation pipeline (leaf-1.3.1 ADR-2).
import type { DishForSolve } from "@mealplanner/core/planner/solver";
import type { Nutrients } from "@mealplanner/core/nutrition";
import type { RecipeCatalogue } from "../catalogue.js";
import type { GenerationContext, SolveTarget } from "../context.js";
import type { DishBatch, GeneratedDish, NewIngredient } from "../schema.js";

export type DefectCode =
  | "unknown_ingredient"
  | "unknown_method"
  | "unknown_cuisine"
  | "unknown_slot"
  | "bad_serving_bounds"
  | "bad_component"
  | "bad_text"
  | "bad_new_ingredient"
  | "excluded_ingredient"
  | "excluded_category"
  | "excluded_dietary_flag"
  | "unverifiable_new_ingredient"
  | "variant_drift"
  | "atwater_variant"
  | "atwater_new_ingredient"
  | "nutrition_error"
  | "duplicate_name"
  | "duplicate_ingredients"
  | "infeasible"
  | "solver_error";

/** REC-5 step numbers: 2 references … 7 solver feasibility (step 1 is the schema, per call). */
export type Step = 2 | 3 | 4 | 5 | 6 | 7;

export type Reason = { step: Step; code: DefectCode; message: string };

/** An existing active dish (household or seed library) for the duplication check. */
export type ExistingDish = { name: string; coreIngredients: readonly string[] };

export type ValidationEnv = {
  catalogue: RecipeCatalogue;
  /** The household's slot keys (REC-2 §2: slot suitability). */
  slotKeys: readonly string[];
  exclusions: GenerationContext["exclusions"];
  existingDishes: readonly ExistingDish[];
  /** Targeted attendees (REC-5 step 7). */
  solveTargets: readonly SolveTarget[];
  /** Adjuster dishes the household allows; empty when adjusters are off. */
  adjusters: readonly DishForSolve[];
};

/** Per-variant nutrition computed in step 5, indexed [component][variant]. */
export type VariantNutrition = { per100g: Nutrients; batchCookedG: number };

export type AcceptedDish = {
  dish: GeneratedDish;
  /** The new ingredients this dish uses (to be created with it, unverified). */
  newIngredients: NewIngredient[];
  nutrition: VariantNutrition[][];
  coreIngredients: string[];
  /** Step 7 plate status per targeted attendee (labels only). */
  plates: Array<{ label: string; status: string; explain: string[] }>;
};

export type DishOutcome =
  | ({ status: "candidate" } & AcceptedDish)
  | ({ status: "infeasible"; reasons: Reason[] } & AcceptedDish)
  | { status: "rejected"; dish: GeneratedDish; reasons: Reason[] };

export type BatchInput = { batch: DishBatch };
