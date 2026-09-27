"use client";
// Reads behind the recipe library and recipe page: dishes, cuisines, and per-dish ratings and
// use (leaf-1.4.4 SPEC-Q-11): the mean of 1–5 ratings on reviews of the dish, its components and
// variants, and meals / plates of the dish, over the latest 200 reviews (the API maximum) joined
// to the last 31 days of plans (the API's longest range). "Used in N meals" counts that window.
import { api, c, type Dish, type PlanDay, type Review } from "../plan/api";
import { addDays, ratingsByDish, type RatingSummary } from "../plan/logic";

export interface Usage {
  ratings: Map<string, RatingSummary>;
  meals: Map<string, number>;
  reviews: Review[];
  /** plan_meal id → dish id over the window. */
  mealDish: Map<string, string>;
  days: PlanDay[];
}

export async function loadUsage(today: string, details: ReadonlyMap<string, Dish>): Promise<Usage> {
  const [reviews, plans] = await Promise.all([
    api.call(c.reviewsList, { query: { limit: 200 } }).then((r) => r.reviews ?? []),
    api.call(c.plansList, { query: { from: addDays(today, -30), to: addDays(today, 1) } }),
  ]);
  const mealDish = new Map<string, string>();
  const plateDish = new Map<string, string>();
  const meals = new Map<string, number>();
  for (const d of plans.days)
    for (const m of d.meals) {
      mealDish.set(m.id, m.dishId);
      if (d.date <= today) meals.set(m.dishId, (meals.get(m.dishId) ?? 0) + 1);
      for (const p of m.plates) plateDish.set(p.id, m.dishId);
    }
  const partDish = new Map<string, string>();
  for (const d of details.values())
    for (const comp of d.components) {
      partDish.set(comp.id, d.id);
      for (const v of comp.variants) partDish.set(v.id, d.id);
    }
  const ratings = ratingsByDish(reviews, (type, id, planMealId) => {
    if (type === "dish") return id;
    if (type === "component" || type === "variant") return partDish.get(id) ?? null;
    if (type === "plan_meal") return mealDish.get(id) ?? null;
    if (type === "plate")
      return plateDish.get(id) ?? (planMealId === null ? null : (mealDish.get(planMealId) ?? null));
    return null;
  });
  return { ratings, meals, reviews, mealDish, days: plans.days };
}
