// Inputs and outputs of dish scoring and plan search (04 §6–7, PLN-9 … 12; leaf-1.2.3 ADR-1).
// The planner keeps its own structural input types (BLD-8 R-14); db and api leaves map rows onto
// them. `PlanDish` extends the solver's `DishForSolve` with what scoring and the cook sheet need
// (SPEC-Q-1).
import type { VariantInput } from "../../nutrition/index.js";
import type {
  AiGenerationMode,
  DishStatus,
  ExclusionKind,
  HouseholdConfig,
  IngredientCategory,
} from "../../types/index.js";
import type {
  ComponentForSolve,
  DishForSolve,
  PlateSolution,
  PlateStatus,
  VariantForSolve,
} from "../solver/index.js";
import type { SlotTarget } from "../targets/index.js";

/** A variant ingredient as the planner sees it. `slug` resolves exclusion keys (BLD-8 R-36). */
export type PlanIngredient = {
  id: string;
  slug: string;
  category: IngredientCategory;
  dietaryFlags: readonly string[];
};

export type PlanVariant = Omit<VariantForSolve, "ingredients"> & {
  label: string;
  /** preparation_method.key. */
  methodKey: string;
  /** A variant marked `needs_review` removes its dish from planning (PLN-9 §6.3). */
  needsReview: boolean;
  ingredients: readonly PlanIngredient[];
  /** The nutrition-engine input of the variant's reference batch (for raw quantities, PLN-14). */
  input: VariantInput;
  steps: readonly string[];
};

export type PlanComponent = Omit<ComponentForSolve, "variants"> & {
  name: string;
  unitLabel: string | null;
  variants: readonly PlanVariant[];
};

export type PlanDish = Omit<DishForSolve, "components"> & {
  version: number;
  name: string;
  cuisineKey: string;
  slotKeys: readonly string[];
  status: DishStatus;
  components: readonly PlanComponent[];
};

/** The weights in force on one date (planning_weights merged with a weekday preset, SPEC-Q-13). */
export type PlanWeights = {
  macroPrecision: number;
  appeal: number;
  ingredientEconomy: number;
  variety: number;
  fairness: number;
  aiGeneration: AiGenerationMode;
  economyWindowDays: number;
  adjustersEnabled: boolean;
  maxVariantsPerComponent: number;
  /** The weight preset applied on this date, if any. */
  presetName: string | null;
};

export type MealKind = "shared" | "individual";

/** One member's plate at one meal. */
export type PlannedPlate = {
  memberId: string;
  targeted: boolean;
  fitStatus: PlateStatus;
  /** The target the plate was solved against: after kcal re-targeting (R-28); null if untargeted. */
  target: SlotTarget | null;
  /** The target resolver's own slot target (PLN-4); null if untargeted. */
  resolverTarget: SlotTarget | null;
  solution: PlateSolution;
  /** Why the plate is not in tolerance (PLN-8, SC-1); null when it is, or untargeted. */
  flag: string | null;
};

export type ScoreBreakdown = {
  macroFit: number;
  appeal: number;
  economy: number;
  variety: number;
  total: number;
  /** The weights the total used. */
  weights: { macroPrecision: number; appeal: number; ingredientEconomy: number; variety: number };
  reasons: string[];
};

export type PlannedMeal = {
  date: string;
  slotKey: string;
  slotTypeId: string;
  slotLabel: string;
  /** slot_type.default_time, `HH:MM:SS`. */
  time: string;
  /** slot_type.is_packed and reheat_available, for the cook sheet's handling notes (PLN-14). */
  isPacked: boolean;
  reheatAvailable: boolean;
  kind: MealKind;
  /** `shared`, or the member id of an individual meal (plan_meal.member_scope). */
  memberScope: string;
  attendees: string[];
  /** Shared meal: members taken out by a `split_member` override (R2-MEAL-2 "+ Omar: own dish"). */
  splitMembers: string[];
  /** Individual meal created by a `split_member` override. */
  split: boolean;
  dishId: string;
  dishVersion: number;
  locked: boolean;
  scoreBreakdown: ScoreBreakdown;
  plates: PlannedPlate[];
  /** SPEC-Q-15: why the frequency filter was relaxed for this meal; null when it was not. */
  frequencyRelaxed: string | null;
  /** Components limited by PLN-9 §6.4 variant merging: component id → the variants kept. */
  variantLimits: Record<string, string[]>;
  explain: string[];
};

export type PlanFlagKind =
  "infeasible_plate" | "flexible_miss" | "member_day_kcal" | "no_candidate" | "frequency_relaxed";

export type PlanFlag = {
  kind: PlanFlagKind;
  date: string;
  slotKey: string | null;
  memberId: string | null;
  reason: string;
};

/** R-28: one targeted member's day. */
export type MemberDayTotal = {
  memberId: string;
  date: string;
  /** Sum of the resolver's slot kcal targets (= the daily target). */
  kcalTarget: number;
  kcalActual: number;
  /** ±`tolerance.kcal`: the sum of the resolver's slot bands. */
  band: number;
  within: boolean;
  /** Slots whose plate is not in tolerance; a non-empty list flags the member-day (SPEC-Q-2). */
  flaggedSlots: string[];
};

/** PLN-12: a request for new dishes (SPEC-Q-1, SPEC-Q-12). */
export type PlanGenerationRequest = {
  date: string;
  slotKey: string;
  count: number;
  palette: { slug: string; timesUsed: number }[];
  avoidRecentCuisines: string[];
  avoidDishes: string[];
  reason: string;
};

export type PlanProgress =
  | { type: "day_started"; date: string }
  | { type: "meal_planned"; date: string; slotKey: string; memberScope: string; dishId: string }
  | { type: "ai_generating"; date: string; slotKey: string; reason: string }
  | { type: "improvement_pass"; pass: number; swaps: number }
  | { type: "retargeting"; date: string }
  | { type: "done"; ms: number };

export type PlanInput = {
  config: HouseholdConfig;
  /** ISO dates to plan, in any order (planned in date order). */
  dates: readonly string[];
  /** The candidate pool: seed library, household and AI dishes. */
  dishes: readonly PlanDish[];
  /** Global adjuster dishes (PLN-6); the household list in `config.adjusters` narrows them. */
  adjusters: readonly PlanDish[];
  /** Locked meals on the planned dates: kept unchanged (PLN-13). */
  locked?: readonly PlannedMeal[];
  /** Meals outside `dates` (earlier or later plans), for the economy window and frequency. */
  context?: readonly PlannedMeal[];
};

export type PlanOptions = {
  seed: number;
  onProgress?: (e: PlanProgress) => void;
  requestDishes?: (request: PlanGenerationRequest) => Promise<PlanDish[]>;
};

export type PlanMember = {
  id: string;
  displayName: string;
  targeted: boolean;
  /** Allergy exclusions, own and household-level, for the cook sheet (R2-UX-2). */
  allergies: Array<{ kind: ExclusionKind; key: string }>;
};

export type PlanResult = {
  seed: number;
  dates: string[];
  members: PlanMember[];
  weights: Record<string, PlanWeights>;
  days: Array<{ date: string; meals: PlannedMeal[] }>;
  memberDays: MemberDayTotal[];
  flags: PlanFlag[];
  generationRequests: PlanGenerationRequest[];
  /** Every dish and adjuster a plate uses, by id. */
  dishes: Record<string, PlanDish>;
  stats: {
    solves: number;
    cacheHits: number;
    infeasiblePlates: number;
    improvementSwaps: number;
    ms: number;
  };
};
