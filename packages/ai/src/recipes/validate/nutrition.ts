// REC-5 step 5: nutrition and the NUT-4 energy check with source-specific factors (R-22, R-30).
//
// `variantAtwaterCheck` follows the definition R-30 gives leaf 1.2.4 (and the signature of its
// ADR-2), so the architect can replace it with the core export once both leaves merge
// (BLD-8 R-32, SPEC-Q-5).
import {
  NutritionError,
  atwaterCheck,
  variantNutritionPer100gCooked,
  type CatalogContext,
  type MethodKey,
  type Nutrients,
  type VariantInput,
} from "@mealplanner/core/nutrition";
import { newIngredientNutrients, type AtwaterFactors } from "../catalogue.js";
import type { GeneratedDish, GeneratedVariant, NewIngredient } from "../schema.js";
import type { Reason, VariantNutrition } from "./types.js";

/** NUT-4: largest accepted energy gap, % of kcal (as `atwaterCheck`, which does not export it). */
export const ATWATER_TOLERANCE_PCT = 12;

type Energy = { protein: number; carbs: number; fat: number; fibre: number };

function predictedKcal(e: Energy, factors: AtwaterFactors | undefined): number {
  if (factors === undefined) return 4 * e.protein + 4 * e.carbs + 9 * e.fat + 2 * e.fibre;
  return (
    factors.protein * e.protein + factors.carbohydrate * (e.carbs + e.fibre) + factors.fat * e.fat
  );
}

function scaled(n: Nutrients, factor: number, fatRetention = 1): Energy {
  return {
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * fatRetention * factor,
    fibre: n.fibre * factor,
  };
}

/**
 * The variant's batch energy against the sum of its ingredients' predicted energy, each with its
 * own factors where recorded and 4/4/9/2 otherwise, attributed as NUT-3 attributes them.
 */
export function variantAtwaterCheck(
  v: VariantInput,
  ctx: CatalogContext,
  factors: ReadonlyMap<string, AtwaterFactors>,
): { ok: boolean; deltaPct: number; kcal: number; predictedKcal: number } {
  const { per100g, batchCookedG } = variantNutritionPer100gCooked(v, ctx);
  const kcal = (per100g.kcal * batchCookedG) / 100;

  let predicted = 0;
  let capacity = 0;
  let listedFat = 0;
  for (const row of v.ingredients) {
    const ingredient = ctx.ingredients.get(row.ingredientId);
    if (ingredient === undefined) throw new NutritionError("unknown_ingredient", row.ingredientId);
    if (row.isAbsorbedOil) {
      listedFat += row.rawG;
      continue;
    }
    const own = factors.get(row.ingredientId);
    if (row.cookingLiquid === "absorbed") {
      predicted += predictedKcal(scaled(ingredient.per100gRaw, row.rawG / 100), own);
      continue;
    }
    const y = ctx.methodYields.find(
      (m) => m.method === v.method && m.category === ingredient.category,
    );
    if (y === undefined)
      throw new NutritionError("missing_method_yield", `${v.method} × ${ingredient.category}`);
    predicted += predictedKcal(scaled(ingredient.per100gRaw, row.rawG / 100, y.fatRetention), own);
    if (row.cookingLiquid === undefined) capacity += (row.rawG * y.oilAbsorptionGPer100gRaw) / 100;
  }
  const absorbed = Math.min(capacity, listedFat);
  if (absorbed > 0) {
    for (const row of v.ingredients) {
      if (!row.isAbsorbedOil) continue;
      const ingredient = ctx.ingredients.get(row.ingredientId);
      if (ingredient === undefined) continue;
      const grams = (absorbed * row.rawG) / listedFat;
      predicted += predictedKcal(
        scaled(ingredient.per100gRaw, grams / 100),
        factors.get(row.ingredientId),
      );
    }
  }

  if (kcal === 0)
    return predicted === 0
      ? { ok: true, deltaPct: 0, kcal, predictedKcal: predicted }
      : { ok: false, deltaPct: Infinity, kcal, predictedKcal: predicted };
  const deltaPct = (Math.abs(kcal - predicted) / kcal) * 100;
  return { ok: deltaPct <= ATWATER_TOLERANCE_PCT, deltaPct, kcal, predictedKcal: predicted };
}

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
