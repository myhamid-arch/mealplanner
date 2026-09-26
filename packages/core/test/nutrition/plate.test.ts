import { describe, expect, it } from "vitest";
import { NutritionError, type Nutrients, plateNutrients } from "../../src/nutrition/index.js";

function n(partial: Partial<Nutrients>): Nutrients {
  return {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    satFat: 0,
    fibre: 0,
    solubleFibre: 0,
    sugar: 0,
    sodiumMg: 0,
    ...partial,
  };
}

describe("plateNutrients", () => {
  it("adds per-100 g values scaled by cooked grams", () => {
    const plate = plateNutrients([
      {
        per100g: n({ kcal: 150, protein: 30, fat: 3, solubleFibre: 1, sugar: 2, sodiumMg: 60 }),
        cookedG: 200,
      },
      {
        per100g: n({
          kcal: 130,
          carbs: 28,
          fibre: 0.4,
          solubleFibre: 0.2,
          sugar: 0.1,
          sodiumMg: 1,
        }),
        cookedG: 150,
      },
    ]);
    // kcal 150 * 2 + 130 * 1.5 = 495; protein 60; carbs 42; fat 6; fibre 0.6;
    // soluble fibre 2 + 0.3 = 2.3; sugar 4 + 0.15 = 4.15; sodium 120 + 1.5 = 121.5
    expect(plate.kcal).toBeCloseTo(495, 10);
    expect(plate.protein).toBeCloseTo(60, 10);
    expect(plate.carbs).toBeCloseTo(42, 10);
    expect(plate.fat).toBeCloseTo(6, 10);
    expect(plate.fibre).toBeCloseTo(0.6, 10);
    expect(plate.solubleFibre).toBeCloseTo(2.3, 10);
    expect(plate.sugar).toBeCloseTo(4.15, 10);
    expect(plate.sodiumMg).toBeCloseTo(121.5, 10);
  });

  it("returns zeros for an empty plate", () => {
    expect(plateNutrients([])).toEqual(n({}));
  });

  it("propagates an unknown value, except where a zero bound makes it known (R-13)", () => {
    const unknownSoluble = n({
      fibre: 2,
      solubleFibre: null,
      carbs: 5,
      sugar: null,
      sodiumMg: null,
    });
    const boundedZero = n({ fibre: 0, solubleFibre: null, carbs: 0, sugar: null, sodiumMg: 5 });
    const plate = plateNutrients([
      { per100g: n({ fibre: 1, solubleFibre: 0.5, carbs: 1, sugar: 1 }), cookedG: 100 },
      { per100g: boundedZero, cookedG: 100 },
    ]);
    expect(plate.solubleFibre).toBeCloseTo(0.5, 10);
    expect(plate.sugar).toBeCloseTo(1, 10);
    const unknown = plateNutrients([{ per100g: unknownSoluble, cookedG: 100 }]);
    expect(unknown.solubleFibre).toBeNull();
    expect(unknown.sugar).toBeNull();
    expect(unknown.sodiumMg).toBeNull();
  });

  it("ignores unknowns of an item with 0 g on the plate", () => {
    const plate = plateNutrients([{ per100g: n({ fibre: 1, solubleFibre: null }), cookedG: 0 }]);
    expect(plate.solubleFibre).toBe(0);
  });

  it.each([-5, Number.NaN])("rejects cookedG %s", (cookedG) => {
    expect(() => plateNutrients([{ per100g: n({}), cookedG }])).toThrow(NutritionError);
  });

  it("rejects negative nutrient values", () => {
    expect(() => plateNutrients([{ per100g: n({ fat: -1 }), cookedG: 10 }])).toThrow(
      /fat must be a finite number >= 0/,
    );
  });
});
