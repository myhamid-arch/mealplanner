// REC-5 step 5: nutrition and the NUT-4 energy check with source-specific factors (R-22, R-30).
// The variant-level check is core's `variantAtwaterCheck` (BLD-8 R-32).
import {
  NutritionError,
  atwaterCheck,
  variantAtwaterCheck,
  variantNutritionPer100gCooked,
  type CatalogContext,
  type MethodKey,
  type VariantInput,
} from "@mealplanner/core/nutrition";
import { newIngredientNutrients, type AtwaterFactors } from "../catalogue.js";
import type { GeneratedDish, GeneratedVariant, NewIngredient } from "../schema.js";
import type { Reason, VariantNutrition } from "./types.js";

export { variantAtwaterCheck };

/** NUT-4: largest accepted energy gap, % of kcal (as core's check; core's index does not export it). */
export const ATWATER_TOLERANCE_PCT = 12;

/** The engine input for a generated variant (REC-4 has no cooking-liquid role; SPEC-Q-14). */
export function variantInput(v: GeneratedVariant): VariantInput {
  return {
    method: v.method as MethodKey,
    ingredients: v.ingredients.map((line) => ({
      ingredientId: line.slug,
      rawG: line.rawGramsPerBatch,
      isAbsorbedOil: line.isAbsorbedFat,
    })),
  };
}

/** Step 5: per-variant nutrition, the variant energy check, and new ingredients' own check. */
export function checkNutrition(
  dish: GeneratedDish,
  ctx: CatalogContext,
  factors: ReadonlyMap<string, AtwaterFactors>,
  usedNew: readonly NewIngredient[],
): { reasons: Reason[]; nutrition: VariantNutrition[][] } {
  const reasons: Reason[] = [];
  for (const n of usedNew) {
    const check = atwaterCheck(newIngredientNutrients(n));
    if (!check.ok)
      reasons.push({
        step: 5,
        code: "atwater_new_ingredient",
        message: `new ingredient "${n.slug}": ${String(n.per100g.kcal)} kcal per 100 g differs by ${check.deltaPct.toFixed(1)} % from 4 P + 4 C + 9 F + 2 fibre (limit ${String(ATWATER_TOLERANCE_PCT)} %)`,
      });
  }
  const nutrition: VariantNutrition[][] = [];
  for (const c of dish.components) {
    const row: VariantNutrition[] = [];
    for (const v of c.variants) {
      const where = `component "${c.name}", variant "${v.label}"`;
      try {
        const input = variantInput(v);
        const { per100g, batchCookedG } = variantNutritionPer100gCooked(input, ctx);
        const check = variantAtwaterCheck(input, ctx, factors);
        if (!check.ok)
          reasons.push({
            step: 5,
            code: "atwater_variant",
            message: `${where}: computed ${check.kcal.toFixed(0)} kcal per batch differs by ${check.deltaPct.toFixed(1)} % from the ingredients' predicted ${check.predictedKcal.toFixed(0)} kcal (limit ${String(ATWATER_TOLERANCE_PCT)} %); check the ingredient nutrition`,
          });
        row.push({ per100g, batchCookedG });
      } catch (error) {
        if (!(error instanceof NutritionError)) throw error;
        reasons.push({
          step: 5,
          code: "nutrition_error",
          message: `${where}: ${error.message}`,
        });
      }
    }
    nutrition.push(row);
  }
  return { reasons, nutrition };
}
