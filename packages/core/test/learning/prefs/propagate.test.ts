import { describe, expect, it } from "vitest";
import {
  coreIngredients,
  propagateReview,
  type Contribution,
  type ReviewTargetInput,
} from "../../../src/learning/preferences/index.js";
import { FBK4_TABLE, must, round3 } from "./helpers.js";

type Propagate = (target: ReviewTargetInput, signal: number) => Contribution[];

/** Hand-computed FBK-4 expectations for one representative target of every table row. */
const CASES: { name: string; target: ReviewTargetInput; expected: Record<string, number> }[] = [
  {
    name: "dish",
    target: {
      type: "dish",
      dishId: "d1",
      cuisineKey: "levantine",
      eaten: [
        { variantId: "v1", methodKey: "grilled", coreIngredientIds: ["chicken", "lemon"] },
        { variantId: "v2", methodKey: "boiled", coreIngredientIds: ["rice", "chicken"] },
        { variantId: "v3", methodKey: "grilled", coreIngredientIds: ["cucumber"] },
      ],
    },
    // n = 4 distinct core ingredients → 0.15 / 2 = 0.075; methods once each.
    expected: {
      "dish:d1": FBK4_TABLE.dish.dish,
      "cuisine:levantine": FBK4_TABLE.dish.cuisine,
      "method:grilled": FBK4_TABLE.dish.method,
      "method:boiled": FBK4_TABLE.dish.method,
      "ingredient:chicken": 0.075,
      "ingredient:lemon": 0.075,
      "ingredient:rice": 0.075,
      "ingredient:cucumber": 0.075,
    },
  },
  {
    name: "dish with three core ingredients (0.15/√3)",
    target: {
      type: "dish",
      dishId: "d2",
      cuisineKey: "indian",
      eaten: [{ variantId: "v", methodKey: "stewed", coreIngredientIds: ["a", "b", "c"] }],
    },
    expected: {
      "dish:d2": 1,
      "cuisine:indian": 0.3,
      "method:stewed": 0.3,
      "ingredient:a": round3(0.15 / Math.sqrt(3)),
      "ingredient:b": round3(0.15 / Math.sqrt(3)),
      "ingredient:c": round3(0.15 / Math.sqrt(3)),
    },
  },
  {
    name: "variant",
    target: { type: "variant", dishId: "d1", variantId: "v9", methodKey: "deep_fried" },
    expected: {
      "dish:d1#v9": FBK4_TABLE.variant.variant,
      "method:deep_fried": FBK4_TABLE.variant.method,
      "dish:d1": FBK4_TABLE.variant.dish,
    },
  },
  {
    name: "component",
    target: {
      type: "component",
      dishId: "d1",
      variantId: "v2",
      coreIngredientIds: ["rice", "stock"],
    },
    expected: {
      "dish:d1#v2": FBK4_TABLE.component.variant,
      "ingredient:rice": round3(0.2 / Math.sqrt(2)),
      "ingredient:stock": round3(0.2 / Math.sqrt(2)),
    },
  },
  {
    name: "ingredient",
    target: { type: "ingredient", ingredientId: "freekeh" },
    expected: { "ingredient:freekeh": FBK4_TABLE.direct },
  },
  {
    name: "cuisine",
    target: { type: "cuisine", cuisineKey: "italian" },
    expected: { "cuisine:italian": FBK4_TABLE.direct },
  },
  {
    name: "method",
    target: { type: "method", methodKey: "deep_fried" },
    expected: { "method:deep_fried": FBK4_TABLE.direct },
  },
];

/** Every mismatch between a propagation function and the hand-computed FBK-4 table. */
function mismatches(propagate: Propagate): string[] {
  const out: string[] = [];
  for (const c of CASES) {
    for (const signal of [-1, 0.5]) {
      const got = new Map(
        propagate(c.target, signal).map((x) => [`${x.entityType}:${x.entityKey}`, x]),
      );
      for (const [key, weight] of Object.entries(c.expected)) {
        const hit = got.get(key);
        if (hit === undefined) out.push(`${c.name}: ${key} missing`);
        else if (Math.abs(hit.weight - weight) > 1e-9)
          out.push(`${c.name}: ${key} weight ${String(hit.weight)} ≠ ${String(weight)}`);
        else if (hit.signal !== signal) out.push(`${c.name}: ${key} signal ${String(hit.signal)}`);
      }
      for (const key of got.keys())
        if (!(key in c.expected)) out.push(`${c.name}: unexpected key ${key}`);
    }
  }
  return out;
}

describe("G2 FBK-4 propagation weights", () => {
  it("G2 every row of the FBK-4 propagation table matches the hand-computed weights", () => {
    expect(mismatches(propagateReview)).toEqual([]);
  });

  it("each key is reached once per review, with the signal attached", () => {
    const contributions = propagateReview(must(CASES[0]).target, -1);
    const keys = contributions.map((c) => `${c.entityType}:${c.entityKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(contributions.every((c) => c.signal === -1)).toBe(true);
  });

  it("a dish with no eaten variants still updates the dish and the cuisine", () => {
    const got = propagateReview({ type: "dish", dishId: "d", cuisineKey: "thai", eaten: [] }, 1);
    expect(got.map((c) => `${c.entityType}:${c.entityKey}:${String(c.weight)}`)).toEqual([
      "dish:d:1",
      "cuisine:thai:0.3",
    ]);
  });

  it("rejects a signal outside [−1, 1]", () => {
    expect(() => propagateReview({ type: "method", methodKey: "x" }, 1.5)).toThrow(RangeError);
  });

  it("core ingredients exclude herb_spice and water (PLN-9, SPEC-Q-6), each counted once", () => {
    expect(
      coreIngredients([
        { ingredientId: "c", slug: "chicken_breast", category: "poultry" },
        { ingredientId: "s", slug: "salt", category: "herb_spice" },
        { ingredientId: "p", slug: "black-pepper", category: "herb_spice" },
        { ingredientId: "w", slug: "water", category: "beverage" },
        { ingredientId: "o", slug: "olive_oil", category: "oil_fat" },
        { ingredientId: "c", slug: "chicken_breast", category: "poultry" },
      ]),
    ).toEqual(["c", "o"]);
  });

  it("G2 negative control: a propagation with a mutated weight table is detected", () => {
    const mutatedCuisine: Propagate = (target, signal) =>
      propagateReview(target, signal).map((c) =>
        c.entityType === "cuisine" && target.type === "dish" ? { ...c, weight: 0.5 } : c,
      );
    const noSqrt: Propagate = (target, signal) =>
      propagateReview(target, signal).map((c) =>
        c.entityType === "ingredient" && target.type === "dish" ? { ...c, weight: 0.15 } : c,
      );
    const droppedMethod: Propagate = (target, signal) =>
      propagateReview(target, signal).filter(
        (c) => !(target.type === "variant" && c.entityType === "method"),
      );
    for (const bad of [mutatedCuisine, noSqrt, droppedMethod])
      expect(mismatches(bad).length).toBeGreaterThan(0);
  });
});
