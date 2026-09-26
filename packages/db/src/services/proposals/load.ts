// Loads the insights engine's input for one household through the scoped repositories (DM-1):
// the configuration, the reviews in the rule window, the plan meals with their plates, and every
// dish, variant and ingredient those refer to (leaf-1.3.3 ADR-1).
import { coreIngredients } from "@mealplanner/core/learning/preferences";
import {
  DAY_MS,
  REVIEW_WINDOW_DAYS,
  addDays,
  type InsightComponent,
  type InsightDish,
  type InsightIngredient,
  type InsightInput,
  type InsightMeal,
  type InsightReview,
} from "@mealplanner/core/learning/rules";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor, type Repos, type TableRows } from "../../repos/index.js";
import { loadHouseholdConfig } from "../config/index.js";

type ReviewRow = TableRows["review"];
type IngredientRow = TableRows["ingredient"];

/** `YYYY-MM-DD` of an instant in a time zone. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export interface LoadedInsightInput {
  input: InsightInput;
  /** Every review not yet processed by an insights run (replies included). */
  unprocessed: ReviewRow[];
  /** Ingredient rows by id, for labels and verification state. */
  ingredientRows: ReadonlyMap<string, IngredientRow>;
}

class DishLoader {
  readonly dishes = new Map<string, InsightDish>();
  readonly ingredients = new Map<string, IngredientRow>();
  private readonly componentDish = new Map<string, string>();
  private readonly variantComponent = new Map<string, string>();

  constructor(private readonly r: Repos) {}

  async ingredient(id: string): Promise<IngredientRow | null> {
    const cached = this.ingredients.get(id);
    if (cached !== undefined) return cached;
    const row = await this.r.ingredient.get({ id });
    if (row !== null) this.ingredients.set(id, row);
    return row;
  }

  async dish(id: string): Promise<InsightDish | undefined> {
    const cached = this.dishes.get(id);
    if (cached !== undefined) return cached;
    const row = await this.r.dish.get({ id });
    if (row === null) return undefined;
    const components: InsightComponent[] = [];
    const rows = [...(await this.r.component.list({ dishId: id }))].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );
    for (const component of rows) {
      this.componentDish.set(component.id, id);
      const variants = [];
      for (const variant of await this.r.variant.list({ componentId: component.id })) {
        this.variantComponent.set(variant.id, component.id);
        const lines = await this.r.variant_ingredient.list({ variantId: variant.id });
        const candidates = [];
        for (const line of lines) {
          const ingredient = await this.ingredient(line.ingredientId);
          if (ingredient !== null)
            candidates.push({
              ingredientId: ingredient.id,
              slug: ingredient.slug,
              category: ingredient.category,
            });
        }
        variants.push({
          id: variant.id,
          label: variant.label,
          isDefault: variant.isDefault,
          ingredientIds: [...new Set(lines.map((l) => l.ingredientId))],
          coreIngredientIds: coreIngredients(candidates),
        });
      }
      components.push({ id: component.id, name: component.name, role: component.role, variants });
    }
    const dish: InsightDish = { id, name: row.name, components };
    this.dishes.set(id, dish);
    return dish;
  }

  async dishOfComponent(componentId: string): Promise<void> {
    if (this.componentDish.has(componentId)) return;
    const component = await this.r.component.get({ id: componentId });
    if (component !== null) await this.dish(component.dishId);
  }

  async dishOfVariant(variantId: string): Promise<void> {
    if (this.variantComponent.has(variantId)) return;
    const variant = await this.r.variant.get({ id: variantId });
    if (variant !== null) await this.dishOfComponent(variant.componentId);
  }
}

async function loadMeal(r: Repos, mealId: string, dates: Map<string, string>) {
  const meal = await r.plan_meal.get({ id: mealId });
  if (meal === null) return undefined;
  let date = dates.get(meal.planDayId);
  if (date === undefined) {
    const day = await r.plan_day.get({ id: meal.planDayId });
    if (day === null) return undefined;
    date = day.date;
    dates.set(day.id, date);
  }
  const plates = [];
  for (const plate of await r.plate.list({ planMealId: meal.id })) {
    const deviation = plate.deviation as { kcal?: unknown } | null;
    plates.push({
      id: plate.id,
      memberId: plate.memberId,
      fitStatus: plate.fitStatus,
      kcalDeviation: typeof deviation?.kcal === "number" ? deviation.kcal : null,
      items: (await r.plate_item.list({ plateId: plate.id })).map((i) => ({
        componentId: i.componentId,
        variantId: i.variantId,
      })),
    });
  }
  const out: InsightMeal = {
    id: meal.id,
    date,
    slotTypeId: meal.slotTypeId,
    dishId: meal.dishId,
    status: meal.status,
    plates,
  };
  return out;
}

export async function loadInsightInput(
  db: Executor,
  ctx: HouseholdContext,
  now: Date,
): Promise<LoadedInsightInput> {
  const r = createRepos(db, ctx);
  const config = await loadHouseholdConfig(db, ctx);
  const today = localDate(now, config.household.timezone);
  const since = now.getTime() - REVIEW_WINDOW_DAYS * DAY_MS;

  const all = await r.review.list();
  const unprocessed = all.filter((row) => row.processedAt === null);
  const reviews: InsightReview[] = all
    .filter(
      (row) =>
        row.parentReviewId === null &&
        row.onBehalfOfMemberId !== null &&
        row.createdAt.getTime() >= since,
    )
    .map((row) => ({
      id: row.id,
      memberId: row.onBehalfOfMemberId ?? "",
      targetType: row.targetType,
      targetId: row.targetId,
      planMealId: row.planMealId,
      rating: row.rating,
      tags: row.tags,
      comment: row.comment,
      createdAt: row.createdAt,
    }));

  // Plan meals from the window's start onwards, plus any meal a review names.
  const from = addDays(today, -REVIEW_WINDOW_DAYS);
  const dates = new Map<string, string>();
  const mealIds: string[] = [];
  for (const day of await r.plan_day.list()) {
    if (day.date < from) continue;
    dates.set(day.id, day.date);
    for (const meal of await r.plan_meal.list({ planDayId: day.id })) mealIds.push(meal.id);
  }
  for (const review of reviews) {
    if (review.planMealId !== null) mealIds.push(review.planMealId);
    if (review.targetType === "plan_meal") mealIds.push(review.targetId);
    if (review.targetType === "plate") {
      const plate = await r.plate.get({ id: review.targetId });
      if (plate !== null) mealIds.push(plate.planMealId);
    }
  }
  const meals: InsightMeal[] = [];
  for (const id of new Set(mealIds)) {
    const meal = await loadMeal(r, id, dates);
    if (meal !== undefined) meals.push(meal);
  }

  const dishes = new DishLoader(r);
  for (const meal of meals) await dishes.dish(meal.dishId);
  for (const review of reviews) {
    if (review.targetType === "dish") await dishes.dish(review.targetId);
    if (review.targetType === "component") await dishes.dishOfComponent(review.targetId);
    if (review.targetType === "variant") await dishes.dishOfVariant(review.targetId);
  }

  const ingredients: InsightIngredient[] = [...dishes.ingredients.values()].map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    nutritionSource: row.nutritionSource,
    householdPrivate: row.createdByHouseholdId !== null,
    verified: row.verifiedAt !== null,
  }));

  return {
    input: {
      now,
      today,
      config,
      reviews,
      dishes: [...dishes.dishes.values()],
      ingredients,
      meals,
    },
    unprocessed,
    ingredientRows: dishes.ingredients,
  };
}
