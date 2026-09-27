// G3 unit tests of the R2-DL logic: automatic shares, the rebalance of R2-DL-4, and the "yours"
// inference of SPEC-Q-15 including its ambiguous case (R-47).
import { describe, expect, it } from "vitest";
import { autoShares, inferYours, rebalance } from "./logic";

const DAY = ["breakfast", "lunch", "dinner", "snack"];
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("G3 R2-DL logic", () => {
  it("G3 automatic shares follow the PLN-2 weights and sum to 1", () => {
    const a = autoShares(DAY);
    expect(Math.round((a.breakfast ?? 0) * 100)).toBe(26);
    expect(Math.round((a.lunch ?? 0) * 100)).toBe(32);
    expect(Math.round((a.dinner ?? 0) * 100)).toBe(32);
    expect(Math.round((a.snack ?? 0) * 100)).toBe(11);
    expect(sum(a)).toBeCloseTo(1, 9);
  });

  it("G3 one value set: it is kept, the others rebalance in proportion, the day sums to 100 %", () => {
    const auto = autoShares(DAY);
    const split = rebalance(auto, { lunch: 0.36 });
    expect(split.lunch).toBe(0.36);
    expect(sum(split)).toBeCloseTo(1, 9);
    // Siblings keep their automatic proportions.
    expect((split.breakfast ?? 0) / (split.dinner ?? 1)).toBeCloseTo(
      (auto.breakfast ?? 0) / (auto.dinner ?? 1),
      3,
    );
    expect(inferYours(split, auto)).toEqual(new Set(["lunch"]));
  });

  it("G3 two values set of five slots are recovered", () => {
    const keys = [...DAY, "pre_workout"];
    const auto = autoShares(keys);
    const split = rebalance(auto, { lunch: 0.4, snack: 0.05 });
    expect(sum(split)).toBeCloseTo(1, 9);
    expect(inferYours(split, auto)).toEqual(new Set(["lunch", "snack"]));
  });

  it("G3 ambiguous: as many user values as siblings (2 of 4) shows every value as yours", () => {
    const auto = autoShares(DAY);
    const split = rebalance(auto, { lunch: 0.4, snack: 0.05 });
    expect(inferYours(split, auto)).toEqual(new Set(DAY));
  });

  it("G3 a stored split equal to the automatic one has no user values", () => {
    const auto = autoShares(DAY);
    expect(inferYours(rebalance(auto, {}), auto)).toEqual(new Set());
  });

  it("G3 negative control: an inference that ignored the ratios would miss the user's value", () => {
    const auto = autoShares(DAY);
    const split = rebalance(auto, { lunch: 0.36 });
    const naive = new Set(
      Object.keys(split).filter((k) => Math.abs((split[k] ?? 0) - (auto[k] ?? 0)) < 1e-9),
    );
    // Every rebalanced sibling differs from its automatic share, so "differs from auto" is not "yours".
    expect(naive.size).toBe(0);
    expect(inferYours(split, auto).size).toBe(1);
  });

  it("G3 more than 100 % of set values is refused", () => {
    expect(() => rebalance(autoShares(DAY), { lunch: 0.7, dinner: 0.5 })).toThrow(/100 %/);
  });
});
