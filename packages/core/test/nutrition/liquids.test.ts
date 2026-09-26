import { describe, expect, it } from "vitest";
import { type CatalogContext, variantNutritionPer100gCooked } from "../../src/nutrition/index.js";
import { fixtureCatalog } from "./fixtures/catalog.js";

const base = fixtureCatalog();

describe("cooking liquids and absorption capacity (ADR-2 §3)", () => {
  it("a retained liquid keeps its mass but adds no oil-absorption capacity", () => {
    // A catalogue where frying would let the liquid itself "absorb" 10 g oil per 100 g.
    const ctx: CatalogContext = {
      ...base,
      methodYields: [
        ...base.methodYields,
        {
          method: "deep_fried",
          category: "beverage",
          yieldFactor: 1,
          fatRetention: 1,
          oilAbsorptionGPer100gRaw: 10,
        },
      ],
    };
    const result = variantNutritionPer100gCooked(
      {
        method: "deep_fried",
        ingredients: [
          { ingredientId: "white_fish", rawG: 1000, isAbsorbedOil: false },
          { ingredientId: "water", rawG: 100, isAbsorbedOil: false, cookingLiquid: "retained" },
          { ingredientId: "sunflower_oil", rawG: 500, isAbsorbedOil: true },
        ],
      },
      ctx,
    );
    // Capacity counts the fish only: 1000 * 6 / 100 = 60 g (not 60 + 100 * 10 / 100 = 70 g).
    // W = 1000 * 0.8 + 100 * 1 + 60 = 960 g; fat = 1000 * 1.2 / 100 + 60 * 100 / 100 = 72 g
    // → 72 / 960 * 100 = 7.5 g per 100 g cooked.
    expect(result.batchCookedG).toBeCloseTo(960, 9);
    expect(result.per100g.fat).toBeCloseTo(7.5, 9);
  });
});
