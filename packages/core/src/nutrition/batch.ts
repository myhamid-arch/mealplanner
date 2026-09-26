// NUT-3 steps 1–3 for one reference batch (ADR-2 §1–§4).
import { assertValidRow, lookupIngredient, lookupYield } from "./catalog.js";
import { NutritionError } from "./errors.js";
import { addScaled, applyKnownBounds, zeroNutrients } from "./nutrients.js";
import type { CatalogContext, CatalogIngredient, Nutrients, VariantInput } from "./types.js";

export type Batch = {
  /** N: nutrients of the whole cooked batch. */
  nutrients: Nutrients;
  /** W: cooked grams of the whole batch. */
  cookedG: number;
  /** The catalogue ingredient of each listed row, in order. */
  ingredients: CatalogIngredient[];
};

/** Step 1 nutrient adjustment: the ingredient's own fat is scaled by the retention factor. */
function retainFat(n: Nutrients, fatRetention: number): Nutrients {
  const fatLost = n.fat * (1 - fatRetention);
  return {
    ...n,
    fat: n.fat * fatRetention,
    satFat: n.satFat * fatRetention,
    kcal: n.kcal - 9 * fatLost,
  };
}

export function computeBatch(v: VariantInput, ctx: CatalogContext): Batch {
  const rows = v.ingredients.map((row) => {
    assertValidRow(row);
    const ingredient = lookupIngredient(ctx, row.ingredientId);
    return { row, ingredient, per100g: applyKnownBounds(ingredient.per100gRaw) };
  });

  let nutrients = zeroNutrients();
  let cookedG = 0;
  let absorptionCapacityG = 0;
  let listedFatG = 0;

  // Step 1: every ingredient except the absorbed cooking fat.
  for (const { row, ingredient, per100g } of rows) {
    if (row.isAbsorbedOil) {
      listedFatG += row.rawG;
    } else if (row.cookingLiquid === "absorbed") {
      // Its mass is already inside the absorbing ingredient's yield.
      nutrients = addScaled(nutrients, per100g, row.rawG / 100);
    } else {
      const y = lookupYield(ctx, v.method, ingredient.category);
      nutrients = addScaled(nutrients, retainFat(per100g, y.fatRetention), row.rawG / 100);
      cookedG += row.rawG * (row.yieldOverride ?? y.yieldFactor);
      if (row.cookingLiquid === undefined) {
        absorptionCapacityG += (row.rawG * y.oilAbsorptionGPer100gRaw) / 100;
      }
    }
  }

  // Step 2: absorbed cooking fat, capped by the fat listed; the rest is discarded.
  const absorbedG = Math.min(absorptionCapacityG, listedFatG);
  if (absorbedG > 0) {
    for (const { row, per100g } of rows) {
      if (!row.isAbsorbedOil) continue;
      const grams = (absorbedG * row.rawG) / listedFatG;
      nutrients = addScaled(nutrients, per100g, grams / 100);
      cookedG += grams;
    }
  }

  if (!(cookedG > 0)) {
    throw new NutritionError("zero_cooked_mass", "the variant has no cooked mass");
  }
  return { nutrients, cookedG, ingredients: rows.map((r) => r.ingredient) };
}
