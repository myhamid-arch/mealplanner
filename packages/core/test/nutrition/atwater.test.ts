import { describe, expect, it } from "vitest";
import {
  type AtwaterFactors,
  atwaterCheck,
  type CatalogContext,
  NutritionError,
  type Nutrients,
  type VariantInput,
  variantAtwaterCheck,
  variantNutritionPer100gCooked,
} from "../../src/nutrition/index.js";
import { FIXTURE_METHOD_YIELDS, fixtureCatalog } from "./fixtures/catalog.js";

const ctx = fixtureCatalog();

function nutrients(
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fibre = 0,
): Nutrients {
  return {
    kcal,
    protein,
    carbs,
    fat,
    satFat: 0,
    fibre,
    solubleFibre: null,
    sugar: null,
    sodiumMg: null,
  };
}

describe("atwaterCheck (NUT-4)", () => {
  it("accepts an exact match", () => {
    // 4 * 10 + 4 * 20 + 9 * 5 + 2 * 5 = 175
    expect(atwaterCheck(nutrients(175, 10, 20, 5, 5))).toEqual({ ok: true, deltaPct: 0 });
  });

  it("accepts exactly 12 % and rejects just above it", () => {
    // predicted 4 * 22 = 88 = 100 - 12 %
    expect(atwaterCheck(nutrients(100, 22, 0, 0))).toEqual({ ok: true, deltaPct: 12 });
    const above = atwaterCheck(nutrients(100, 21.9, 0, 0));
    expect(above.ok).toBe(false);
    expect(above.deltaPct).toBeCloseTo(12.4, 10);
  });

  it("measures the difference relative to the stated kcal", () => {
    // predicted 9 * 10 = 90 against 80: |80 - 90| / 80 = 12.5 %
    expect(atwaterCheck(nutrients(80, 0, 0, 10))).toEqual({ ok: false, deltaPct: 12.5 });
  });

  it("treats all-zero energy as consistent and zero kcal with macros as inconsistent", () => {
    expect(atwaterCheck(nutrients(0, 0, 0, 0))).toEqual({ ok: true, deltaPct: 0 });
    expect(atwaterCheck(nutrients(0, 1, 0, 0))).toEqual({ ok: false, deltaPct: Infinity });
  });
});

describe("NUT-4 warnings from variantNutritionPer100gCooked", () => {
  it("warns once per failing ingredient and for a failing variant", () => {
    const result = variantNutritionPer100gCooked(
      {
        method: "raw",
        ingredients: [
          { ingredientId: "lemon_juice", rawG: 50, isAbsorbedOil: false },
          { ingredientId: "cucumber", rawG: 100, isAbsorbedOil: false },
          { ingredientId: "lemon_juice", rawG: 50, isAbsorbedOil: false },
        ],
      },
      ctx,
    );
    // lemon_juice: 4 * 0.4 + 4 * 6.9 + 9 * 0.2 + 2 * 0.3 = 31.6 against 22 → 43.64 %
    // variant per 100 g: kcal (22 + 15) / 200 * 100 = 18.5; predicted
    //   4 * 0.55 + 4 * 4.95 + 9 * 0.15 + 2 * 0.4 = 24.15 → 30.54 %
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatchObject({
      code: "atwater_ingredient",
      ingredientId: "lemon_juice",
    });
    expect(result.warnings[0]?.deltaPct).toBeCloseTo(43.636, 2);
    expect(result.warnings[1]).toMatchObject({ code: "atwater_variant" });
    expect(result.warnings[1]?.deltaPct).toBeCloseTo(30.54, 1);
  });

  it("returns no warnings for consistent data", () => {
    const result = variantNutritionPer100gCooked(
      {
        method: "grilled",
        ingredients: [{ ingredientId: "chicken_breast", rawG: 1000, isAbsorbedOil: false }],
      },
      ctx,
    );
    expect(result.warnings).toEqual([]);
  });
});

