"use client";

// What a review is about, in words (ReviewsFeed: "Sunday dinner · Hammour, saffron rice, fattoush",
// "Tahini-lemon sauce · part of Hammour dinner", "Ingredient · Freekeh"). Resolved from the plan of
// the last month (one request), single meals and dishes for anything older, and the catalogue.
import type { z } from "zod";
import {
  cuisinesList,
  dishesGet,
  dishesList,
  ingredientsGet,
  methodsList,
  planMealsGet,
  plansList,
  type DishDto,
  type PlanDayDto,
  type PlanMealDto,
  type ReviewDto,
} from "@mealplanner/api-contract/contract";
import { api } from "../admin/api";

export type Review = z.output<typeof ReviewDto>;
export type PlanMeal = z.output<typeof PlanMealDto>;
export type PlanDay = z.output<typeof PlanDayDto>;
export type Dish = z.output<typeof DishDto>;

export interface TargetText {
  /** "Sunday dinner", "Ingredient", "Tahini-lemon sauce". */
  title: string;
  /** "Hammour, saffron rice, fattoush", "part of Hammour dinner". */
  detail: string | null;
  /** The meal the review was about, when known (for "Say more" and the compose screen). */
  meal: PlanMeal | null;
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-09-27" → "Sunday". */
export function weekdayOf(date: string): string {
  return WEEKDAY.format(new Date(`${date}T00:00:00Z`));
}

/** "Sunday dinner" (ReviewComposePhone's header), or "Lunch · today" style when `today` is given. */
export function mealTitle(meal: Pick<PlanMeal, "date" | "slotLabel">): string {
  return `${weekdayOf(meal.date)} ${meal.slotLabel.toLowerCase()}`;
}

export function dayTitle(date: string): string {
  return `${weekdayOf(date)} ${DAY.format(new Date(`${date}T00:00:00Z`))}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The names of the parts of a meal's dish: "Hammour, saffron rice, fattoush". */
export function partsText(dish: Dish | undefined): string | null {
  if (dish === undefined) return null;
  const names = dish.components.filter((c) => c.required).map((c) => c.name);
  if (names.length === 0) return null;
  return names.map((n, i) => (i === 0 ? n : n.charAt(0).toLowerCase() + n.slice(1))).join(", ");
}

export interface Resolver {
  describe(review: Review): TargetText;
  dishes: Map<string, Dish>;
}

/**
 * Loads what the feed needs to describe `reviews`, in a few requests: the plan of the last 31 days,
 * missing meals one by one (at most 20), the dishes of meals with part reviews, and the catalogue
 * names of dish / ingredient / cuisine / method targets.
 */
export async function loadResolver(
  reviews: readonly Review[],
  now = new Date(),
): Promise<Resolver> {
  const from = new Date(now.getTime() - 31 * 86_400_000);
  const [plans, dishNames, cuisines, methods] = await Promise.all([
    api.call(plansList, { query: { from: isoDay(from), to: isoDay(now) } }).catch(() => ({
      days: [] as PlanDay[],
    })),
    api.call(dishesList, { query: {} }),
    api.call(cuisinesList, {}),
    api.call(methodsList, {}),
  ]);
  const meals = new Map<string, PlanMeal>();
  const days = new Map<string, PlanDay>();
  const plates = new Map<string, PlanMeal>();
  for (const day of plans.days) {
    days.set(day.id, day);
    for (const meal of day.meals) {
      meals.set(meal.id, meal);
      for (const plate of meal.plates) plates.set(plate.id, meal);
    }
  }
  const mealIdOf = (r: Review): string | null =>
    r.targetType === "plan_meal" ? r.targetId : r.planMealId;
  const missing = [
    ...new Set(reviews.map(mealIdOf).filter((id): id is string => id !== null && !meals.has(id))),
  ].slice(0, 20);
  await Promise.all(
    missing.map(async (id) => {
      try {
        meals.set(id, await api.call(planMealsGet, { params: { id } }));
      } catch {
        // A meal that was replaced since the review: described without its details.
      }
    }),
  );
  const partDishIds = new Set<string>();
  for (const r of reviews) {
    const id = mealIdOf(r);
    const meal = id === null ? undefined : meals.get(id);
    if (meal !== undefined) partDishIds.add(meal.dishId);
    if (r.targetType === "dish") partDishIds.add(r.targetId);
  }
  const dishes = new Map<string, Dish>();
  await Promise.all(
    [...partDishIds].slice(0, 40).map(async (id) => {
      try {
        dishes.set(id, await api.call(dishesGet, { params: { id } }));
      } catch {
        // A dish that is gone: its name comes from the library list, if at all.
      }
    }),
  );
  const ingredientIds = [
    ...new Set(reviews.filter((r) => r.targetType === "ingredient").map((r) => r.targetId)),
  ].slice(0, 40);
  const ingredients = new Map<string, string>();
  await Promise.all(
    ingredientIds.map(async (id) => {
      try {
        ingredients.set(id, (await api.call(ingredientsGet, { params: { id } })).name);
      } catch {
        // Unknown ingredient: shown as "Ingredient".
      }
    }),
  );
  const dishName = new Map((dishNames.dishes ?? []).map((d) => [d.id, d.name]));
  const cuisineName = new Map((cuisines.cuisines ?? []).map((c) => [c.key, c.label]));
  const cuisineById = new Map((cuisines.cuisines ?? []).map((c) => [c.id, c.label]));
  const methodName = new Map((methods.methods ?? []).map((m) => [m.key, m.label]));
  const methodById = new Map((methods.methods ?? []).map((m) => [m.id, m.label]));

  function componentOf(meal: PlanMeal | null, id: string) {
    const dish = meal === null ? undefined : dishes.get(meal.dishId);
    for (const d of dish === undefined ? dishes.values() : [dish])
      for (const c of d.components) {
        if (c.id === id) return { dish: d, component: c, variant: null };
        const v = c.variants.find((x) => x.id === id);
        if (v !== undefined) return { dish: d, component: c, variant: v };
      }
    return null;
  }

  function describe(r: Review): TargetText {
    const mealId = mealIdOf(r);
    const meal = mealId === null ? null : (meals.get(mealId) ?? null);
    switch (r.targetType) {
      case "plan_meal":
      case "plate": {
        const m = r.targetType === "plate" ? (plates.get(r.targetId) ?? meal) : meal;
        if (m === null) return { title: "A meal", detail: null, meal: null };
        return {
          title: mealTitle(m),
          detail: partsText(dishes.get(m.dishId)) ?? m.dishName,
          meal: m,
        };
      }
      case "component":
      case "variant": {
        const found = componentOf(meal, r.targetId);
        const name =
          found === null
            ? "Part of a dish"
            : found.variant === null
              ? found.component.name
              : `${found.component.name} · ${found.variant.label.toLowerCase()}`;
        const of =
          meal !== null ? `${meal.dishName} ${meal.slotLabel.toLowerCase()}` : found?.dish.name;
        return { title: name, detail: of === undefined ? null : `part of ${of}`, meal };
      }
      case "dish":
        return {
          title: dishes.get(r.targetId)?.name ?? dishName.get(r.targetId) ?? "A dish",
          detail: "Dish",
          meal,
        };
      case "ingredient":
        return { title: "Ingredient", detail: ingredients.get(r.targetId) ?? null, meal: null };
      case "cuisine":
        return {
          title: "Cuisine",
          detail: cuisineName.get(r.targetId) ?? cuisineById.get(r.targetId) ?? r.targetId,
          meal: null,
        };
      case "method":
        return {
          title: "Cooking method",
          detail: methodName.get(r.targetId) ?? methodById.get(r.targetId) ?? r.targetId,
          meal: null,
        };
      case "plan_day": {
        const day = days.get(r.targetId);
        return {
          title: "Whole day",
          detail: day === undefined ? null : dayTitle(day.date),
          meal: null,
        };
      }
    }
  }

  return { describe, dishes };
}

/** "20 min ago", "2 days ago", "last week", or a date. */
export function ago(iso: string, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${String(m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${String(h)} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${String(d)} days ago`;
  if (d < 14) return "last week";
  return DAY.format(new Date(iso));
}
