// Unit tests for KG-4.1 similarity (R-35 core-ingredient vector), explanations, FBK-4
// kgSimilarityTerm, KG-4.3 substitute ranking and the substitutes CSV reader.
import type { ExclusionRow } from "@mealplanner/core/types";
import { describe, expect, it } from "vitest";
import {
  dishFeatures,
  dishSimilarity,
  kgSimilarityTerm,
  rankSimilar,
  similarityTerms,
  similarityWhy,
  type VariantFeature,
} from "../src/similarity/index.js";
import { isExcluded, macroDistance, rankSubstitutes } from "../src/store/index.js";
import { parseSubstitutesCsv } from "../src/sync/substitutes-csv.js";
import type { KgNeighbour } from "../src/types/index.js";

const item = (
  id: string,
  rawG: number,
  category: VariantFeature["items"][number]["category"] = "vegetable",
  slug = id,
) => ({
  ingredientId: id,
  label: id.toUpperCase(),
  slug,
  category,
  rawG,
});

const variant = (
  id: string,
  component: string,
  method: string,
  items: VariantFeature["items"],
): VariantFeature => ({
  variantId: id,
  componentId: component,
  method: { key: method, label: method },
  items,
});

describe("dish features", () => {
  it("uses core ingredients only (no herb_spice, no water) and averages variants, then components", () => {
    const f = dishFeatures({
      dishId: "d",
      cuisines: [],
      flavourTags: [],
      variants: [
        // component A, two variants: {x: 1} and {x: 0.5, y: 0.5} → mean {x: 0.75, y: 0.25}
        variant("v1", "A", "grilled", [
          item("x", 100),
          item("salt", 5, "herb_spice"),
          item("water", 500, "beverage", "water"),
        ]),
        variant("v2", "A", "fried", [item("x", 50), item("y", 50)]),
        // component B: {z: 1}
        variant("v3", "B", "raw", [item("z", 30), item("cumin", 3, "herb_spice")]),
        // component C holds only a spice: no vector, not counted
        variant("v4", "C", "raw", [item("sumac", 10, "herb_spice")]),
      ],
    });
    expect(Object.fromEntries(f.ingredients)).toEqual({ x: 0.375, y: 0.125, z: 0.5 });
    expect([...f.methods.keys()].sort()).toEqual(["fried", "grilled", "raw"]);
  });

  it("sim = 0.6·J + 0.2·C + 0.1·M + 0.1·F, matching a hand computation", () => {
    const a = dishFeatures({
      dishId: "a",
      cuisines: [
        { key: "levantine", label: "Levantine", weight: 1 },
        { key: "greek", label: "Greek", weight: 0.5 },
      ],
      flavourTags: ["smoky", "fresh"],
      variants: [variant("va", "A", "grilled", [item("x", 60), item("y", 40)])],
    });
    const b = dishFeatures({
      dishId: "b",
      cuisines: [{ key: "greek", label: "Greek", weight: 1 }],
      flavourTags: ["smoky"],
      variants: [
        variant("vb", "B", "roasted", [item("x", 30), item("z", 70)]),
        variant("vc", "C", "grilled", [item("y", 10)]),
      ],
    });
    // a = {x .6, y .4}; b = mean of {x .3, z .7} and {y 1} = {x .15, z .35, y .5}
    // J = (min .15 + .4 + 0) / (max .6 + .5 + .35) = .55 / 1.45
    const t = similarityTerms(a, b);
    expect(t.ingredients).toBeCloseTo(0.55 / 1.45, 12);
    expect(t.cuisine).toBe(0.5); // greek: min(0.5, 1)
    expect(t.methods).toBeCloseTo(1 / 2, 12); // {grilled} ∩ / {grilled, roasted}
    expect(t.flavours).toBeCloseTo(1 / 2, 12);
    expect(dishSimilarity(a, b)).toBe(
      Math.round((0.6 * (0.55 / 1.45) + 0.2 * 0.5 + 0.05 + 0.05) * 10000) / 10000,
    );
    expect(dishSimilarity(a, b)).toBe(dishSimilarity(b, a));
    expect(similarityWhy(a, b)).toEqual([
      "shares Y; X",
      "same cuisine: Greek",
      "same method: grilled",
      "shared flavour: smoky",
    ]);
    expect(dishSimilarity(a, a)).toBe(1);
  });

  it("rankSimilar puts the near-duplicate first, drops sim 0 and the dish itself, breaks ties by id", () => {
    const base = {
      cuisines: [{ key: "levantine", label: "Levantine", weight: 1 }],
      flavourTags: [],
    };
    const target = dishFeatures({
      ...base,
      dishId: "t",
      variants: [variant("1", "A", "grilled", [item("x", 50), item("y", 50)])],
    });
    const near = dishFeatures({
      ...base,
      dishId: "n",
      variants: [variant("2", "A", "grilled", [item("x", 50), item("y", 45), item("w", 5)])],
    });
    const far = dishFeatures({
      ...base,
      dishId: "f",
      variants: [variant("3", "A", "boiled", [item("x", 10), item("q", 90)])],
    });
    const twinA = dishFeatures({
      dishId: "b2",
      cuisines: [],
      flavourTags: [],
      variants: [variant("4", "A", "raw", [item("y", 1)])],
    });
    const twinB = dishFeatures({
      dishId: "b1",
      cuisines: [],
      flavourTags: [],
      variants: [variant("5", "A", "raw", [item("y", 1)])],
    });
    const none = dishFeatures({
      dishId: "z",
      cuisines: [],
      flavourTags: [],
      variants: [variant("6", "A", "raw", [item("k", 1)])],
    });
    const ranked = rankSimilar(target, [far, twinA, target, near, twinB, none], 10);
    expect(ranked.map((r) => r.dishId)).toEqual(["n", "f", "b1", "b2"]);
    expect(ranked[0]?.why[0]).toBe("shares X; Y");
    expect(rankSimilar(target, [far, near], 1).map((r) => r.dishId)).toEqual(["n"]);
  });
});