describe("variantAtwaterCheck (R-22, R-30)", () => {
  const none = new Map<string, AtwaterFactors>();

  const variants: Record<string, VariantInput> = {
    grilled: {
      method: "grilled",
      ingredients: [
        { ingredientId: "chicken_breast", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "black_pepper", rawG: 3, isAbsorbedOil: false },
      ],
    },
    deepFried: {
      method: "deep_fried",
      ingredients: [
        { ingredientId: "white_fish", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 200, isAbsorbedOil: true },
      ],
    },
    breadedFried: {
      method: "breaded_fried",
      ingredients: [
        { ingredientId: "chicken_breast", rawG: 800, isAbsorbedOil: false },
        { ingredientId: "egg", rawG: 100, isAbsorbedOil: false },
        { ingredientId: "breadcrumbs", rawG: 120, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 60, isAbsorbedOil: true },
        { ingredientId: "sunflower_oil", rawG: 40, isAbsorbedOil: true },
      ],
    },
    stew: {
      method: "stewed",
      ingredients: [
        { ingredientId: "red_lentils", rawG: 300, isAbsorbedOil: false },
        {
          ingredientId: "chicken_stock",
          rawG: 900,
          isAbsorbedOil: false,
          cookingLiquid: "retained",
        },
        { ingredientId: "onion", rawG: 150, isAbsorbedOil: false, yieldOverride: 0.8 },
        { ingredientId: "olive_oil", rawG: 20, isAbsorbedOil: false },
      ],
    },
    rice: {
      method: "boiled",
      ingredients: [
        { ingredientId: "basmati_rice", rawG: 500, isAbsorbedOil: false },
        {
          ingredientId: "chicken_stock",
          rawG: 900,
          isAbsorbedOil: false,
          cookingLiquid: "absorbed",
        },
      ],
    },
  };

  const deepFried = variants.deepFried as VariantInput;
  const rice = variants.rice as VariantInput;

  it("without factors equals the generic check on the engine's per-100 g nutrients", () => {
    for (const [name, v] of Object.entries(variants)) {
      const { per100g, batchCookedG } = variantNutritionPer100gCooked(v, ctx);
      const generic = atwaterCheck(per100g);
      const result = variantAtwaterCheck(v, ctx, none);
      expect(result.kcal, name).toBeCloseTo((per100g.kcal * batchCookedG) / 100, 9);
      expect(result.deltaPct, name).toBeCloseTo(generic.deltaPct, 9);
      expect(result.ok, name).toBe(generic.ok);
    }
  });

  it("uses an ingredient's own factors, carbohydrate factor on carbs + fibre, no fibre term", () => {
    // Grilled chicken breast 1000 g: fat 26 g × retention 0.85 = 22.1 g, fat lost 3.9 g.
    // Engine kcal: 1200 − 9 × 3.9 = 1164.9.
    // Predicted with factors: 4.27 × 225 + 3.87 × 0 + 9.02 × 22.1 = 960.75 + 199.342 = 1160.092.
    const factors = new Map([["chicken_breast", { protein: 4.27, fat: 9.02, carbohydrate: 3.87 }]]);
    const v: VariantInput = {
      method: "grilled",
      ingredients: [{ ingredientId: "chicken_breast", rawG: 1000, isAbsorbedOil: false }],
    };
    const result = variantAtwaterCheck(v, ctx, factors);
    expect(result.kcal).toBeCloseTo(1164.9, 9);
    expect(result.predictedKcal).toBeCloseTo(1160.092, 9);
    expect(result.deltaPct).toBeCloseTo((4.808 / 1164.9) * 100, 9);
    expect(result.ok).toBe(true);
    // Generic: 4 × 225 + 9 × 22.1 = 1098.9.
    expect(variantAtwaterCheck(v, ctx, none).predictedKcal).toBeCloseTo(1098.9, 9);
  });

  it("passes a variant the generic check fails when the ingredient's source factors explain it", () => {
    // Mushrooms (USDA-like): 22 kcal, P 3.1, available C 2.0, F 0.3, fibre 1.0 per 100 g.
    // Generic: 12.4 + 8 + 2.7 + 2 = 25.1 → 14.09 % (fails).
    // Factors 2.62 / 3.48 / 8.37: 8.122 + 3.48 × 3.0 + 2.511 = 21.073 → 4.21 % (passes).
    const mushrooms: CatalogContext = {
      ingredients: new Map([
        [
          "mushrooms",
          {
            id: "mushrooms",
            category: "vegetable",
            per100gRaw: nutrients(22, 3.1, 2.0, 0.3, 1.0),
          },
        ],
      ]),
      methodYields: FIXTURE_METHOD_YIELDS,
    };
    const v: VariantInput = {
      method: "raw",
      ingredients: [{ ingredientId: "mushrooms", rawG: 500, isAbsorbedOil: false }],
    };
    const generic = variantAtwaterCheck(v, mushrooms, none);
    expect(generic.ok).toBe(false);
    expect(generic.deltaPct).toBeCloseTo((3.1 / 22) * 100, 9);
    const specific = variantAtwaterCheck(
      v,
      mushrooms,
      new Map([["mushrooms", { protein: 2.62, fat: 8.37, carbohydrate: 3.48 }]]),
    );
    expect(specific.ok).toBe(true);
    expect(specific.kcal).toBeCloseTo(110, 9);
    expect(specific.predictedKcal).toBeCloseTo(105.365, 9);
    expect(specific.deltaPct).toBeCloseTo((4.635 / 110) * 100, 9);
  });

  it("counts only the absorbed share of a frying fat, with that fat's own factors", () => {
    // Absorbed: min(1000 × 6 / 100, 200) = 60 g. Fish predicted: 4 × 190 + 9 × 12 = 868.
    // Oil generic 60 × 9 = 540 → 1408; oil factor 8.84 → 530.4 → 1398.4.
    // Engine kcal: 900 + 60 × 8.84 = 1430.4.
    const generic = variantAtwaterCheck(deepFried, ctx, none);
    expect(generic.kcal).toBeCloseTo(1430.4, 9);
    expect(generic.predictedKcal).toBeCloseTo(1408, 9);
    const specific = variantAtwaterCheck(
      deepFried,
      ctx,
      new Map([["sunflower_oil", { protein: 0, fat: 8.84, carbohydrate: 0 }]]),
    );
    expect(specific.predictedKcal).toBeCloseTo(1398.4, 9);
    expect(specific.ok).toBe(true);
  });

  it("keeps all the fat of an absorbed cooking liquid and needs no yield row for it", () => {
    // Rice 500 g: 4 × 37.5 + 4 × 395 + 9 × 4.5 + 2 × 6.5 = 1783.5.
    // Stock 900 g (absorbed, fat unchanged): 9 × (4 × 2.5 + 4 × 0.9 + 9 × 0.5) = 162.9.
    const result = variantAtwaterCheck(rice, ctx, none);
    expect(result.predictedKcal).toBeCloseTo(1946.4, 9);
    expect(result.kcal).toBeCloseTo(1800 + 153, 9);
  });

  it("follows the zero-kcal rule of atwaterCheck", () => {
    const water: VariantInput = {
      method: "stewed",
      ingredients: [
        { ingredientId: "water", rawG: 500, isAbsorbedOil: false, cookingLiquid: "retained" },
      ],
    };
    expect(variantAtwaterCheck(water, ctx, none)).toEqual({
      ok: true,
      deltaPct: 0,
      kcal: 0,
      predictedKcal: 0,
    });
    const odd: CatalogContext = {
      ingredients: new Map([
        ["odd", { id: "odd", category: "vegetable", per100gRaw: nutrients(0, 1, 0, 0) }],
      ]),
      methodYields: FIXTURE_METHOD_YIELDS,
    };
    const result = variantAtwaterCheck(
      { method: "raw", ingredients: [{ ingredientId: "odd", rawG: 100, isAbsorbedOil: false }] },
      odd,
      none,
    );
    expect(result.ok).toBe(false);
    expect(result.deltaPct).toBe(Infinity);
  });

  it("fails a variant beyond 12 % and rejects invalid input like the engine", () => {
    // Lemon juice: 22 kcal against 31.6 predicted per 100 g → 43.64 %.
    const lemon = variantAtwaterCheck(
      {
        method: "raw",
        ingredients: [{ ingredientId: "lemon_juice", rawG: 100, isAbsorbedOil: false }],
      },
      ctx,
      none,
    );
    expect(lemon.ok).toBe(false);
    expect(lemon.deltaPct).toBeCloseTo(43.636, 2);
    expect(() =>
      variantAtwaterCheck(
        { method: "raw", ingredients: [{ ingredientId: "nope", rawG: 100, isAbsorbedOil: false }] },
        ctx,
        none,
      ),
    ).toThrow(NutritionError);
  });
});
