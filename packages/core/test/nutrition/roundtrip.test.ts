import { describe, expect, it } from "vitest";
import {
  NutritionError,
  plateNutrients,
  rawForCooked,
  variantNutritionPer100gCooked,
  type VariantInput,
} from "../../src/nutrition/index.js";
import { type NutritionApi, roundTripMismatches } from "./compare.js";
import { fixtureCatalog } from "./fixtures/catalog.js";
import { GOLDEN_CASES } from "./fixtures/golden.js";

const ctx = fixtureCatalog();
const api: NutritionApi = { variantNutritionPer100gCooked, rawForCooked, plateNutrients };

/** Known-bad raw-from-cooked: scales by total raw grams, ignoring yield and absorption. */
const yieldIgnoringApi: NutritionApi = {
  ...api,
  rawForCooked: (v: VariantInput, cookedG: number) => {
    const totalRaw = v.ingredients.reduce((sum, row) => sum + row.rawG, 0);
    return v.ingredients.map((row) => ({
      ingredientId: row.ingredientId,
      rawG: (row.rawG * cookedG) / totalRaw,
    }));
  },
};

describe("rawForCooked round trip (NUT-3 step 4, ledger G2)", () => {
  it.each(GOLDEN_CASES.map((c) => [c.id, c] as const))("%s round-trips within 0.1 %%", (id, c) => {
    expect(roundTripMismatches(id, c.variant, api, ctx)).toEqual([]);
  });

  it("negative control: a yield-ignoring conversion fails", () => {
    const problems = GOLDEN_CASES.flatMap((c) =>
      roundTripMismatches(c.id, c.variant, yieldIgnoringApi, ctx),
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("scales every listed row, flags frying fat and keeps absorbed water", () => {
    const v: VariantInput = {
      method: "deep_fried",
      ingredients: [
        { ingredientId: "white_fish", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 500, isAbsorbedOil: true },
      ],
    };
    // W = 1000 * 0.8 + min(1000 * 6 / 100, 500) = 860 g; 215 g cooked is a quarter batch.
    expect(rawForCooked(v, 215, ctx)).toEqual([
      { ingredientId: "white_fish", rawG: 250 },
      { ingredientId: "sunflower_oil", rawG: 125, discardedFat: true },
    ]);
    const rice: VariantInput = {
      method: "boiled",
      ingredients: [
        { ingredientId: "basmati_rice", rawG: 300, isAbsorbedOil: false },
        { ingredientId: "water", rawG: 900, isAbsorbedOil: false, cookingLiquid: "absorbed" },
      ],
    };
    // W = 300 * 2.8 = 840 g; 420 g cooked is half a batch.
    expect(rawForCooked(rice, 420, ctx)).toEqual([
      { ingredientId: "basmati_rice", rawG: 150 },
      { ingredientId: "water", rawG: 450 },
    ]);
  });

  it("returns zero raw grams for zero cooked grams", () => {
    const c = GOLDEN_CASES[0];
    if (c === undefined) throw new Error("no golden cases");
    expect(rawForCooked(c.variant, 0, ctx).every((line) => line.rawG === 0)).toBe(true);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects cookedG %s", (cookedG) => {
    const c = GOLDEN_CASES[0];
    if (c === undefined) throw new Error("no golden cases");
    expect(() => rawForCooked(c.variant, cookedG, ctx)).toThrow(NutritionError);
  });
});
