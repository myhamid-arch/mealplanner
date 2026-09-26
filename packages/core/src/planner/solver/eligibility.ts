// Exclusions (SPEC-Q-13) and adjuster eligibility (PLN-6).
import { MIN_ADJUSTER_APPEAL } from "./config.js";
import type { ComponentForSolve, DishForSolve, MemberCtx, VariantForSolve } from "./types.js";

/** True when no ingredient of the variant hits the member's ingredient, category or flag exclusions. */
export function variantAllowed(variant: VariantForSolve, member: MemberCtx): boolean {
  const { ingredientIds, categories, dietaryFlags } = member.exclusions;
  return variant.ingredients.every(
    (i) =>
      !ingredientIds.includes(i.id) &&
      !categories.includes(i.category) &&
      !i.dietaryFlags.some((flag) => dietaryFlags.includes(flag)),
  );
}

/** One way to add an adjuster: an adjuster dish's single component in one of its variants. */
export type AdjusterOption = {
  dishId: string;
  component: ComponentForSolve;
  variant: VariantForSolve;
};

export type AdjusterRejection = {
  dishId: string;
  reason: "not_single_component" | "excluded" | "low_appeal" | "not_packable" | "not_cold";
};

/**
 * PLN-6: an adjuster must pass the member's exclusions, have appeal ≥ −0.2 for the member, and
 * suit the slot (packed → `is_packable`; packed without reheat → `served_cold_ok`).
 */
export function adjusterOptions(
  adjusters: readonly DishForSolve[],
  member: MemberCtx,
): { options: AdjusterOption[]; rejected: AdjusterRejection[] } {
  const options: AdjusterOption[] = [];
  const rejected: AdjusterRejection[] = [];
  for (const dish of adjusters) {
    const [component, ...rest] = dish.components;
    if (component === undefined || rest.length > 0) {
      rejected.push({ dishId: dish.id, reason: "not_single_component" });
      continue;
    }
    if ((member.dishAppeal[dish.id] ?? 0) < MIN_ADJUSTER_APPEAL) {
      rejected.push({ dishId: dish.id, reason: "low_appeal" });
      continue;
    }
    if (member.slot.isPacked && !dish.isPackable) {
      rejected.push({ dishId: dish.id, reason: "not_packable" });
      continue;
    }
    if (member.slot.isPacked && !member.slot.reheatAvailable && !dish.servedColdOk) {
      rejected.push({ dishId: dish.id, reason: "not_cold" });
      continue;
    }
    const allowed = component.variants.filter((v) => variantAllowed(v, member));
    if (allowed.length === 0) {
      rejected.push({ dishId: dish.id, reason: "excluded" });
      continue;
    }
    for (const variant of allowed) options.push({ dishId: dish.id, component, variant });
  }
  return { options, rejected };
}
