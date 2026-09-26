// Nutrients per 100 g cooked for one variant (NUT-3 step 3, NUT-4 warnings).
import { atwaterCheck } from "./atwater.js";
import { computeBatch } from "./batch.js";
import { addScaled, zeroNutrients } from "./nutrients.js";
import type { CatalogContext, Nutrients, NutritionWarning, VariantInput } from "./types.js";

export function variantNutritionPer100gCooked(
  v: VariantInput,
  ctx: CatalogContext,
): { per100g: Nutrients; batchCookedG: number; warnings: NutritionWarning[] } {
  const batch = computeBatch(v, ctx);
  const per100g = addScaled(zeroNutrients(), batch.nutrients, 100 / batch.cookedG);

  const warnings: NutritionWarning[] = [];
  const checked = new Set<string>();
  for (const ingredient of batch.ingredients) {
    if (checked.has(ingredient.id)) continue;
    checked.add(ingredient.id);
    const check = atwaterCheck(ingredient.per100gRaw);
    if (!check.ok) {
      warnings.push({
        code: "atwater_ingredient",
        ingredientId: ingredient.id,
        deltaPct: check.deltaPct,
      });
    }
  }
  const check = atwaterCheck(per100g);
  if (!check.ok) warnings.push({ code: "atwater_variant", deltaPct: check.deltaPct });

  return { per100g, batchCookedG: batch.cookedG, warnings };
}
