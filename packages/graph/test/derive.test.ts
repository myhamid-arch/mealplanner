// Unit tests for the pure derivation (08 §1, §2; SPEC-Q-3, 5, 6, 7, 9, 10).
import type { IngredientRow, PreferenceRow } from "@mealplanner/core/types";
import { describe, expect, it } from "vitest";
import {
  deriveDish,
  deriveGlobalCatalogue,
  deriveHouseholdCatalogue,
  deriveLibrary,
  derivePreferenceDrafts,
  isSyncedDish,
  macroDelta,
  npmi,
  preferenceTarget,
  type DishBundle,
} from "../src/derive/index.js";

function ingredient(slug: string, over: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    aliases: [],
    category: "vegetable",
    kcal: 100,
    proteinG: 10,
    carbsG: 10,
    fatG: 2,
    satFatG: 1,
    fibreG: 1,
    solubleFibreG: 0.5,
    sugarG: 1,
    sodiumMg: 10,
    densityGPerMl: null,
    unitWeightG: null,
    unitLabel: null,
    ediblePortion: 1,
    dietaryFlags: [],
    nutritionSource: "manual",
    nutritionConfidence: "high",
    localeAvailability: {},
    createdByHouseholdId: null,
    needsReview: false,
    verifiedAt: null,
    verifiedByUserId: null,
    ...over,
  };
}

const HH = "hh-1";

function bundle(over: Partial<DishBundle["dish"]> = {}): DishBundle {
  const now = new Date(0);
  return {
    dish: {
      id: "d1",
      householdId: HH,
      name: "Test dish",
      slug: "test-dish",
      description: "",
      cuisineId: "c1",
      secondaryCuisineId: "c2",
      slotKeys: ["dinner", "custom_ab12"],
      flavourTags: ["smoky", "smoky", "fresh"],
      isPackable: true,
      servedColdOk: false,
      source: "admin",
      status: "active",
      aiGenerationId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...over,
    },
    cuisineKey: "levantine",
    secondaryCuisineKey: "greek",
    components: [
      {
        id: "comp1",
        householdId: HH,
        dishId: "d1",
        name: "Chicken",
        role: "protein",
        portioning: "continuous",
        unitLabel: null,
        minServingG: 50,
        maxServingG: 300,
        defaultServingG: 150,
        stepG: 5,
        sortOrder: 1,
        required: true,
      },
    ],
    variants: [
      {
        id: "v1",
        householdId: HH,
        componentId: "comp1",
        methodId: "m1",
        methodKey: "grilled",
        label: "Grilled",
        isDefault: true,
        steps: [],
        cookTimeMin: null,
        notes: null,
        referenceBatchCookedG: 700,
        needsReview: false,
      },
    ],
    ingredients: [
      { vi: "a", ing: "chicken", g: 750, hh: null },
      { vi: "b", ing: "garlic", g: 50, hh: null },
      { vi: "c", ing: "chicken", g: 150, hh: null },
      { vi: "d", ing: "house-spice", g: 50, hh: HH },
    ].map((x) => ({
      id: x.vi,
      householdId: HH,
      variantId: "v1",
      ingredientId: x.ing,
      rawGPerBatch: x.g,
      roleNote: null,
      isAbsorbedOil: false,
      cookingLiquid: null,
      yieldOverride: null,
      ingredientHouseholdId: x.hh,
    })),
  };
}

