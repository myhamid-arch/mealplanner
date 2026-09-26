import { describe, expect, it } from "vitest";
import { variantNutritionPer100gCooked } from "../../src/nutrition/index.js";
import { friedHasMoreFat } from "./compare.js";
import { fixtureCatalog } from "./fixtures/catalog.js";
import { METHOD_PAIR_SETS, pairVariant } from "./fixtures/pairs.js";

const ctx = fixtureCatalog();

describe("grilled vs deep_fried (NUT-2, ledger G3)", () => {
  it.each(METHOD_PAIR_SETS.map((s) => s.name))(
    "%s: deep-fried has more fat per 100 g cooked",
    (name) => {
      const grilled = variantNutritionPer100gCooked(pairVariant(name, "grilled"), ctx);
      const fried = variantNutritionPer100gCooked(pairVariant(name, "deep_fried"), ctx);
      expect(friedHasMoreFat(grilled.per100g, fried.per100g)).toBe(true);
    },
  );

  it.each(METHOD_PAIR_SETS.map((s) => s.name))(
    "%s: identical methods give identical output (negative control)",
    (name) => {
      const first = variantNutritionPer100gCooked(pairVariant(name, "grilled"), ctx);
      const second = variantNutritionPer100gCooked(pairVariant(name, "grilled"), ctx);
      expect(second).toEqual(first);
      expect(friedHasMoreFat(first.per100g, second.per100g)).toBe(false);
    },
  );
});
