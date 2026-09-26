import { describe, expect, it } from "vitest";
import {
  atwaterCheck,
  type Nutrients,
  variantNutritionPer100gCooked,
} from "../../src/nutrition/index.js";
import { fixtureCatalog } from "./fixtures/catalog.js";

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
