// The `replaced()` of `packages/db/src/services/plans/substitute.ts` as merged at f50c084 (before
// W-6), kept verbatim as leaf 1.4.8 G2's negative control: the W-6 assertions must fail on it.
// Test-only; never imported by production code.
import { variantNutritionPer100gCooked } from "@mealplanner/core/nutrition";
import type { PlanDish } from "@mealplanner/core/planner";
import type { MealState } from "../../src/services/plans/meal.js";
import { newId } from "../../src/schema/ids.js";
import { PlanServiceError } from "../../src/services/plans/errors.js";

export function preFixReplaced(
  dish: PlanDish,
  from: string,
  to: string,
  catalogue: MealState["pool"]["catalog"],
): PlanDish {
  const sub = catalogue.ingredients.get(to);
  if (sub === undefined)
    throw new PlanServiceError("invalid", `ingredient ${to} is not in the catalogue`);
  return {
    ...dish,
    id: newId(),
    name: `${dish.name} (with ${sub.name})`,
    status: "active",
    components: dish.components.map((c) => ({
      ...c,
      id: newId(),
      variants: c.variants.map((v) => {
        const input = {
          ...v.input,
          ingredients: v.input.ingredients.map((l) =>
            l.ingredientId === from ? { ...l, ingredientId: to } : l,
          ),
        };
        const ids = [...new Set(input.ingredients.map((l) => l.ingredientId))];
        return {
          ...v,
          id: newId(),
          input,
          per100g: variantNutritionPer100gCooked(input, catalogue.context).per100g,
          ingredients: ids.map((id) => {
            const row = catalogue.ingredients.get(id);
            if (row === undefined)
              throw new PlanServiceError("invalid", `ingredient ${id} missing`);
            return { id, slug: row.slug, category: row.category, dietaryFlags: row.dietaryFlags };
          }),
        };
      }),
    })),
  };
}
