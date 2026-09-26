import { describe, expect, it } from "vitest";
import {
  PreferenceIndex,
  evaluateAppeal,
  resolveScore,
  variantKey,
  type AppealPlate,
} from "../../../src/learning/preferences/index.js";
import { pref } from "./helpers.js";

const plate: AppealPlate = {
  dishId: "d1",
  cuisineKey: "levantine",
  variants: [
    { variantId: "v1", methodKey: "grilled", coreIngredientIds: ["chicken", "lemon"] },
    { variantId: "v2", methodKey: "boiled", coreIngredientIds: ["rice"] },
  ],
};

describe("FBK-4 score resolution", () => {
  it("member-level value where it exists, otherwise household-level, otherwise 0", () => {
    const rows = [
      pref({ memberId: null, entityType: "cuisine", entityKey: "levantine", score: 0.5 }),
      pref({
        memberId: "m1",
        entityType: "cuisine",
        entityKey: "levantine",
        score: -0.2,
        source: "learned",
      }),
    ];
    expect(resolveScore(rows, "m1", "cuisine", "levantine")).toBe(-0.2);
    expect(resolveScore(rows, "m2", "cuisine", "levantine")).toBe(0.5);
    expect(resolveScore(rows, "m2", "cuisine", "thai")).toBe(0);
    expect(resolveScore(rows, null, "cuisine", "levantine")).toBe(0.5);
  });

  it("admin-set preferences override learned ones: locked, then explicit, proposal, learned (SPEC-Q-8)", () => {
    const learned = pref({
      memberId: "m1",
      entityType: "dish",
      entityKey: "d1",
      score: -0.5,
      source: "learned",
    });
    const proposal = pref({
      memberId: "m1",
      entityType: "dish",
      entityKey: "d1",
      score: 0.1,
      source: "proposal",
    });
    const explicit = pref({
      memberId: "m1",
      entityType: "dish",
      entityKey: "d1",
      score: 0.4,
      source: "explicit",
    });
    expect(resolveScore([learned], "m1", "dish", "d1")).toBe(-0.5);
    expect(resolveScore([learned, proposal], "m1", "dish", "d1")).toBe(0.1);
    expect(resolveScore([explicit, learned, proposal], "m1", "dish", "d1")).toBe(0.4);
    const lockedLearned = { ...learned, locked: true, score: -0.9 };
    expect(resolveScore([explicit, lockedLearned, proposal], "m1", "dish", "d1")).toBe(-0.9);
  });
});

describe("FBK-4 appeal evaluation", () => {
  it("a = 0.35·dish + 0.20·mean(variants) + 0.15·cuisine + 0.10·mean(methods) + 0.15·ingredientTerm + 0.05·kg", () => {
    const rows = [
      pref({ memberId: "m1", entityType: "dish", entityKey: "d1", score: 0.6 }),
      pref({ memberId: "m1", entityType: "dish", entityKey: variantKey("d1", "v1"), score: 0.4 }),
      pref({ memberId: "m1", entityType: "dish", entityKey: variantKey("d1", "v2"), score: -0.2 }),
      pref({ memberId: null, entityType: "cuisine", entityKey: "levantine", score: 0.5 }),
      pref({ memberId: "m1", entityType: "method", entityKey: "grilled", score: 0.3 }),
      pref({ memberId: "m1", entityType: "ingredient", entityKey: "chicken", score: 0.6 }),
      pref({ memberId: "m1", entityType: "ingredient", entityKey: "lemon", score: -0.6 }),
    ];
    const { appeal, terms } = evaluateAppeal(rows, "m1", plate, 0.2);
    // Hand-computed: variants mean 0.1; methods mean (0.3 + 0)/2 = 0.15;
    // ingredients mean (0.6 − 0.6 + 0)/3 = 0, drag 0.5·0.6 = 0.3 → −0.3.
    expect(terms.dish).toBe(0.6);
    expect(terms.variant).toBeCloseTo(0.1, 12);
    expect(terms.cuisine).toBe(0.5);
    expect(terms.method).toBeCloseTo(0.15, 12);
    expect(terms.ingredient).toBeCloseTo(-0.3, 12);
    expect(terms.kgSimilarity).toBe(0.2);
    expect(appeal).toBeCloseTo(
      0.35 * 0.6 + 0.2 * 0.1 + 0.15 * 0.5 + 0.1 * 0.15 + 0.15 * -0.3 + 0.05 * 0.2,
      12,
    );
  });

  it("one disliked ingredient drags hard; liked-only ingredients have no drag", () => {
    const liked = [
      pref({ memberId: "m1", entityType: "ingredient", entityKey: "rice", score: 0.9 }),
    ];
    expect(evaluateAppeal(liked, "m1", plate).terms.ingredient).toBeCloseTo(0.3, 12);
    const disliked = [
      pref({ memberId: "m1", entityType: "ingredient", entityKey: "rice", score: -0.9 }),
    ];
    expect(evaluateAppeal(disliked, "m1", plate).terms.ingredient).toBeCloseTo(-0.3 - 0.45, 12);
  });

  it("is clamped to [−1, 1], is 0 with no preferences, and counts shared methods and ingredients once", () => {
    const all = (score: number) =>
      [
        "dish:d1",
        "dish:d1#v1",
        "dish:d1#v2",
        "cuisine:levantine",
        "method:grilled",
        "method:boiled",
        "ingredient:chicken",
        "ingredient:lemon",
        "ingredient:rice",
      ].map((k) => {
        const [entityType, entityKey] = k.split(/:(.*)/s) as [
          "dish" | "cuisine" | "method" | "ingredient",
          string,
        ];
        return pref({ memberId: "m1", entityType, entityKey, score });
      });
    expect(evaluateAppeal(all(1), "m1", plate, 1).appeal).toBe(1);
    expect(evaluateAppeal(all(-1), "m1", plate, -1).appeal).toBe(-1);
    expect(evaluateAppeal([], "m1", plate).appeal).toBe(0);
    const twice: AppealPlate = {
      ...plate,
      variants: [
        ...plate.variants,
        { variantId: "v1", methodKey: "grilled", coreIngredientIds: ["chicken"] },
      ],
    };
    const rows = [pref({ memberId: "m1", entityType: "method", entityKey: "boiled", score: 1 })];
    expect(evaluateAppeal(rows, "m1", twice).terms.method).toBe(0.5);
  });

  it("accepts a prebuilt index and rejects a kg term outside [−1, 1]", () => {
    const rows = [pref({ memberId: "m1", entityType: "dish", entityKey: "d1", score: 0.6 })];
    expect(evaluateAppeal(new PreferenceIndex(rows), "m1", plate)).toEqual(
      evaluateAppeal(rows, "m1", plate),
    );
    expect(() => evaluateAppeal(rows, "m1", plate, 2)).toThrow(RangeError);
  });
});
