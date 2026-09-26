// Comparators shared by the Vitest suite and scripts/verify/leaf-1.2.1.mjs (through dist/).
// They take the engine functions as arguments so the same assertion can run against a
// known-bad implementation or catalogue (negative controls).
import type {
  CatalogContext,
  Nutrients,
  VariantInput,
  plateNutrients,
  rawForCooked,
  variantNutritionPer100gCooked,
} from "../../src/nutrition/index.js";
import type { GoldenCase } from "./fixtures/golden.js";

export type NutritionApi = {
  variantNutritionPer100gCooked: typeof variantNutritionPer100gCooked;
  rawForCooked: typeof rawForCooked;
  plateNutrients: typeof plateNutrients;
};

export const NUTRIENT_KEYS = [
  "kcal",
  "protein",
  "carbs",
  "fat",
  "satFat",
  "fibre",
  "solubleFibre",
  "sugar",
  "sodiumMg",
] as const;

/** Largest relative difference accepted for a golden value (G1: 0.5 %). */
export const GOLDEN_TOLERANCE = 0.005;
/** Largest relative difference accepted for a round trip (G2: 0.1 %). */
export const ROUND_TRIP_TOLERANCE = 0.001;
/** An expected zero must come out as zero up to float noise. */
const ZERO_EPSILON = 1e-9;

/** `null` when `actual` is within `tolerance` of `expected`, else a description. */
export function numberMismatch(
  actual: number | null,
  expected: number | null,
  tolerance: number,
): string | null {
  if (expected === null || actual === null) {
    return expected === actual ? null : `expected ${String(expected)}, got ${String(actual)}`;
  }
  if (!Number.isFinite(actual)) return `expected ${String(expected)}, got ${String(actual)}`;
  if (expected === 0) {
    return Math.abs(actual) <= ZERO_EPSILON ? null : `expected 0, got ${String(actual)}`;
  }
  const relative = Math.abs(actual - expected) / Math.abs(expected);
  return relative <= tolerance
    ? null
    : `expected ${String(expected)}, got ${String(actual)} (${(relative * 100).toFixed(3)} %)`;
}

export function nutrientMismatches(
  actual: Nutrients,
  expected: Nutrients,
  tolerance: number,
  label: string,
): string[] {
  const problems: string[] = [];
  for (const key of NUTRIENT_KEYS) {
    const problem = numberMismatch(actual[key], expected[key], tolerance);
    if (problem !== null) problems.push(`${label}.${key}: ${problem}`);
  }
  return problems;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every golden field that differs from its hand-computed value by more than `tolerance`. */
export function goldenMismatches(
  cases: readonly GoldenCase[],
  compute: typeof variantNutritionPer100gCooked,
  ctx: CatalogContext,
  tolerance = GOLDEN_TOLERANCE,
): string[] {
  const problems: string[] = [];
  for (const golden of cases) {
    try {
      const result = compute(golden.variant, ctx);
      problems.push(
        ...nutrientMismatches(
          result.per100g,
          golden.expected.per100g,
          tolerance,
          `${golden.id}.per100g`,
        ),
      );
      const cooked = numberMismatch(result.batchCookedG, golden.expected.batchCookedG, tolerance);
      if (cooked !== null) problems.push(`${golden.id}.batchCookedG: ${cooked}`);
    } catch (error) {
      problems.push(`${golden.id}: threw ${errorText(error)}`);
    }
  }
  return problems;
}

/** Plate shares of the batch used for the partition round trip. */
const PARTITION = [0.2, 0.3, 0.5] as const;
/** Plate share used for the rebuilt-variant round trip. */
const PLATE_SHARE = 0.35;

function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const scale = (value: number | null): number | null => (value === null ? null : value * factor);
  return {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    satFat: n.satFat * factor,
    fibre: n.fibre * factor,
    solubleFibre: scale(n.solubleFibre),
    sugar: scale(n.sugar),
    sodiumMg: scale(n.sodiumMg),
  };
}

/**
 * G2 round trip for one variant, all within `tolerance`:
 * (a) raw grams for plates partitioning the batch sum to the listed raw grams;
 * (b) a variant rebuilt from rawForCooked(x) cooks to x grams with the same per-100 g values;
 * (c) plateNutrients of x grams equals the batch totals scaled by x / W;
 * and `discardedFat` is set exactly on the absorbed-fat rows.
 */
export function roundTripMismatches(
  label: string,
  v: VariantInput,
  api: NutritionApi,
  ctx: CatalogContext,
  tolerance = ROUND_TRIP_TOLERANCE,
): string[] {
  const problems: string[] = [];
  try {
    const base = api.variantNutritionPer100gCooked(v, ctx);
    const batchG = base.batchCookedG;
    const batchTotals = api.plateNutrients([{ per100g: base.per100g, cookedG: batchG }]);

    // (a) partition
    const sums = v.ingredients.map(() => 0);
    for (const share of PARTITION) {
      api.rawForCooked(v, batchG * share, ctx).forEach((line, i) => {
        sums[i] = (sums[i] ?? 0) + line.rawG;
      });
    }
    v.ingredients.forEach((row, i) => {
      const problem = numberMismatch(sums[i] ?? 0, row.rawG, tolerance);
      if (problem !== null) problems.push(`${label}.partition[${row.ingredientId}]: ${problem}`);
    });

    // (b) rebuilt variant
    const plateG = batchG * PLATE_SHARE;
    const lines = api.rawForCooked(v, plateG, ctx);
    lines.forEach((line, i) => {
      const row = v.ingredients[i];
      if (row?.ingredientId !== line.ingredientId) {
        problems.push(`${label}.order[${String(i)}]: ${line.ingredientId} is not the listed row`);
      } else if ((line.discardedFat === true) !== row.isAbsorbedOil) {
        problems.push(`${label}.discardedFat[${row.ingredientId}]: ${String(line.discardedFat)}`);
      }
    });
    const rebuilt: VariantInput = {
      method: v.method,
      ingredients: v.ingredients.map((row, i) => ({ ...row, rawG: lines[i]?.rawG ?? NaN })),
    };
    const again = api.variantNutritionPer100gCooked(rebuilt, ctx);
    const cooked = numberMismatch(again.batchCookedG, plateG, tolerance);
    if (cooked !== null) problems.push(`${label}.rebuiltCookedG: ${cooked}`);
    problems.push(
      ...nutrientMismatches(again.per100g, base.per100g, tolerance, `${label}.rebuiltPer100g`),
    );

    // (c) plate nutrients
    const plate = api.plateNutrients([{ per100g: base.per100g, cookedG: plateG }]);
    problems.push(
      ...nutrientMismatches(
        plate,
        scaleNutrients(batchTotals, PLATE_SHARE),
        tolerance,
        `${label}.plate`,
      ),
    );
  } catch (error) {
    problems.push(`${label}: threw ${errorText(error)}`);
  }
  return problems;
}

/** G3 direction: deep-fried fat per 100 g cooked is strictly greater than grilled. */
export function friedHasMoreFat(grilled: Nutrients, fried: Nutrients): boolean {
  return fried.fat > grilled.fat;
}
