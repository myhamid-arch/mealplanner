// Lookups the rules share: what dish, component and variant a review is about, date windows, and
// the member labels used in titles.
import { DAY_MS, MAX_EVIDENCE_IDS } from "./config.js";
import type {
  InsightComponent,
  InsightDish,
  InsightInput,
  InsightMeal,
  InsightPlate,
  InsightReview,
  InsightVariant,
} from "./types.js";

export class RuleContext {
  readonly dishes = new Map<string, InsightDish>();
  readonly components = new Map<string, { dish: InsightDish; component: InsightComponent }>();
  readonly variants = new Map<
    string,
    { dish: InsightDish; component: InsightComponent; variant: InsightVariant }
  >();
  readonly meals = new Map<string, InsightMeal>();
  readonly plates = new Map<string, { meal: InsightMeal; plate: InsightPlate }>();

  constructor(readonly input: InsightInput) {
    for (const dish of input.dishes) {
      this.dishes.set(dish.id, dish);
      for (const component of dish.components) {
        this.components.set(component.id, { dish, component });
        for (const variant of component.variants)
          this.variants.set(variant.id, { dish, component, variant });
      }
    }
    for (const meal of input.meals) {
      this.meals.set(meal.id, meal);
      for (const plate of meal.plates) this.plates.set(plate.id, { meal, plate });
    }
  }

  /** Reviews created within the last `days` days of the run. */
  reviewsWithin(days: number): InsightReview[] {
    const since = this.input.now.getTime() - days * DAY_MS;
    return this.input.reviews.filter((r) => r.createdAt.getTime() >= since);
  }

  /** The dish a review is about: dish, plan_meal, plate, component and variant targets. */
  dishOf(review: InsightReview): InsightDish | undefined {
    switch (review.targetType) {
      case "dish":
        return this.dishes.get(review.targetId);
      case "plan_meal": {
        const meal = this.meals.get(review.targetId);
        return meal === undefined ? undefined : this.dishes.get(meal.dishId);
      }
      case "plate": {
        const found = this.plates.get(review.targetId);
        return found === undefined ? undefined : this.dishes.get(found.meal.dishId);
      }
      case "component":
        return this.components.get(review.targetId)?.dish;
      case "variant":
        return this.variants.get(review.targetId)?.dish;
      default:
        return undefined;
    }
  }

  /** Whether a review rates the dish as a whole (dish, plan_meal and plate targets; SPEC-Q-12). */
  isWholeDishReview(review: InsightReview): boolean {
    return (
      review.targetType === "dish" ||
      review.targetType === "plan_meal" ||
      review.targetType === "plate"
    );
  }

  /** The meal a review was eaten at, from its context or its target. */
  mealOf(review: InsightReview): InsightMeal | undefined {
    if (review.planMealId !== null) return this.meals.get(review.planMealId);
    if (review.targetType === "plan_meal") return this.meals.get(review.targetId);
    if (review.targetType === "plate") return this.plates.get(review.targetId)?.meal;
    return undefined;
  }

  /**
   * The variant of a component the member ate: the member's plate item at the review's meal, else
   * the component's default variant (FBK-4 "eaten variants").
   */
  eatenVariant(review: InsightReview, componentId: string): InsightVariant | undefined {
    const entry = this.components.get(componentId);
    if (entry === undefined) return undefined;
    const meal = this.mealOf(review);
    const item = meal?.plates
      .find((p) => p.memberId === review.memberId)
      ?.items.find((i) => i.componentId === componentId);
    const fromPlate =
      item === undefined
        ? undefined
        : entry.component.variants.find((v) => v.id === item.variantId);
    return (
      fromPlate ?? entry.component.variants.find((v) => v.isDefault) ?? entry.component.variants[0]
    );
  }

  memberName(memberId: string): string {
    return this.input.config.members.find((m) => m.id === memberId)?.displayName ?? "a member";
  }

  isTargeted(memberId: string): boolean {
    return this.input.config.members.find((m) => m.id === memberId)?.isTargeted === true;
  }

  isActiveMember(memberId: string): boolean {
    const member = this.input.config.members.find((m) => m.id === memberId);
    return member !== undefined && member.archivedAt === null;
  }

  slotLabel(slotTypeId: string): string {
    return this.input.config.slotTypes.find((s) => s.id === slotTypeId)?.label ?? "a meal";
  }
}

/** `YYYY-MM-DD` of `date` shifted by `days` (calendar arithmetic in UTC). */
export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Groups items by a string key, keeping first-seen key order. */
export function groupBy<T>(
  items: Iterable<T>,
  key: (item: T) => string | undefined,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const list = out.get(k);
    if (list === undefined) out.set(k, [item]);
    else list.push(item);
  }
  return out;
}

/**
 * Distinct review ids of the evidence: the most recent `MAX_EVIDENCE_IDS`, sorted. `evidence.count`
 * keeps the full size, so a busy household never exceeds the stored id list's bound.
 */
export function reviewIds(reviews: readonly InsightReview[]): string[] {
  const latest = new Map<string, number>();
  for (const r of reviews) latest.set(r.id, Math.max(latest.get(r.id) ?? 0, r.createdAt.getTime()));
  return [...latest]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_EVIDENCE_IDS)
    .map(([id]) => id)
    .sort();
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
