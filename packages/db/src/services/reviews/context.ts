// Loads what learning needs from a review's rows (leaf-1.3.2 ADR-1): the resolved target for FBK-4
// propagation and the component roles for FBK-5. Every read goes through the household-scoped
// repositories (DM-1).
import {
  coreIngredients,
  type EatenVariant,
  type ReviewTargetInput,
} from "@mealplanner/core/learning/preferences";
import type { ComponentRole, HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor, type Repos, type TableRows } from "../../repos/index.js";
import { ReviewTargetError } from "./errors.js";

type ReviewRow = TableRows["review"];
type ComponentRow = TableRows["component"];
type PlateItemRow = TableRows["plate_item"];

/** What one review teaches, for one member. */
export interface ReviewLearningInput {
  memberId: string;
  isTargeted: boolean;
  memberName: string;
  /** Null when the target is outside the FBK-4 table (plan_day). */
  target: ReviewTargetInput | null;
  /** Component roles FBK-5 quantity tags apply to (SPEC-Q-9). */
  roles: ComponentRole[];
  /** Short human label of the target, for the change-set summary. */
  targetLabel: string;
}

class Loader {
  private readonly r: Repos;

  constructor(db: Executor, ctx: HouseholdContext) {
    this.r = createRepos(db, ctx);
  }

  private async one<T>(what: string, row: Promise<T | null>): Promise<T> {
    const found = await row;
    if (found === null) throw new ReviewTargetError(`${what} not found`);
    return found;
  }

  dish(id: string) {
    return this.one(`dish ${id}`, this.r.dish.get({ id }));
  }

  component(id: string) {
    return this.one(`component ${id}`, this.r.component.get({ id }));
  }

  variant(id: string) {
    return this.one(`variant ${id}`, this.r.variant.get({ id }));
  }

  planMeal(id: string) {
    return this.one(`plan_meal ${id}`, this.r.plan_meal.get({ id }));
  }

  plate(id: string) {
    return this.one(`plate ${id}`, this.r.plate.get({ id }));
  }

  async cuisineKey(cuisineId: string): Promise<string> {
    return (await this.one(`cuisine ${cuisineId}`, this.r.cuisine.get({ id: cuisineId }))).key;
  }

