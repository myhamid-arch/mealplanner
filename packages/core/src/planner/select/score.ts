// PLN-9 dish scoring (04 §6.1–6.2): MacroFit, Appeal, Economy and Variety, each in [0, 1], and
// their weighted mean. Pure; the plan search supplies the plates and the window context.
import {
  ECONOMY_NEW_INGREDIENT_WEIGHT,
  KITCHEN_FREE_VARIANTS,
  KITCHEN_VARIANT_PENALTY,
  VARIETY_CUISINE_REPEAT_LIMIT,
  VARIETY_CUISINE_THIRD_TIME,
  VARIETY_SAME_CUISINE_AS_PREVIOUS,
  VARIETY_SAME_MAIN_PROTEIN,
} from "./config.js";
import type { PlanDish, PlanWeights, ScoreBreakdown } from "./types.js";

export type ScoreInput = {
  dish: PlanDish;
  /** Every attendee's plate. `fit` is the solver's plate fit (targeted only); `appeal` in [−1, 1]. */
  plates: ReadonlyArray<{ memberId: string; targeted: boolean; fit: number; appeal: number }>;
  /** I(d): core ingredients of the served variants (PLN-9: no herb_spice, water). */
  ingredients: readonly string[];
  /** Distinct variants served per component (kitchen batches, SPEC-Q-8). */
  variantsPerComponent: Readonly<Record<string, number>>;
  /** The served main protein ingredient (SPEC-Q-9); null if the dish has none. */
  mainProtein: string | null;
  window: {
    /** W: core ingredients of every other meal in the economy window. */
    ingredients: ReadonlySet<string>;
    /** Other meal-days in the window, sharing an attendee, with the same cuisine. */
    cuisineMealDays: number;
  };
  /** The previous meal of the day sharing an attendee (SPEC-Q-9); null if none. */
  previous: { cuisineKey: string; mainProtein: string | null; dishName: string } | null;
  weights: Pick<
    PlanWeights,
    "macroPrecision" | "appeal" | "ingredientEconomy" | "variety" | "fairness"
  >;
  /** Display names for reasons. */
  label?: { ingredient?: (id: string) => string; member?: (id: string) => string };
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function macroFitOf(plates: ScoreInput["plates"]): number {
  const targeted = plates.filter((p) => p.targeted);
  if (targeted.length === 0) return 1;
  return clamp01(targeted.reduce((s, p) => s + p.fit, 0) / targeted.length);
}

/** Household appeal `(1−f)·mean + f·min`, rescaled from [−1, 1] to [0, 1] (PLN-9 §6.1). */
export function appealOf(plates: ScoreInput["plates"], fairness: number): number {
  if (plates.length === 0) return 0.5;
  const values = plates.map((p) => p.appeal);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const a = (1 - fairness) * mean + fairness * Math.min(...values);
  return clamp01((a + 1) / 2);
}

/**
 * `(|I∩W| − 1.5·|I∖W|) / |I|`, rescaled from [−1.5, 1] to [0, 1], minus 0.05 per variant of a
 * component beyond 2 (SPEC-Q-8); floored at 0. A dish with no core ingredient scores 1.
 */
export function economyOf(
  ingredients: readonly string[],
  window: ReadonlySet<string>,
  variantsPerComponent: Readonly<Record<string, number>>,
): { value: number; reused: string[]; added: string[]; kitchenPenalty: number } {
  const unique = [...new Set(ingredients)];
  const reused = unique.filter((i) => window.has(i));
  const added = unique.filter((i) => !window.has(i));
  const raw =
    unique.length === 0
      ? 1
      : (reused.length - ECONOMY_NEW_INGREDIENT_WEIGHT * added.length) / unique.length;
  const rescaled = (raw + ECONOMY_NEW_INGREDIENT_WEIGHT) / (1 + ECONOMY_NEW_INGREDIENT_WEIGHT);
  const extra = Object.values(variantsPerComponent).reduce(
    (s, n) => s + Math.max(0, n - KITCHEN_FREE_VARIANTS),
    0,
  );
  const kitchenPenalty = KITCHEN_VARIANT_PENALTY * extra;
  return { value: clamp01(rescaled - kitchenPenalty), reused, added, kitchenPenalty };
}

export function varietyOf(
  input: Pick<ScoreInput, "dish" | "mainProtein" | "window" | "previous">,
): {
  value: number;
  penalties: string[];
} {
  const penalties: string[] = [];
  let v = 1;
  const { dish, previous } = input;
  if (previous !== null && previous.cuisineKey === dish.cuisineKey) {
    v -= VARIETY_SAME_CUISINE_AS_PREVIOUS;
    penalties.push(`Same cuisine (${dish.cuisineKey}) as ${previous.dishName} before it`);
  }
  if (input.window.cuisineMealDays >= VARIETY_CUISINE_REPEAT_LIMIT) {
    v -= VARIETY_CUISINE_THIRD_TIME;
    penalties.push(
      `${dish.cuisineKey} already on ${String(input.window.cuisineMealDays)} other days in the window`,
    );
  }
  if (
    previous !== null &&
    input.mainProtein !== null &&
    previous.mainProtein === input.mainProtein
  ) {
    v -= VARIETY_SAME_MAIN_PROTEIN;
    penalties.push(`Same main protein as ${previous.dishName}`);
  }
  return { value: Math.max(0, v), penalties };
}

/** PLN-9: the score of one candidate dish at one meal, with its breakdown and reasons. */
export function scoreDish(input: ScoreInput): ScoreBreakdown {
  const w = input.weights;
  const ingredientName = input.label?.ingredient ?? ((id: string) => id);
  const memberName = input.label?.member ?? ((id: string) => id);
  const macroFit = macroFitOf(input.plates);
  const appeal = appealOf(input.plates, w.fairness);
  const econ = economyOf(input.ingredients, input.window.ingredients, input.variantsPerComponent);
  const variety = varietyOf(input);
  const sumW = w.macroPrecision + w.appeal + w.ingredientEconomy + w.variety;
  const total =
    sumW > 0
      ? (w.macroPrecision * macroFit +
          w.appeal * appeal +
          w.ingredientEconomy * econ.value +
          w.variety * variety.value) /
        sumW
      : 0;

  const reasons: string[] = [];
  const targeted = input.plates.filter((p) => p.targeted);
  if (targeted.length > 0)
    reasons.push(
      `Macro fit ${targeted.map((p) => `${memberName(p.memberId)} ${p.fit.toFixed(2)}`).join(", ")}`,
    );
  const liked = input.plates.filter((p) => p.appeal >= 0.25);
  const disliked = input.plates.filter((p) => p.appeal <= -0.25);
  if (liked.length > 0)
    reasons.push(`Liked by ${liked.map((p) => memberName(p.memberId)).join(", ")}`);
  if (disliked.length > 0)
    reasons.push(`Less liked by ${disliked.map((p) => memberName(p.memberId)).join(", ")}`);
  if (econ.reused.length > 0)
    reasons.push(`Reuses ${econ.reused.map(ingredientName).join(", ")} from the window`);
  if (econ.added.length > 0)
    reasons.push(`New this window: ${econ.added.map(ingredientName).join(", ")}`);
  if (econ.kitchenPenalty > 0)
    reasons.push(
      `Kitchen cooks more than ${String(KITCHEN_FREE_VARIANTS)} variants of a component`,
    );
  reasons.push(...variety.penalties);

  return {
    macroFit: round3(macroFit),
    appeal: round3(appeal),
    economy: round3(econ.value),
    variety: round3(variety.value),
    total,
    weights: {
      macroPrecision: w.macroPrecision,
      appeal: w.appeal,
      ingredientEconomy: w.ingredientEconomy,
      variety: w.variety,
    },
    reasons,
  };
}
