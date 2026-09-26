// SC-3 on the pure model: two 1★ dish reviews by one member, measured through the FBK-4 appeal of
// that member's plate (R-26: dish score drop ≥ 0.3, appeal drop > 0, other members unchanged).
import { describe, expect, it } from "vitest";
import {
  evaluateAppeal,
  learningPreferenceOps,
  propagateReview,
  resolveScore,
  reviewSignal,
  type AppealPlate,
  type ReviewTargetInput,
} from "../../../src/learning/preferences/index.js";
import type { PreferenceRow } from "../../../src/types/index.js";
import { applyPreferenceSets, pref } from "./helpers.js";

const MEMBERS = ["a", "b", "c1", "c2", "c3"];
const plate: AppealPlate = {
  dishId: "dish-1",
  cuisineKey: "levantine",
  variants: [
    {
      variantId: "grilled",
      methodKey: "grilled",
      coreIngredientIds: ["chicken", "lemon", "garlic", "oil"],
    },
    { variantId: "rice", methodKey: "boiled", coreIngredientIds: ["rice"] },
  ],
};
const target: ReviewTargetInput = {
  type: "dish",
  dishId: plate.dishId,
  cuisineKey: plate.cuisineKey,
  eaten: plate.variants,
};

type Learner = (rows: PreferenceRow[], memberId: string, rating: number) => PreferenceRow[];

const realLearner: Learner = (rows, memberId, rating) => {
  const signal = reviewSignal(rating, []);
  if (signal === null) return rows;
  return applyPreferenceSets(
    rows,
    learningPreferenceOps(memberId, propagateReview(target, signal), rows),
  );
};

function measure(learner: Learner, start: PreferenceRow[]) {
  const before = new Map(MEMBERS.map((m) => [m, evaluateAppeal(start, m, plate).appeal]));
  const dishBefore = resolveScore(start, "a", "dish", plate.dishId);
  let rows = start;
  rows = learner(rows, "a", 1);
  rows = learner(rows, "a", 1);
  const after = new Map(MEMBERS.map((m) => [m, evaluateAppeal(rows, m, plate).appeal]));
  const othersRows = (r: PreferenceRow[]) => JSON.stringify(r.filter((x) => x.memberId !== "a"));
  return {
    dishScoreDrop: dishBefore - resolveScore(rows, "a", "dish", plate.dishId),
    appealDrop: (before.get("a") ?? 0) - (after.get("a") ?? 0),
    othersUnchanged:
      MEMBERS.filter((m) => m !== "a").every((m) => before.get(m) === after.get(m)) &&
      othersRows(start) === othersRows(rows),
  };
}

function sc3Holds(m: ReturnType<typeof measure>): boolean {
  return m.dishScoreDrop >= 0.3 && m.appealDrop > 0 && m.othersUnchanged;
}

const likedLevantine = () => [
  pref({ memberId: null, entityType: "cuisine", entityKey: "levantine", score: 0.5 }),
];

describe("G1 SC-3 on the pure preference model", () => {
  it("G1 two 1★ reviews lower the member's dish score by ≥ 0.3 and plate appeal by > 0; others unchanged", () => {
    for (const start of [[], likedLevantine()]) {
      const m = measure(realLearner, start);
      expect(m.dishScoreDrop).toBeCloseTo(0.5, 3);
      expect(m.appealDrop).toBeGreaterThan(0);
      expect(m.othersUnchanged).toBe(true);
      expect(sc3Holds(m)).toBe(true);
    }
  });

  it("G1 the appeal drop matches the hand-computed FBK-4 value (SPEC-Q-1)", () => {
    // Closed form after two 1★ reviews: dish −2/4; cuisine and each method −0.6/2.6; five core
    // ingredients at w = 0.15/√5 per review: −2w/(2w + 2), and the dislike drag adds half again.
    const w = 0.15 / Math.sqrt(5);
    const ing = (-2 * w) / (2 * w + 2);
    const expected =
      0.35 * 0.5 + 0.15 * (0.6 / 2.6) + 0.1 * (0.6 / 2.6) + 0.15 * -(ing + 0.5 * ing);
    // Stored values are 3-decimal (numeric(10,3)); two incremental steps stay within 0.001.
    expect(Math.abs(measure(realLearner, []).appealDrop - expected)).toBeLessThan(0.001);
    expect(expected).toBeLessThan(0.3); // why R-26 asserts a drop > 0 rather than ≥ 0.3
  });

  it("G1 negative control: a learner that writes to the wrong member, or writes nothing, fails SC-3", () => {
    const wrongMember: Learner = (rows, _memberId, rating) => realLearner(rows, "b", rating);
    const nothing: Learner = (rows) => rows;
    expect(sc3Holds(measure(wrongMember, []))).toBe(false);
    expect(sc3Holds(measure(nothing, []))).toBe(false);
  });
});
