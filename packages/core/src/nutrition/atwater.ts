// NUT-4 energy consistency check (ADR-2 §7), and the variant-level check with source-specific
// energy factors (BLD-8 R-22, R-30; leaf-1.2.4 ADR-2).
import { computeBatch } from "./batch.js";
import { lookupIngredient, lookupYield } from "./catalog.js";
import { applyKnownBounds } from "./nutrients.js";
import type { CatalogContext, Nutrients, VariantInput } from "./types.js";

/** Largest accepted |kcal − Atwater kcal| as a percentage of kcal. */
export const ATWATER_TOLERANCE_PCT = 12;

export function atwaterCheck(n: Nutrients): { ok: boolean; deltaPct: number } {
  const predicted = 4 * n.protein + 4 * n.carbs + 9 * n.fat + 2 * n.fibre;
  return compare(n.kcal, predicted);
}

/**
 * Food-specific energy factors published by the ingredient's source (kcal per gram), as recorded in
 * the catalogue's `meta.atwater_factors` (R-22). The carbohydrate factor applies to total
 * carbohydrate, `carbs + fibre` (R-20: `carbs` is available carbohydrate), with no fibre term.
 */
export type AtwaterFactors = { protein: number; fat: number; carbohydrate: number };

function compare(kcal: number, predicted: number): { ok: boolean; deltaPct: number } {
  if (kcal === 0) {
    return predicted === 0 ? { ok: true, deltaPct: 0 } : { ok: false, deltaPct: Infinity };
  }
  const deltaPct = (Math.abs(kcal - predicted) / kcal) * 100;
  return { ok: deltaPct <= ATWATER_TOLERANCE_PCT, deltaPct };
}

/** Predicted energy of an amount of food: its own factors where recorded, else 4/4/9/2. */
function predictedEnergy(n: Nutrients, factors: AtwaterFactors | undefined): number {
  if (factors === undefined) return 4 * n.protein + 4 * n.carbs + 9 * n.fat + 2 * n.fibre;
  return (
    factors.protein * n.protein + factors.carbohydrate * (n.carbs + n.fibre) + factors.fat * n.fat
  );
}

/**
 * R-30: compares a variant's batch energy, as the engine computes it, with the sum of the predicted
 * energy of what each ingredient contributes to the batch (NUT-3 attribution: own fat scaled by the
 * method's fat retention, absorbed cooking liquids unchanged, absorbed cooking fat by its share of
 * the absorbed grams). Each ingredient uses its entry in `factors` (by ingredient id) where there
 * is one and 4/4/9/2 otherwise. Passes within ATWATER_TOLERANCE_PCT.
 */
export function variantAtwaterCheck(
  v: VariantInput,
  ctx: CatalogContext,
  factors: ReadonlyMap<string, AtwaterFactors>,
): { ok: boolean; deltaPct: number; kcal: number; predictedKcal: number } {
  const kcal = computeBatch(v, ctx).nutrients.kcal;

  let predictedKcal = 0;
  let absorptionCapacityG = 0;
  let listedFatG = 0;
  for (const row of v.ingredients) {
    if (row.isAbsorbedOil) {
      listedFatG += row.rawG;
      continue;
    }
    const ingredient = lookupIngredient(ctx, row.ingredientId);
    const n = applyKnownBounds(ingredient.per100gRaw);
    let fatRetention = 1;
    if (row.cookingLiquid !== "absorbed") {
      const y = lookupYield(ctx, v.method, ingredient.category);
      fatRetention = y.fatRetention;
      if (row.cookingLiquid === undefined) {
        absorptionCapacityG += (row.rawG * y.oilAbsorptionGPer100gRaw) / 100;
      }
    }
    const retained = { ...n, fat: n.fat * fatRetention };
    predictedKcal += (predictedEnergy(retained, factors.get(row.ingredientId)) * row.rawG) / 100;
  }

  const absorbedG = Math.min(absorptionCapacityG, listedFatG);
  if (absorbedG > 0) {
    for (const row of v.ingredients) {
      if (!row.isAbsorbedOil) continue;
      const n = applyKnownBounds(lookupIngredient(ctx, row.ingredientId).per100gRaw);
      const grams = (absorbedG * row.rawG) / listedFatG;
      predictedKcal += (predictedEnergy(n, factors.get(row.ingredientId)) * grams) / 100;
    }
  }

  return { ...compare(kcal, predictedKcal), kcal, predictedKcal };
}