  async components(dishId: string): Promise<ComponentRow[]> {
    const rows = await this.r.component.list({ dishId });
    return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  /** The component's default variant (the first by id if none is flagged). */
  async defaultVariantId(componentId: string): Promise<string> {
    const variants = await this.r.variant.list({ componentId });
    const chosen = variants.find((v) => v.isDefault) ?? variants[0];
    if (chosen === undefined)
      throw new ReviewTargetError(`component ${componentId} has no variant`);
    return chosen.id;
  }

  async eaten(variantId: string): Promise<EatenVariant> {
    const variant = await this.variant(variantId);
    const method = await this.one(
      `preparation method ${variant.methodId}`,
      this.r.preparation_method.get({ id: variant.methodId }),
    );
    const candidates = [];
    for (const vi of await this.r.variant_ingredient.list({ variantId })) {
      const ingredient = await this.one(
        `ingredient ${vi.ingredientId}`,
        this.r.ingredient.get({ id: vi.ingredientId }),
      );
      candidates.push({
        ingredientId: ingredient.id,
        slug: ingredient.slug,
        category: ingredient.category,
      });
    }
    return { variantId, methodKey: method.key, coreIngredientIds: coreIngredients(candidates) };
  }

  /** The member's plate items at a meal, or null when the member has no plate there. */
  async plateItems(planMealId: string, memberId: string): Promise<PlateItemRow[] | null> {
    const [plate] = await this.r.plate.list({ planMealId, memberId });
    return plate === undefined ? null : this.r.plate_item.list({ plateId: plate.id });
  }

  itemsOfPlate(plateId: string): Promise<PlateItemRow[]> {
    return this.r.plate_item.list({ plateId });
  }

  async roleOf(componentId: string): Promise<ComponentRole> {
    return (await this.component(componentId)).role;
  }

  planDay(id: string) {
    return this.one(`plan_day ${id}`, this.r.plan_day.get({ id }));
  }

  planMeals(planDayId: string) {
    return this.r.plan_meal.list({ planDayId });
  }
}

/**
 * A dish eaten in some context: the plate's items when there is a plate, otherwise the default
 * variant of every component (FBK-4). Roles follow SPEC-Q-9.
 */
async function dishInContext(
  load: Loader,
  dishId: string,
  items: PlateItemRow[] | null,
): Promise<{ target: ReviewTargetInput; roles: ComponentRole[]; label: string }> {
  const dish = await load.dish(dishId);
  const cuisineKey = await load.cuisineKey(dish.cuisineId);
  const components = await load.components(dishId);
  const eaten: EatenVariant[] = [];
  const roles: ComponentRole[] = [];
  if (items !== null) {
    const own = new Set(components.map((c) => c.id));
    for (const item of items) {
      // A household adjuster on the plate (PLN-8) is another dish; it is not what was reviewed.
      if (!own.has(item.componentId)) continue;
      eaten.push(await load.eaten(item.variantId));
      if (item.cookedG > 0) roles.push(await load.roleOf(item.componentId));
    }
  } else {
    for (const component of components) {
      eaten.push(await load.eaten(await load.defaultVariantId(component.id)));
      if (component.required) roles.push(component.role);
    }
  }
  return { target: { type: "dish", dishId, cuisineKey, eaten }, roles, label: dish.name };
}

export async function loadLearningInput(
  db: Executor,
  ctx: HouseholdContext,
  review: ReviewRow,
): Promise<ReviewLearningInput | null> {
  // Replies and reviews without an eating member teach nothing (SPEC-Q-4).
  if (review.parentReviewId !== null || review.onBehalfOfMemberId === null) return null;
  const load = new Loader(db, ctx);
  const r = createRepos(db, ctx);
  const member = await r.member.get({ id: review.onBehalfOfMemberId });
  if (member === null) throw new ReviewTargetError(`member ${review.onBehalfOfMemberId} not found`);
  const memberItems = (planMealId: string | null) =>
    planMealId === null ? Promise.resolve(null) : load.plateItems(planMealId, member.id);

  let resolved: { target: ReviewTargetInput | null; roles: ComponentRole[]; label: string };
  switch (review.targetType) {
    case "dish":
      resolved = await dishInContext(load, review.targetId, await memberItems(review.planMealId));
      break;
    case "plan_meal": {
      const meal = await load.planMeal(review.targetId);
      resolved = await dishInContext(load, meal.dishId, await load.plateItems(meal.id, member.id));
      break;
    }
    case "plate": {
      const plate = await load.plate(review.targetId);
      const meal = await load.planMeal(plate.planMealId);
      resolved = await dishInContext(load, meal.dishId, await load.itemsOfPlate(plate.id));
      break;
    }
    case "variant": {
      const variant = await load.variant(review.targetId);
      const component = await load.component(variant.componentId);
      const dish = await load.dish(component.dishId);
      const { methodKey } = await load.eaten(variant.id);
      resolved = {
        target: { type: "variant", dishId: dish.id, variantId: variant.id, methodKey },
        roles: [component.role],
        label: `${dish.name} — ${variant.label}`,
      };
      break;
    }
    case "component": {
      const component = await load.component(review.targetId);
      const dish = await load.dish(component.dishId);
      const items = await memberItems(review.planMealId);
      const variantId =
        items?.find((i) => i.componentId === component.id)?.variantId ??
        (await load.defaultVariantId(component.id));
      const { coreIngredientIds } = await load.eaten(variantId);
      resolved = {
        target: { type: "component", dishId: dish.id, variantId, coreIngredientIds },
        roles: [component.role],
        label: `${dish.name} — ${component.name}`,
      };
      break;
    }
    case "ingredient": {
      const ingredient = await r.ingredient.get({ id: review.targetId });
      if (ingredient === null)
        throw new ReviewTargetError(`ingredient ${review.targetId} not found`);
      resolved = {
        target: { type: "ingredient", ingredientId: ingredient.id },
        roles: [],
        label: ingredient.name,
      };
      break;
    }
    case "cuisine":
      resolved = {
        target: { type: "cuisine", cuisineKey: review.targetId },
        roles: [],
        label: review.targetId,
      };
      break;
    case "method":
      resolved = {
        target: { type: "method", methodKey: review.targetId },
        roles: [],
        label: review.targetId,
      };
      break;
    case "plan_day": {
      const day = await load.planDay(review.targetId);
      const roles: ComponentRole[] = [];
      for (const meal of await load.planMeals(day.id))
        for (const item of (await load.plateItems(meal.id, member.id)) ?? [])
          if (item.cookedG > 0) roles.push(await load.roleOf(item.componentId));
      resolved = { target: null, roles, label: `the day ${day.date}` };
      break;
    }
  }
  return {
    memberId: member.id,
    isTargeted: member.isTargeted,
    memberName: member.displayName,
    target: resolved.target,
    roles: [...new Set(resolved.roles)],
    targetLabel: resolved.label,
  };
}
