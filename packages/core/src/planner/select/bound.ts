// An upper bound on a candidate's PLN-9 score at a meal, computed without solving its plates
// (CP3 finding 1: skip solves of candidates that cannot enter the beam; exact, see day.ts).
//
// - MacroFit ≤ 1 (exact 1 with no targeted attendee).
// - Appeal: each attendee's FBK-4 appeal is at most 0.35·dish + 0.20·(best variant) + 0.15·cuisine
//   + 0.10·(best method) + 0.15·(best core ingredient) over the variants they may be served, with 0
//   in each maximum (a term of nothing served is 0); the household mix is monotone in every member.
// - Economy: f(r, a) = (r − 1.5a)/(r + a) rises with r and falls with a, so it is at most
//   f(core in the window over every variant, the fewest new ingredients any required component must
//   bring); the kitchen penalty is ≥ 0.
// - Variety: the cuisine penalties do not depend on variants and are exact; the main-protein
//   penalty is left out.
import { APPEAL_WEIGHTS } from "../../learning/preferences/index.js";
import { variantKey } from "../../learning/preferences/index.js";
import { variantAllowed } from "../solver/index.js";
import {
  ECONOMY_NEW_INGREDIENT_WEIGHT,
  VARIETY_CUISINE_REPEAT_LIMIT,
  VARIETY_CUISINE_THIRD_TIME,
  VARIETY_SAME_CUISINE_AS_PREVIOUS,
} from "./config.js";
import type { MealSpec } from "./meals.js";
import type { MealContext, Run } from "./run.js";
import type { PlanDish, PlanVariant } from "./types.js";

/** The variants of each component this attendee may be served (the solver's exclusion rule). */
function allowedVariants(
  run: Run,
  memberId: string,
  spec: MealSpec,
  dish: PlanDish,
): PlanVariant[] {
  const ctx = run.household.ctx(memberId, spec.slot, dish, []);
  return dish.components.flatMap((c) => c.variants.filter((v) => variantAllowed(v, ctx)));
}

/** Upper bound of the member's FBK-4 appeal for the dish, in [−1, 1]. */
export function appealUpperBound(
  run: Run,
  memberId: string,
  spec: MealSpec,
  dish: PlanDish,
): number {
  const prefs = run.household.prefs;
  const score = (type: "dish" | "cuisine" | "method" | "ingredient", key: string) =>
    prefs.score(memberId, type, key);
  const variants = allowedVariants(run, memberId, spec, dish);
  const best = (values: number[]) => Math.max(0, ...values);
  const a =
    APPEAL_WEIGHTS.dish * score("dish", dish.id) +
    APPEAL_WEIGHTS.variant * best(variants.map((v) => score("dish", variantKey(dish.id, v.id)))) +
    APPEAL_WEIGHTS.cuisine * score("cuisine", dish.cuisineKey) +
    APPEAL_WEIGHTS.method * best(variants.map((v) => score("method", v.methodKey))) +
    APPEAL_WEIGHTS.ingredient *
      best(
        variants.flatMap((v) =>
          (run.pool.variant(v.id)?.core ?? []).map((i) => score("ingredient", i)),
        ),
      );
  return Math.min(1, Math.max(-1, a));
}

/** Upper bound of the economy component given the window W (PLN-9 §6.1). */
export function economyUpperBound(run: Run, dish: PlanDish, window: ReadonlySet<string>): number {
  const all = new Set(
    dish.components.flatMap((c) => c.variants.flatMap((v) => run.pool.variant(v.id)?.core ?? [])),
  );
  const r = [...all].filter((i) => window.has(i)).length;
  let a = 0;
  for (const c of dish.components) {
    if (!c.required) continue;
    const fewest = Math.min(
      ...c.variants.map(
        (v) => (run.pool.variant(v.id)?.core ?? []).filter((i) => !window.has(i)).length,
      ),
    );
    a = Math.max(a, fewest);
  }
  const raw = r + a === 0 ? 1 : (r - ECONOMY_NEW_INGREDIENT_WEIGHT * a) / (r + a);
  return Math.min(
    1,
    Math.max(0, (raw + ECONOMY_NEW_INGREDIENT_WEIGHT) / (1 + ECONOMY_NEW_INGREDIENT_WEIGHT)),
  );
}

/** Upper bound of `scoreDish(...).total` for the dish at the meal, in the given context. */
export function scoreUpperBound(
  run: Run,
  spec: MealSpec,
  dish: PlanDish,
  context: MealContext,
  appealBound: (memberId: string) => number,
): number {
  const w = run.weightsOn(spec.date);
  const targeted = spec.attendees.some((m) => run.target(spec.date, m, spec.slot.id) !== null);
  const macroFit = 1;
  const bounds = spec.attendees.map(appealBound);
  const mean = bounds.length === 0 ? 0 : bounds.reduce((s, x) => s + x, 0) / bounds.length;
  const appeal =
    bounds.length === 0
      ? 0.5
      : Math.min(
          1,
          Math.max(0, ((1 - w.fairness) * mean + w.fairness * Math.min(...bounds) + 1) / 2),
        );
  const economy = economyUpperBound(run, dish, context.window.ingredients);
  let variety = 1;
  if (context.previous !== null && context.previous.cuisineKey === dish.cuisineKey)
    variety -= VARIETY_SAME_CUISINE_AS_PREVIOUS;
  if (context.window.cuisineMealDays >= VARIETY_CUISINE_REPEAT_LIMIT)
    variety -= VARIETY_CUISINE_THIRD_TIME;
  variety = Math.max(0, variety);
  const sumW = w.macroPrecision + w.appeal + w.ingredientEconomy + w.variety;
  if (sumW <= 0) return 0;
  return (
    (w.macroPrecision * (targeted ? macroFit : 1) +
      w.appeal * appeal +
      w.ingredientEconomy * economy +
      w.variety * variety) /
    sumW
  );
}