describe("dish derivation", () => {
  it("derives Dish/Component/Variant nodes and every dish edge with household scope", () => {
    const d = deriveDish(bundle());
    expect(
      d.nodes
        .filter((n) => n.type === "Dish" || n.type === "Component" || n.type === "Variant")
        .map((n) => [n.type, n.key, n.householdId]),
    ).toEqual([
      ["Dish", "d1", HH],
      ["Component", "comp1", HH],
      ["Variant", "v1", HH],
    ]);
    expect(d.edges.every((e) => e.householdId === HH)).toBe(true);
    const contains = d.edges.filter((e) => e.type === "CONTAINS");
    // chicken 750 + 150 = 900 of 1000 g; garlic 50; house spice 50 (household-private node).
    expect(contains.map((e) => [e.dst.key, e.dst.householdId, e.weight, e.props])).toEqual([
      ["chicken", null, 0.9, { rawG: 900 }],
      ["garlic", null, 0.05, { rawG: 50 }],
      ["house-spice", HH, 0.05, { rawG: 50 }],
    ]);
    expect(
      d.edges.filter((e) => e.type === "OF_CUISINE").map((e) => [e.dst.key, e.weight]),
    ).toEqual([
      ["levantine", 1],
      ["greek", 0.5],
    ]);
    expect(
      d.edges.filter((e) => e.type === "PART_OF").map((e) => `${e.src.key}->${e.dst.key}`),
    ).toEqual(["comp1->d1", "v1->comp1"]);
    expect(d.edges.filter((e) => e.type === "PREPARED_BY").map((e) => e.dst.key)).toEqual([
      "grilled",
    ]);
    expect(
      d.edges.filter((e) => e.type === "HAS_FLAVOUR").map((e) => [e.dst.key, e.source]),
    ).toEqual([
      ["smoky", "derived"],
      ["fresh", "derived"],
    ]);
    expect(d.edges.filter((e) => e.type === "SUITS_SLOT").map((e) => e.dst.key)).toEqual([
      "dinner",
      "custom_ab12",
    ]);
    expect(d.nodes.find((n) => n.key === "dinner")?.label).toBe("Dinner");
    expect(d.nodes.find((n) => n.key === "custom_ab12")?.label).toBe("custom_ab12");
    expect(d.owned.map((r) => r.key)).toEqual(["d1", "comp1", "v1"]);
  });

  it("marks seed dishes' flavour edges as seed and skips a secondary cuisine equal to the primary", () => {
    const b = bundle({ source: "seed", householdId: null });
    b.secondaryCuisineKey = "levantine";
    const d = deriveDish(b);
    expect(d.edges.filter((e) => e.type === "HAS_FLAVOUR").every((e) => e.source === "seed")).toBe(
      true,
    );
    expect(d.edges.filter((e) => e.type === "OF_CUISINE")).toHaveLength(1);
  });

  it("does not sync draft dishes (SPEC-Q-10)", () => {
    expect(isSyncedDish(bundle({ status: "draft" }))).toBe(false);
    expect(isSyncedDish(bundle({ status: "retired" }))).toBe(true);
    expect(isSyncedDish(undefined)).toBe(false);
  });

  it("rejects a variant of a component outside the dish", () => {
    const b = bundle();
    (b.variants[0] as { componentId: string }).componentId = "other";
    expect(() => deriveDish(b)).toThrow(/belongs to no component/);
  });
});