describe("kgSimilarityTerm (FBK-4)", () => {
  it("is the sim-weighted mean of the member's scores over the 10 most similar scored dishes", () => {
    const similar = Array.from({ length: 12 }, (_, i) => ({
      dishId: `d${String(i)}`,
      sim: 1 - i * 0.05,
    }));
    const scores = new Map(similar.map((s, i) => [s.dishId, i < 10 ? 0.5 : -1]));
    scores.delete("d0");
    // d0 has no score: the top 10 scored are d1…d10; d10 scores −1.
    const top = similar.slice(1, 11);
    const expected =
      top.reduce((s, d) => s + d.sim * (scores.get(d.dishId) ?? 0), 0) /
      top.reduce((s, d) => s + d.sim, 0);
    expect(kgSimilarityTerm(similar, scores)).toBeCloseTo(expected, 12);
  });

  it("is 0 without any scored similar dish", () => {
    expect(kgSimilarityTerm([{ dishId: "a", sim: 0.4 }], new Map())).toBe(0);
    expect(kgSimilarityTerm([], new Map([["a", 1]]))).toBe(0);
  });
});

describe("substitutes (KG-4.3; SPEC-Q-2, SPEC-Q-3, R-36)", () => {
  const delta = (p: number, c: number, f: number) => ({
    kcal: 0,
    protein: p,
    carbs: c,
    fat: f,
    satFat: 0,
    fibre: 0,
    solubleFibre: null,
    sugar: null,
    sodiumMg: null,
  });
  const neighbour = (
    key: string,
    weight: number,
    d: ReturnType<typeof delta>,
    props: Record<string, unknown>,
  ): KgNeighbour => ({
    nodeId: `n-${key}`,
    householdId: null,
    type: "Ingredient",
    key,
    label: key,
    props: { slug: key, category: "poultry", dietaryFlags: [], ...props },
    weight,
    edgeHouseholdId: null,
    edgeProps: { macroDelta: d },
    source: "seed",
  });
  const exclusion = (kind: ExclusionRow["kind"], key: string, householdId = "h"): ExclusionRow => ({
    id: key,
    householdId,
    memberId: "m",
    kind,
    key,
    reason: "dislike",
    hard: false,
  });

  const candidates = [
    neighbour("a", 0.8, delta(5, 0, 0), {}),
    neighbour("b", 0.9, delta(10, 10, 10), {}),
    neighbour("c", 0.8, delta(1, 1, 1), { category: "fish", dietaryFlags: ["contains_fish"] }),
    neighbour("d", 0.8, delta(-1, 1, -1), { category: "red_meat" }),
  ];

  it("orders by weight desc, then |ΔP|+|ΔC|+|ΔF| asc, then id", () => {
    expect(rankSubstitutes(candidates, [], "h", 10).map((s) => s.ingredientId)).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
    expect(macroDistance(delta(-1, 2, -3))).toBe(6);
    expect(rankSubstitutes(candidates, [], "h", 2).map((s) => s.ingredientId)).toEqual(["b", "c"]);
  });

  it("drops candidates hit by an ingredient (slug or id), category or dietary-flag exclusion of the household", () => {
    const got = (rows: ExclusionRow[]) =>
      rankSubstitutes(candidates, rows, "h", 10).map((s) => s.ingredientId);
    expect(got([exclusion("ingredient", "b")])).toEqual(["c", "d", "a"]);
    expect(got([exclusion("category", "poultry")])).toEqual(["c", "d"]);
    expect(got([exclusion("dietary_flag", "contains_fish")])).toEqual(["b", "d", "a"]);
    // another household's exclusion does not apply
    expect(got([exclusion("category", "poultry", "other")])).toEqual(["b", "c", "d", "a"]);
  });

  it("isExcluded matches an ingredient key by slug or id", () => {
    const c = {
      id: "0190-uuid",
      slug: "tahini",
      category: "nut_seed",
      dietaryFlags: ["contains_sesame"],
    };
    expect(isExcluded(c, [{ kind: "ingredient", key: "tahini" }])).toBe(true);
    expect(isExcluded(c, [{ kind: "ingredient", key: "0190-uuid" }])).toBe(true);
    expect(isExcluded(c, [{ kind: "ingredient", key: "hummus" }])).toBe(false);
    expect(isExcluded(c, [{ kind: "dietary_flag", key: "contains_sesame" }])).toBe(true);
  });
});

describe("substitutes CSV", () => {
  it("parses the header and rows, including quoted fields", () => {
    const rows = parseSubstitutesCsv(
      'from_slug,to_slug,weight,context,note\na,b,0.9,"x, y","say ""hi"""\n',
    );
    expect(rows).toEqual([
      { fromSlug: "a", toSlug: "b", weight: 0.9, context: "x, y", note: 'say "hi"' },
    ]);
  });

  it("rejects a wrong header, a short row and a bad weight", () => {
    expect(() => parseSubstitutesCsv("a,b\n")).toThrow(/header/);
    expect(() => parseSubstitutesCsv("from_slug,to_slug,weight,context,note\na,b,0.9\n")).toThrow(
      /5 fields/,
    );
    expect(() => parseSubstitutesCsv("from_slug,to_slug,weight,context,note\na,b,x,c,n\n")).toThrow(
      /invalid/,
    );
  });
});
