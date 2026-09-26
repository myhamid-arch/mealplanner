// Inputs and output of the portion solver (04 §4 PLN-5 … 7, BLD-8 R-25 SPEC-Q-1).
// The solver keeps its own structural input types (BLD-8 R-14); the planner maps rows onto them.
import type { Nutrients } from "../../nutrition/index.js";
import type { Appetite, ComponentRole, IngredientCategory, Portioning } from "../../types/index.js";
import type { SlotTarget } from "../targets/index.js";

/** A preparation variant with its computed nutrition (dish_nutrition_cache). */
export type VariantForSolve = {
  id: string;
  isDefault: boolean;
  /** Per 100 g cooked (03 §7). */
  per100g: Nutrients;
  /** The variant's ingredients, for the member's exclusions (SPEC-Q-13). */
  ingredients: ReadonlyArray<{
    id: string;
    category: IngredientCategory;
    dietaryFlags: readonly string[];
  }>;
};

export type ComponentForSolve = {
  id: string;
  role: ComponentRole;
  portioning: Portioning;
  /** Cooked grams per plate. */
  minServingG: number;
  maxServingG: number;
  defaultServingG: number;
  /** The grid for `continuous` portioning. */
  stepG: number;
  /** The grid for `unit` portioning (PLN-5); null otherwise. */
  unitWeightG: number | null;
  /** If false the solver may serve 0 g. */
  required: boolean;
  variants: readonly VariantForSolve[];
};

export type DishForSolve = {
  id: string;
  /** PLN-6 slot suitability of adjusters. */
  isPackable: boolean;
  servedColdOk: boolean;
  components: readonly ComponentForSolve[];
};

/** Who the plate is for and the slot it is served at. */
export type MemberCtx = {
  memberId: string;
  /** PLN-7 untargeted portions. */
  appetite: Appetite;
  /** FBK-5 learned role bias; a missing role is 1.0. */
  roleBias: Partial<Record<ComponentRole, number>>;
  /** Appeal of each variant for this member, in [−1, 1]; missing is 0. */
  variantAppeal: Readonly<Record<string, number>>;
  /** Appeal of each adjuster dish for this member, in [−1, 1]; missing is 0. */
  dishAppeal: Readonly<Record<string, number>>;
  /** The member's hard exclusions (household-level ones included). */
  exclusions: {
    ingredientIds: readonly string[];
    categories: readonly string[];
    dietaryFlags: readonly string[];
  };
  slot: { key: string; isPacked: boolean; reheatAvailable: boolean };
};

export type MacroKey = "kcal" | "protein" | "carbs" | "fat";

export type PlateStatus = "in_tolerance" | "flexible_miss" | "infeasible" | "untargeted";

export type PlateSolution = {
  status: PlateStatus;
  /** Served components only (cooked grams > 0), in dish order. */
  items: Array<{ componentId: string; variantId: string; cookedG: number }>;
  adjusters: Array<{ dishId: string; variantId: string; cookedG: number }>;
  /** Nutrients of the whole plate, adjusters included; `carbs` is available carbohydrate. */
  actual: Nutrients;
  /** `actual − target`; carbs on the target's carbohydrate basis. Zero for untargeted plates. */
  deviation: Record<MacroKey, number>;
  objective: number;
  /** 1 − mean(|dev| / tol), clamped to [0, 1]; 0 when infeasible. */
  fit: number;
  explain: string[];
};

export type SolvePlateInput = {
  dish: DishForSolve;
  /** null for an untargeted member (PLN-7). */
  target: SlotTarget | null;
  member: MemberCtx;
  /** Adjuster dishes the household allows (empty when adjusters are disabled). */
  adjusters: DishForSolve[];
};
