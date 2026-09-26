// Independent measurement for the SC-3 test: each member's FBK-4 plate appeal, built from the
// stored plate and recipe rows here rather than through the service's own loader.
import { writeFileSync } from "node:fs";
import { evaluateAppeal, type AppealPlate } from "@mealplanner/core/learning/preferences";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../src/repos/index.js";
import { must } from "../support/must.js";

export async function plateOf(
  db: Executor,
  ctx: HouseholdContext,
  planMealId: string,
  memberId: string,
): Promise<AppealPlate> {
  const r = createRepos(db, ctx);
  const meal = must(await r.plan_meal.get({ id: planMealId }), "meal");
  const dish = must(await r.dish.get({ id: meal.dishId }), "dish");
  const cuisine = must(await r.cuisine.get({ id: dish.cuisineId }), "cuisine");
  const [plate] = await r.plate.list({ planMealId, memberId });
  const variants = [];
  for (const item of await r.plate_item.list({ plateId: must(plate, "plate").id })) {
    const variant = must(await r.variant.get({ id: item.variantId }), "variant");
    const method = must(await r.preparation_method.get({ id: variant.methodId }), "method");
    const core = new Set<string>();
    for (const vi of await r.variant_ingredient.list({ variantId: variant.id })) {
      const ing = must(await r.ingredient.get({ id: vi.ingredientId }), "ingredient");
      if (ing.category !== "herb_spice" && ing.slug !== "water") core.add(ing.id);
    }
    variants.push({ variantId: variant.id, methodKey: method.key, coreIngredientIds: [...core] });
  }
  return { dishId: dish.id, cuisineKey: cuisine.key, variants };
}

export async function appealOf(
  db: Executor,
  ctx: HouseholdContext,
  planMealId: string,
  memberId: string,
): Promise<number> {
  const prefs = await createRepos(db, ctx).preference.list();
  return evaluateAppeal(prefs, memberId, await plateOf(db, ctx, planMealId, memberId)).appeal;
}

/** Appends a measured figure for the verify script (LEAF_132_MEASURE_OUT), when set. */
export function recordMeasurement(name: string, values: Record<string, number | boolean>): void {
  const out = process.env.LEAF_132_MEASURE_OUT;
  if (out === undefined || out === "") return;
  writeFileSync(out, `${JSON.stringify({ name, ...values })}\n`, { flag: "a" });
}