describe("catalogue derivation", () => {
  const input = {
    ingredients: [
      ingredient("chicken-breast", {
        category: "poultry",
        proteinG: 23,
        carbsG: 0,
        fatG: 2,
        sugarG: null,
      }),
      ingredient("turkey-breast", {
        category: "poultry",
        proteinG: 24,
        carbsG: 0.5,
        fatG: 1,
        sugarG: 0,
      }),
      ingredient("house-mix", { createdByHouseholdId: HH }),
    ],
    cuisines: [{ id: "c", key: "levantine", label: "Levantine", parentKey: null }],
    methods: [
      { id: "m", key: "grilled", label: "Grilled", description: "", appealTags: ["smoky"] },
    ],
    substitutes: [
      { fromSlug: "chicken-breast", toSlug: "turkey-breast", weight: 0.9, context: "c", note: "n" },
    ],
  };

  it("derives global nodes (22 categories), IN_CATEGORY and SUBSTITUTES_FOR with the macro delta", () => {
    const d = deriveGlobalCatalogue(input);
    expect(d.nodes.filter((n) => n.type === "IngredientCategory")).toHaveLength(22);
    expect(d.nodes.filter((n) => n.type === "Ingredient").map((n) => n.key)).toEqual([
      "id-chicken-breast",
      "id-turkey-breast",
    ]);
    const sub = d.edges.find((e) => e.type === "SUBSTITUTES_FOR");
    expect(sub?.weight).toBe(0.9);
    expect(sub?.props).toMatchObject({
      macroDelta: { protein: 1, carbs: 0.5, fat: -1, kcal: 0, sugar: null },
      context: "c",
      note: "n",
    });
    expect(d.edges.filter((e) => e.type === "IN_CATEGORY").map((e) => e.dst.key)).toEqual([
      "poultry",
      "poultry",
    ]);
  });

  it("macroDelta is substitute − original; unknown stays unknown (NUT-8)", () => {
    const a = ingredient("a", { sodiumMg: null, kcal: 120.4 });
    const b = ingredient("b", { kcal: 100.1 });
    expect(macroDelta(a, b)).toMatchObject({ kcal: -20.3, sodiumMg: null, protein: 0 });
  });

  it("throws on a substitute naming an unknown slug or an out-of-range weight", () => {
    expect(() =>
      deriveGlobalCatalogue({
        ...input,
        substitutes: [{ fromSlug: "x", toSlug: "turkey-breast", weight: 1, context: "", note: "" }],
      }),
    ).toThrow(/unknown ingredient slug x/);
    expect(() =>
      deriveGlobalCatalogue({
        ...input,
        substitutes: [
          {
            fromSlug: "chicken-breast",
            toSlug: "turkey-breast",
            weight: 1.5,
            context: "",
            note: "",
          },
        ],
      }),
    ).toThrow(/weight/);
  });

  it("household catalogue holds only that household's private ingredients", () => {
    const d = deriveHouseholdCatalogue(HH, input.ingredients);
    expect(d.nodes.map((n) => [n.key, n.householdId])).toEqual([["id-house-mix", HH]]);
    expect(d.edges.map((e) => e.householdId)).toEqual([HH]);
  });
});

describe("preference mirror (SPEC-Q-7)", () => {
  const row = (over: Partial<PreferenceRow>): PreferenceRow => ({
    id: "p",
    householdId: HH,
    memberId: "m1",
    entityType: "dish",
    entityKey: "d1",
    score: 0.5,
    evidenceWeight: 1,
    source: "learned",
    locked: false,
    hard: "none",
    updatedAt: new Date(0),
    ...over,
  });

  it("mirrors each member's winning row by 1.3.2 precedence; skips household-level, zero and component_role", () => {
    const drafts = derivePreferenceDrafts(
      ["m1"],
      [
        row({ entityKey: "d1", score: 0.6, source: "learned" }),
        row({ entityKey: "d1", score: -0.4, source: "explicit" }),
        row({ entityType: "ingredient", entityKey: "i1", score: 0.2, source: "explicit" }),
        row({
          entityType: "ingredient",
          entityKey: "i1",
          score: 0.9,
          source: "learned",
          locked: true,
        }),
        row({ entityType: "dish", entityKey: "d2#v7", score: 0.3 }),
        row({ entityType: "cuisine", entityKey: "levantine", score: 0 }),
        row({ entityType: "component_role", entityKey: "vegetable", score: 0.8 }),
        row({ memberId: null, entityType: "cuisine", entityKey: "italian", score: 0.5 }),
        row({ memberId: "m2", entityType: "method", entityKey: "grilled", score: 0.5 }),
      ],
    );
    expect(
      drafts.map((d) => [d.type, d.target.type, d.target.key, d.weight, d.props.source]),
    ).toEqual([
      ["DISLIKES", "Dish", "d1", 0.4, "explicit"],
      ["LIKES", "Ingredient", "i1", 0.9, "learned"],
      ["LIKES", "Variant", "v7", 0.3, "learned"],
    ]);
  });

  it("maps every entity type with a node", () => {
    expect(preferenceTarget({ entityType: "method", entityKey: "grilled" })).toEqual({
      type: "Method",
      key: "grilled",
    });
    expect(preferenceTarget({ entityType: "flavour_tag", entityKey: "smoky" })).toEqual({
      type: "FlavourTag",
      key: "smoky",
    });
    expect(preferenceTarget({ entityType: "cuisine", entityKey: "greek" })).toEqual({
      type: "Cuisine",
      key: "greek",
    });
    expect(preferenceTarget({ entityType: "component_role", entityKey: "carb" })).toBeNull();
  });
});

