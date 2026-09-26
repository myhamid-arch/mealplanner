import { describe, expect, it } from "vitest";
import {
  type CatalogContext,
  ENGINE_VERSION,
  NutritionError,
  type NutritionErrorCode,
  type VariantInput,
  variantNutritionPer100gCooked,
} from "../../src/nutrition/index.js";
import { fixtureCatalog } from "./fixtures/catalog.js";

const ctx = fixtureCatalog();

function grilledChicken(
  overrides: Partial<VariantInput["ingredients"][number]> = {},
): VariantInput {
  return {
    method: "grilled",
    ingredients: [
      { ingredientId: "chicken_breast", rawG: 500, isAbsorbedOil: false, ...overrides },
    ],
  };
}

function expectCode(run: () => unknown, code: NutritionErrorCode): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NutritionError);
  expect((caught as NutritionError).code).toBe(code);
  expect((caught as NutritionError).name).toBe("NutritionError");
}

function withYield(change: Record<string, number>): CatalogContext {
  return {
    ...ctx,
    methodYields: ctx.methodYields.map((y) =>
      y.method === "grilled" && y.category === "poultry" ? { ...y, ...change } : y,
    ),
  };
}

describe("invalid input (SPEC-Q-6)", () => {
  it("rejects an unknown ingredient", () => {
    expectCode(
      () => variantNutritionPer100gCooked(grilledChicken({ ingredientId: "unicorn" }), ctx),
      "unknown_ingredient",
    );
  });

  it("rejects a missing method_yield row", () => {
    expectCode(
      () => variantNutritionPer100gCooked({ ...grilledChicken(), method: "smoked" }, ctx),
      "missing_method_yield",
    );
  });

  it("rejects duplicate method_yield rows", () => {
    const [first] = ctx.methodYields;
    if (first === undefined) throw new Error("no rows");
    const duplicated = { ...ctx, methodYields: [...ctx.methodYields, { ...first }] };
    expectCode(
      () =>
        variantNutritionPer100gCooked(
          {
            method: first.method,
            ingredients: [{ ingredientId: "chicken_breast", rawG: 100, isAbsorbedOil: false }],
          },
          duplicated,
        ),
      "duplicate_method_yield",
    );
  });

  it.each([
    [{ yieldFactor: 0 }],
    [{ yieldFactor: Number.NaN }],
    [{ fatRetention: 1.2 }],
    [{ fatRetention: -0.1 }],
    [{ oilAbsorptionGPer100gRaw: -1 }],
  ])("rejects the yield row %o", (change) => {
    expectCode(
      () => variantNutritionPer100gCooked(grilledChicken(), withYield(change)),
      "invalid_input",
    );
  });

  it.each([[{ rawG: -1 }], [{ rawG: Number.POSITIVE_INFINITY }], [{ yieldOverride: 0 }]])(
    "rejects the ingredient row %o",
    (change) => {
      expectCode(() => variantNutritionPer100gCooked(grilledChicken(change), ctx), "invalid_input");
    },
  );

  it("rejects a row that is both frying fat and cooking liquid", () => {
    expectCode(
      () =>
        variantNutritionPer100gCooked(
          grilledChicken({ isAbsorbedOil: true, cookingLiquid: "absorbed" }),
          ctx,
        ),
      "invalid_input",
    );
  });

  it("rejects negative catalogue nutrients", () => {
    const chicken = ctx.ingredients.get("chicken_breast");
    if (chicken === undefined) throw new Error("fixture missing");
    const broken: CatalogContext = {
      ...ctx,
      ingredients: new Map([
        ["chicken_breast", { ...chicken, per100gRaw: { ...chicken.per100gRaw, protein: -2 } }],
      ]),
    };
    expectCode(() => variantNutritionPer100gCooked(grilledChicken(), broken), "invalid_input");
  });

  it("rejects a variant with no cooked mass", () => {
    expectCode(
      () => variantNutritionPer100gCooked({ method: "boiled", ingredients: [] }, ctx),
      "zero_cooked_mass",
    );
    expectCode(
      () =>
        variantNutritionPer100gCooked(
          {
            method: "boiled",
            ingredients: [
              { ingredientId: "water", rawG: 500, isAbsorbedOil: false, cookingLiquid: "absorbed" },
            ],
          },
          ctx,
        ),
      "zero_cooked_mass",
    );
  });
});

describe("public entry", () => {
  it("exposes the engine version", () => {
    expect(ENGINE_VERSION).toBe("1.0.0");
  });
});
