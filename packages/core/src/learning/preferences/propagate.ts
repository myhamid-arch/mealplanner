// FBK-4 propagation: which preference keys a review on target X updates, and with what weight.
import type { IngredientCategory, PreferenceEntityType } from "../../types/index.js";
import { NON_CORE_CATEGORIES, NON_CORE_SLUGS, PROPAGATION, SCORE_DECIMALS } from "./config.js";
import { variantKey } from "./keys.js";

/** A variant the member ate, from the review's plate context or the dish's default variants. */
export interface EatenVariant {
  variantId: string;
  methodKey: string;
  /** Core ingredient ids of this variant (see `coreIngredients`). */
  coreIngredientIds: readonly string[];
}

/** A reviewed target, resolved to the facts propagation needs (loaded by the reviews service). */
export type ReviewTargetInput =
  | { type: "dish"; dishId: string; cuisineKey: string; eaten: readonly EatenVariant[] }
  | { type: "variant"; dishId: string; variantId: string; methodKey: string }
  | {
      type: "component";
      dishId: string;
      /** The component's eaten variant (plate context), else its default variant. */
      variantId: string;
      coreIngredientIds: readonly string[];
    }
  | { type: "ingredient"; ingredientId: string }
  | { type: "cuisine"; cuisineKey: string }
  | { type: "method"; methodKey: string };

/** One weighted signal on one preference key. */
export interface Contribution {
  entityType: PreferenceEntityType;
  entityKey: string;
  weight: number;
  signal: number;
}

export interface CoreIngredientCandidate {
  ingredientId: string;
  slug: string;
  category: IngredientCategory;
}

/** Core ingredients: every distinct ingredient except `herb_spice` and water (PLN-9, SPEC-Q-6). */
export function coreIngredients(items: readonly CoreIngredientCandidate[]): string[] {
  const ids = new Set<string>();
  for (const item of items)
    if (!NON_CORE_CATEGORIES.includes(item.category) && !NON_CORE_SLUGS.includes(item.slug))
      ids.add(item.ingredientId);
  return [...ids];
}

function round(value: number): number {
  const factor = 10 ** SCORE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * The FBK-4 contributions of one review with appeal signal `signal` (see `reviewSignal`). A key is
 * reached at most once per review; its weight is rounded to the stored precision (ADR-1).
 */
export function propagateReview(target: ReviewTargetInput, signal: number): Contribution[] {
  if (!Number.isFinite(signal) || signal < -1 || signal > 1)
    throw new RangeError(`signal must be within [−1, 1], got ${String(signal)}`);
  const weights = new Map<
    string,
    { entityType: PreferenceEntityType; entityKey: string; weight: number }
  >();
  const add = (entityType: PreferenceEntityType, entityKey: string, weight: number) => {
    const id = `${entityType}\u0000${entityKey}`;
    if (!weights.has(id)) weights.set(id, { entityType, entityKey, weight });
  };
  const ingredients = (ids: readonly string[], base: number) => {
    const distinct = [...new Set(ids)];
    const each = base / Math.sqrt(distinct.length);
    for (const id of distinct) add("ingredient", id, each);
  };

  switch (target.type) {
    case "dish": {
      const w = PROPAGATION.dish;
      add("dish", target.dishId, w.dish);
      add("cuisine", target.cuisineKey, w.cuisine);
      for (const v of target.eaten) add("method", v.methodKey, w.method);
      ingredients(
        target.eaten.flatMap((v) => v.coreIngredientIds),
        w.ingredient,
      );
      break;
    }
    case "variant": {
      const w = PROPAGATION.variant;
      add("dish", variantKey(target.dishId, target.variantId), w.variant);
      add("method", target.methodKey, w.method);
      add("dish", target.dishId, w.dish);
      break;
    }
    case "component": {
      const w = PROPAGATION.component;
      add("dish", variantKey(target.dishId, target.variantId), w.variant);
      ingredients(target.coreIngredientIds, w.ingredient);
      break;
    }
    case "ingredient":
      add("ingredient", target.ingredientId, PROPAGATION.direct);
      break;
    case "cuisine":
      add("cuisine", target.cuisineKey, PROPAGATION.direct);
      break;
    case "method":
      add("method", target.methodKey, PROPAGATION.direct);
      break;
  }
  return [...weights.values()]
    .map((c) => ({ ...c, weight: round(c.weight), signal }))
    .filter((c) => c.weight > 0);
}
