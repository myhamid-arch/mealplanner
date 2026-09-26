import { describe, expect, it } from "vitest";
import { variantNutritionPer100gCooked } from "../../src/nutrition/index.js";
import { GOLDEN_TOLERANCE, goldenMismatches } from "./compare.js";
import { fixtureCatalog } from "./fixtures/catalog.js";
import { GOLDEN_CASES, type GoldenTag } from "./fixtures/golden.js";
import { MUTANTS } from "./fixtures/mutants.js";

const ctx = fixtureCatalog();

describe("golden variants (NUT-3, ledger G1)", () => {
  it("has at least 15 cases covering every required situation", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(15);
    const required: GoldenTag[] = [
      "grilled_vs_fried",
      "breaded",
      "boiled_grain",
      "retained_water_stew",
      "absorbed_oil_cap",
      "known_bound_zero",
      "unknown_nutrient",
    ];
    for (const tag of required) {
      expect(
        GOLDEN_CASES.some((c) => c.tags.includes(tag)),
        tag,
      ).toBe(true);
    }
    expect(new Set(GOLDEN_CASES.map((c) => c.id)).size).toBe(GOLDEN_CASES.length);
  });

  it.each(GOLDEN_CASES.map((c) => [c.id, c] as const))("%s matches within 0.5 %%", (_id, c) => {
    expect(goldenMismatches([c], variantNutritionPer100gCooked, ctx)).toEqual([]);
  });

  it("keeps a known soluble fibre and sugar when oil and salt have null values (R-13)", () => {
    const roasted = GOLDEN_CASES.find((c) => c.id === "roasted_potatoes");
    const result = variantNutritionPer100gCooked(
      roasted?.variant ?? { method: "raw", ingredients: [] },
      ctx,
    );
    expect(result.per100g.solubleFibre).not.toBeNull();
    expect(result.per100g.sugar).not.toBeNull();
  });

  it("reports an unknown value as null when no bound makes it zero (R-13)", () => {
    const peppered = GOLDEN_CASES.find((c) => c.id === "peppered_chicken");
    const zucchini = GOLDEN_CASES.find((c) => c.id === "sauteed_zucchini");
    expect(peppered?.expected.per100g.solubleFibre).toBeNull();
    expect(zucchini?.expected.per100g.sugar).toBeNull();
  });
});

describe("golden negative controls", () => {
  it("rejects a golden value shifted by 0.6 %", () => {
    const [first, ...rest] = GOLDEN_CASES;
    if (first === undefined) throw new Error("no golden cases");
    const shifted = {
      ...first,
      expected: {
        ...first.expected,
        per100g: { ...first.expected.per100g, kcal: first.expected.per100g.kcal * 1.006 },
      },
    };
    expect(goldenMismatches([shifted, ...rest], variantNutritionPer100gCooked, ctx)).toHaveLength(
      1,
    );
  });

  it("accepts a golden value shifted by less than the tolerance", () => {
    const [first] = GOLDEN_CASES;
    if (first === undefined) throw new Error("no golden cases");
    const shifted = {
      ...first,
      expected: {
        ...first.expected,
        per100g: {
          ...first.expected.per100g,
          kcal: first.expected.per100g.kcal * (1 + GOLDEN_TOLERANCE / 2),
        },
      },
    };
    expect(goldenMismatches([shifted], variantNutritionPer100gCooked, ctx)).toEqual([]);
  });

  it.each(MUTANTS.map((m) => [m.name, m] as const))("detects the mutant: %s", (_name, mutant) => {
    const problems = goldenMismatches(
      mutant.cases(GOLDEN_CASES),
      variantNutritionPer100gCooked,
      mutant.catalog(ctx),
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});
