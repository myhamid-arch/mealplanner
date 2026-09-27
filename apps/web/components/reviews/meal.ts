"use client";

// The meal a rating or detailed review is about: the plan meal (slot, date, dish, the plates the
// viewer may see) and its dish's parts.
import { dishesGet, planMealsGet } from "@mealplanner/api-contract/contract";
import { api } from "../admin/api";
import type { Dish, PlanMeal } from "./targets";

export interface MealContext {
  meal: PlanMeal;
  dish: Dish;
}

export async function loadMeal(planMealId: string): Promise<MealContext> {
  const meal = await api.call(planMealsGet, { params: { id: planMealId } });
  const dish = await api.call(dishesGet, { params: { id: meal.dishId } });
  return { meal, dish };
}

/** A part of the plate a member ate: the component and the variant on their plate. */
export interface MealPart {
  componentId: string;
  name: string;
  variantLabel: string | null;
  role: string;
}

/**
 * The parts of `memberId`'s plate (ReviewComposePhone "Each part"): the plate's items in dish
 * order, adjuster sides left out (they belong to other dishes). Without a visible plate, the
 * dish's required parts with their default variants.
 */
export function mealParts(ctx: MealContext, memberId: string | null): MealPart[] {
  const plate = ctx.meal.plates.find((p) => p.memberId === memberId);
  const onPlate = new Map(
    (plate?.items ?? []).filter((i) => !i.side).map((i) => [i.componentId, i.variantId]),
  );
  return ctx.dish.components
    .filter((c) => (plate === undefined ? c.required : onPlate.has(c.id)))
    .map((c) => {
      const variantId = onPlate.get(c.id);
      const variant =
        c.variants.find((v) => v.id === variantId) ?? c.variants.find((v) => v.isDefault) ?? null;
      return {
        componentId: c.id,
        name: c.name,
        variantLabel: c.variants.length > 1 && variant !== null ? variant.label : null,
        role: c.role,
      };
    });
}

/** "Lunch · today", "Dinner · yesterday", "Dinner · Sunday" (QuickRatePhone). */
export function whenText(meal: Pick<PlanMeal, "date" | "slotLabel">, now = new Date()): string {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = new Date(`${meal.date}T00:00:00Z`);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  const when =
    diff === 0
      ? "today"
      : diff === 1
        ? "yesterday"
        : diff === -1
          ? "tomorrow"
          : new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(day);
  return `${meal.slotLabel} · ${when}`;
}
