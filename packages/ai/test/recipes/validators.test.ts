// Unit tests of the REC-5 checks (G1): the definitions in leaf-1.3.1 ADR-2.
import { atwaterCheck, variantNutritionPer100gCooked } from "@mealplanner/core/nutrition";
import { describe, expect, it } from "vitest";
import {
  catalogContext,
  coatingSlugs,
  coreIngredientSlugs,
  jaccard,
  trigramSimilarity,
  trigrams,
  variantAtwaterCheck,
  variantInput,
  variantShare,
  validateBatch,
  type AtwaterFactors,
  type DishBatch,
  type GeneratedComponent,
  type GeneratedVariant,
} from "../../src/recipes/index.js";
import { checkReferences, newIngredientProblems } from "../../src/recipes/validate/references.js";
import { checkVariants } from "../../src/recipes/validate/variants.js";
import { loadCatalogue } from "./support/catalogue.js";
import { batchFixture } from "./support/recorded.js";
import { f1DinnerRequest } from "./support/scenario.js";

const catalogue = loadCatalogue();
const categoryOf = (slug: string) => catalogue.ingredients.find((i) => i.slug === slug)?.category;

function variant(
  method: string,
  lines: Array<[string, number, boolean?]>,
  isDefault = false,
): GeneratedVariant {
  return {
    method,
    label: method,
    isDefault,
    ingredients: lines.map(([slug, g, fat]) => ({
      slug,
      rawGramsPerBatch: g,
      isAbsorbedFat: fat ?? false,
    })),
    steps: ["1. Cook."],
    cookTimeMin: 10,
  };
}

function component(variants: GeneratedVariant[]): GeneratedComponent {
  return {
    name: "Fish",
    role: "protein",
    portioning: "continuous",
    minServingG: 80,
    maxServingG: 200,
    defaultServingG: 120,
    required: true,
    variants,
  };
}

describe("step 4: variant share", () => {
  it("measures the weight overlap of the core compositions", () => {
    const a = new Map([
      ["cod", 900],
      ["lemon-juice", 100],
    ]);
    expect(variantShare(a, a)).toBeCloseTo(1, 12);
    expect(
      variantShare(
        a,
        new Map([
          ["cod", 500],
          ["lemon-juice", 500],
        ]),
      ),
    ).toBeCloseTo(0.6, 12);
    expect(variantShare(a, new Map([["hammour", 1000]]))).toBe(0);
    expect(variantShare(new Map(), new Map())).toBe(1);
  });

  it("ignores cooking fat and a breaded variant's coating", () => {
    const grilled = variant(
      "grilled",
      [
        ["cod", 1000],
        ["lemon-juice", 20],
        ["olive-oil", 15],
      ],
      true,
    );
    const breaded = variant("breaded_fried", [
      ["cod", 900],
      ["lemon-juice", 20],
      ["breadcrumbs", 200],
      ["egg", 80],
      ["sunflower-oil", 150, true],
    ]);
    const c = component([grilled, breaded]);
    expect([...coatingSlugs(c)].sort()).toEqual(["breadcrumbs", "egg", "sunflower-oil"]);
    expect(checkVariants([c], categoryOf)).toEqual([]);
    // The same breadcrumbs in a non-breaded variant are core, and drift below 70 %.
    const crumbed = variant("baked", [
      ["cod", 300],
      ["breadcrumbs", 400],
      ["egg", 300],
    ]);
    const drift = checkVariants([component([grilled, crumbed])], categoryOf);
    expect(drift.map((r) => r.code)).toEqual(["variant_drift"]);
  });
});

describe("step 5: variant energy check (R-22, R-30)", () => {
  const ctx = catalogContext(catalogue);
  const noFactors = new Map<string, AtwaterFactors>();
  const factors = new Map<string, AtwaterFactors>();
  for (const i of catalogue.ingredients)
    if (i.atwaterFactors !== null) factors.set(i.slug, i.atwaterFactors);

  it("equals the generic check on the variant when no factors are given", () => {
    const v = variantInput(
      variant("roasted", [
        ["potato", 1000],
        ["olive-oil", 40, true],
        ["salt", 5],
      ]),
    );
    const generic = atwaterCheck(variantNutritionPer100gCooked(v, ctx).per100g);
    const mine = variantAtwaterCheck(v, ctx, noFactors);
    expect(mine.deltaPct).toBeCloseTo(generic.deltaPct, 9);
    expect(mine.ok).toBe(generic.ok);
  });

  it("uses each ingredient's own factors where recorded", () => {
    const v = variantInput(variant("steamed", [["mushrooms", 1000]]));
    const generic = variantAtwaterCheck(v, ctx, noFactors);
    const specific = variantAtwaterCheck(v, ctx, factors);
    expect(factors.has("mushrooms")).toBe(true);
    expect(specific.deltaPct).toBeLessThan(generic.deltaPct);
    expect(specific.ok).toBe(true);
    expect(specific.kcal).toBeCloseTo(generic.kcal, 9);
  });

  it("fails a variant whose energy the macronutrients do not explain (alcohol)", () => {
    const v = variantInput(
      variant("braised", [
        ["beef-eye-round", 700],
        ["cooking-wine-red", 900],
      ]),
    );
    const check = variantAtwaterCheck(v, ctx, factors);
    expect(check.ok).toBe(false);
    expect(check.deltaPct).toBeGreaterThan(12);
  });
});