describe("library statistics (SPEC-Q-5, SPEC-Q-6)", () => {
  const lib = (id: string, cuisines: Array<[string, number]>, ings: string[]) => ({
    dishId: id,
    householdId: null,
    cuisines: cuisines.map(([key, weight]) => ({ key, weight })),
    ingredients: ings.map((i) => ({ id: i, householdId: null })),
  });

  it("npmi matches the hand-computed value and is 1 when every dish holds the pair", () => {
    // n = 4, a in 2, b in 2, both in 2: log((1/2)/((1/2)(1/2))) / −log(1/2) = 1.
    expect(npmi(2, 2, 2, 4)).toBeCloseTo(1, 12);
    // n = 4, a in 3, b in 3, both in 2: log(0.5 / 0.5625) / −log 0.5 = −0.16993.
    expect(npmi(3, 3, 2, 4)).toBeCloseTo(Math.log(0.5 / 0.5625) / Math.log(2), 12);
    expect(npmi(4, 4, 4, 4)).toBe(1);
  });

  it("PAIRS_WITH: NPMI > 0 with ≥ 2 co-occurrences, both directions; TYPICAL_IN: weighted share", () => {
    const dishes = [
      lib("d1", [["levantine", 1]], ["a", "b", "c"]),
      lib(
        "d2",
        [
          ["levantine", 1],
          ["greek", 0.5],
        ],
        ["a", "b"],
      ),
      lib("d3", [["greek", 1]], ["c", "d"]),
      lib("d4", [["italian", 1]], ["d", "e"]),
      lib("d5", [["italian", 1]], ["e"]),
    ];
    const edges = deriveLibrary(dishes, null);
    const pairs = edges.filter((e) => e.type === "PAIRS_WITH");
    // a–b co-occur in 2 of 5 dishes, each in 2: npmi = log((2/5)/((2/5)²)) / −log(2/5) = 1.
    // c–a and c–b co-occur once only (< 2); d–e once only.
    expect(pairs.map((e) => [e.src.key, e.dst.key, e.weight, e.props])).toEqual([
      ["a", "b", 1, { dishes: 2 }],
      ["b", "a", 1, { dishes: 2 }],
    ]);
    const typical = new Map(
      edges
        .filter((e) => e.type === "TYPICAL_IN")
        .map((e) => [`${e.src.key}@${e.dst.key}`, e.weight]),
    );
    // levantine: d1 (1), d2 (1) → total 2. a: 2/2 = 1; c: 1/2.
    expect(typical.get("a@levantine")).toBe(1);
    expect(typical.get("c@levantine")).toBe(0.5);
    // greek: d2 (0.5), d3 (1) → total 1.5. a: 0.5/1.5 = 0.333; c: 1/1.5 = 0.667.
    expect(typical.get("a@greek")).toBe(0.333);
    expect(typical.get("c@greek")).toBe(0.667);
    expect(typical.get("e@italian")).toBe(1);
    expect(typical.has("e@levantine")).toBe(false);
    expect(edges.every((e) => e.householdId === null && e.source === "derived")).toBe(true);
  });

  it("household scope stamps every edge and keeps private ingredient scopes", () => {
    const dishes = [
      {
        ...lib("d1", [["levantine", 1]], ["a"]),
        ingredients: [
          { id: "a", householdId: null },
          { id: "p", householdId: HH },
        ],
      },
      {
        ...lib("d2", [["levantine", 1]], ["a"]),
        householdId: HH,
        ingredients: [
          { id: "a", householdId: null },
          { id: "p", householdId: HH },
        ],
      },
    ];
    const edges = deriveLibrary(dishes, HH);
    expect(edges.every((e) => e.householdId === HH)).toBe(true);
    expect(edges.find((e) => e.type === "PAIRS_WITH" && e.src.key === "p")?.src.householdId).toBe(
      HH,
    );
  });

  it("an empty library derives nothing", () => {
    expect(deriveLibrary([], null)).toEqual([]);
  });
});
