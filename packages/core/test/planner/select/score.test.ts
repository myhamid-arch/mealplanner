// PLN-9 scoring (04 §6.1–6.2), SPEC-Q-8 and SPEC-Q-9.
import { describe, expect, it } from "vitest";
import { scoreDish, type ScoreInput } from "../../../src/planner/select/index.js";
import { appealOf, economyOf, macroFitOf, varietyOf } from "../../../src/planner/select/score.js";
import { seedLibrary } from "./support.js";

const dish = () => {
  const d = seedLibrary().dishes.find((x) => x.id === "chicken-shawarma-wrap");
  if (d === undefined) throw new Error("fixture dish missing");
  return d;
};

const weights = {
  macroPrecision: 1,
  appeal: 0.6,
  ingredientEconomy: 0.4,
  variety: 0.3,
  fairness: 0.5,
};

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    dish: dish(),
    plates: [
      { memberId: "a", targeted: true, fit: 0.8, appeal: 0.2 },
      { memberId: "b", targeted: true, fit: 0.6, appeal: -0.4 },
      { memberId: "c", targeted: false, fit: 1, appeal: 0.6 },
    ],
    ingredients: ["x", "y", "z", "w"],
    variantsPerComponent: { c1: 1, c2: 2 },
    mainProtein: "x",
    window: { ingredients: new Set(["x", "y", "q"]), cuisineMealDays: 0 },
    previous: null,
    weights,
    ...over,
  };
}

describe("MacroFit", () => {
  it("is the mean fit of targeted plates, untargeted ones ignored", () => {
    expect(macroFitOf(input().plates)).toBeCloseTo(0.7, 12);
  });
  it("is 1 with no targeted attendee", () => {
    expect(macroFitOf([{ memberId: "c", targeted: false, fit: 0.2, appeal: 0 }])).toBe(1);
  });
});

describe("Appeal", () => {
  it("mixes mean and minimum by fairness and rescales [−1, 1] to [0, 1]", () => {
    const plates = input().plates;
    const mean = (0.2 - 0.4 + 0.6) / 3;
    expect(appealOf(plates, 0.5)).toBeCloseTo((0.5 * mean + 0.5 * -0.4 + 1) / 2, 12);
    expect(appealOf(plates, 0)).toBeCloseTo((mean + 1) / 2, 12);
    expect(appealOf(plates, 1)).toBeCloseTo((-0.4 + 1) / 2, 12);
  });
});

describe("Economy", () => {
  it("is (|I∩W| − 1.5|I∖W|)/|I| rescaled from [−1.5, 1] to [0, 1]", () => {
    const e = economyOf(["x", "y", "z", "w"], new Set(["x", "y"]), {});
    expect(e.value).toBeCloseTo(((2 - 1.5 * 2) / 4 + 1.5) / 2.5, 12);
    expect(e.reused).toEqual(["x", "y"]);
    expect(e.added).toEqual(["z", "w"]);
  });
  it("is 1 when every ingredient is reused and 0 when none is", () => {
    expect(economyOf(["x"], new Set(["x"]), {}).value).toBe(1);
    expect(economyOf(["x", "y"], new Set(), {}).value).toBe(0);
  });
  it("subtracts 0.05 per variant of a component beyond 2 (SPEC-Q-8), floored at 0", () => {
    const base = economyOf(["x", "y"], new Set(["x"]), { c1: 2, c2: 1 }).value;
    const three = economyOf(["x", "y"], new Set(["x"]), { c1: 3, c2: 3 });
    expect(three.kitchenPenalty).toBeCloseTo(0.1, 12);
    expect(three.value).toBeCloseTo(base - 0.1, 12);
    expect(economyOf(["x", "y"], new Set(), { c1: 3 }).value).toBe(0);
  });
});

describe("Variety", () => {
  const d = dish();
  it("penalises the previous meal's cuisine, a third time in the window and the same main protein", () => {
    const none = varietyOf({
      dish: d,
      mainProtein: "x",
      window: { ingredients: new Set(), cuisineMealDays: 1 },
      previous: null,
    });
    expect(none.value).toBe(1);
    const all = varietyOf({
      dish: d,
      mainProtein: "x",
      window: { ingredients: new Set(), cuisineMealDays: 2 },
      previous: { cuisineKey: d.cuisineKey, mainProtein: "x", dishName: "Other" },
    });
    expect(all.value).toBeCloseTo(1 - 0.3 - 0.3 - 0.2, 12);
    expect(all.penalties).toHaveLength(3);
  });
  it("does not penalise a different cuisine or protein", () => {
    const v = varietyOf({
      dish: d,
      mainProtein: "x",
      window: { ingredients: new Set(), cuisineMealDays: 0 },
      previous: { cuisineKey: "not-" + d.cuisineKey, mainProtein: "y", dishName: "Other" },
    });
    expect(v.value).toBe(1);
  });
});

describe("scoreDish", () => {
  it("is the weighted mean of the four components (PLN-9 §6.2)", () => {
    const i = input();
    const s = scoreDish(i);
    const expected =
      (1 * macroFitOf(i.plates) +
        0.6 * appealOf(i.plates, 0.5) +
        0.4 * economyOf(i.ingredients, i.window.ingredients, i.variantsPerComponent).value +
        0.3 * 1) /
      2.3;
    expect(s.total).toBeCloseTo(expected, 12);
    expect(s.reasons.some((r) => r.startsWith("Reuses x, y"))).toBe(true);
  });
  it("gives more total to a more economical dish only through the economy weight", () => {
    const reuse = input({
      window: { ingredients: new Set(["x", "y", "z", "w"]), cuisineMealDays: 0 },
    });
    const fresh = input({ window: { ingredients: new Set(), cuisineMealDays: 0 } });
    expect(scoreDish(reuse).total).toBeGreaterThan(scoreDish(fresh).total);
    const off = { ...weights, ingredientEconomy: 0 };
    expect(scoreDish({ ...reuse, weights: off }).total).toBeCloseTo(
      scoreDish({ ...fresh, weights: off }).total,
      12,
    );
  });
  it("is 0 when every weight is 0", () => {
    const zero = { macroPrecision: 0, appeal: 0, ingredientEconomy: 0, variety: 0, fairness: 0 };
    expect(scoreDish(input({ weights: zero })).total).toBe(0);
  });
});