describe("step 6: duplication", () => {
  it("computes pg_trgm similarity", () => {
    // Values from PostgreSQL 16 pg_trgm: similarity('word', 'two words') = 0.36363637.
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.36363637, 6);
    expect(trigrams("cat")).toEqual(new Set(["  c", " ca", "cat", "at "]));
    expect(trigramSimilarity("Chicken Tikka", "chicken tikka")).toBe(1);
    expect(trigramSimilarity("Lentil soup", "Beef stew")).toBeLessThan(0.2);
  });

  it("computes core-ingredient Jaccard without fats and spices", () => {
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 12);
    const c = component([
      variant(
        "grilled",
        [
          ["cod", 1000],
          ["olive-oil", 10],
          ["salt", 5],
          ["lemon-juice", 20],
        ],
        true,
      ),
    ]);
    expect(coreIngredientSlugs([c], categoryOf)).toEqual(["cod", "lemon-juice"]);
  });

  it("rejects a second copy of a dish within the same batch", async () => {
    const valid = batchFixture("valid-batch");
    const first = valid.dishes[0];
    if (first === undefined) throw new Error("fixture");
    const batch: DishBatch = {
      dishes: [first, { ...first, name: `${first.name}.` }],
      newIngredients: [],
    };
    const { context, solveTargets } = f1DinnerRequest();
    const out = await validateBatch(batch, {
      catalogue,
      slotKeys: ["dinner", "lunch"],
      exclusions: context.exclusions,
      existingDishes: [],
      solveTargets,
      adjusters: [],
    });
    expect(out.map((o) => o.status)).toEqual(["candidate", "rejected"]);
  });
});

describe("step 2: references and new ingredients", () => {
  const dish = batchFixture("valid-batch").dishes[0];
  if (dish === undefined) throw new Error("fixture");

  it("accepts the valid dish and flags unknown keys and bounds", () => {
    expect(checkReferences(dish, catalogue, ["dinner", "lunch"], new Map())).toEqual([]);
    const bad = {
      ...dish,
      cuisine: "martian",
      slotKeys: ["dinner", "midnight_feast"],
      components: dish.components.map((c, i) =>
        i === 0
          ? {
              ...c,
              minServingG: 300,
              variants: c.variants.map((v) => ({ ...v, method: "teleported" })),
            }
          : c,
      ),
    };
    const codes = checkReferences(bad, catalogue, ["dinner", "lunch"], new Map()).map(
      (r) => r.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "unknown_cuisine",
        "unknown_slot",
        "bad_serving_bounds",
        "unknown_method",
      ]),
    );
  });

  it("checks a proposed ingredient's slug, category and nutrition", () => {
    const good = {
      slug: "sumac",
      name: "Sumac",
      category: "herb_spice",
      per100g: {
        kcal: 250,
        protein: 5,
        carbs: 30,
        fat: 10,
        satFat: 1,
        fibre: 20,
        solubleFibre: null,
      },
      sourceNote: "USDA SR 02035 proxy",
    };
    expect(newIngredientProblems(good, catalogue)).toEqual([]);
    expect(newIngredientProblems({ ...good, slug: "tahini" }, catalogue)).toContain(
      '"tahini" is already in the catalogue',
    );
    expect(newIngredientProblems({ ...good, category: "spice" }, catalogue)).toContain(
      'unknown category "spice"',
    );
    expect(
      newIngredientProblems({ ...good, per100g: { ...good.per100g, satFat: 12 } }, catalogue),
    ).toContain("satFat exceeds fat");
  });

  it("rejects a new ingredient when an allergy is excluded, and checks its Atwater otherwise", async () => {
    const newIngredient = {
      slug: "sumac",
      name: "Sumac",
      category: "herb_spice",
      per100g: {
        kcal: 400,
        protein: 5,
        carbs: 30,
        fat: 10,
        satFat: 1,
        fibre: 20,
        solubleFibre: null,
      },
      sourceNote: "estimate",
    };
    const withSumac = {
      ...dish,
      components: dish.components.map((c, i) =>
        i === 0
          ? {
              ...c,
              variants: c.variants.map((v) => ({
                ...v,
                ingredients: [
                  ...v.ingredients,
                  { slug: "sumac", rawGramsPerBatch: 5, isAbsorbedFat: false },
                ],
              })),
            }
          : c,
      ),
    };
    const { context, solveTargets } = f1DinnerRequest();
    const env = {
      catalogue,
      slotKeys: ["dinner", "lunch"],
      existingDishes: [],
      solveTargets,
      adjusters: [],
    };
    const allergic = await validateBatch(
      { dishes: [withSumac], newIngredients: [newIngredient] },
      { ...env, exclusions: context.exclusions },
    );
    expect(
      allergic[0]?.status === "rejected" ? allergic[0].reasons.map((r) => r.code) : [],
    ).toContain("unverifiable_new_ingredient");
    const open = await validateBatch(
      { dishes: [withSumac], newIngredients: [newIngredient] },
      {
        ...env,
        exclusions: { ingredients: [], categories: [], dietaryFlags: [] },
      },
    );
    expect(open[0]?.status === "rejected" ? open[0].reasons.map((r) => r.code) : []).toEqual([
      "atwater_new_ingredient",
    ]);
  });
});
