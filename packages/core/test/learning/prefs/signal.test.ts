import { describe, expect, it } from "vitest";
import { reviewSignal } from "../../../src/learning/preferences/index.js";

describe("FBK-4 review signal", () => {
  it("s = (rating − 3) / 2 for ratings 1 to 5", () => {
    expect([1, 2, 3, 4, 5].map((r) => reviewSignal(r, []))).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it("loved_it adds +1, tasty +0.5, each negative taste tag −0.5, capped at −1 in total", () => {
    expect(reviewSignal(3, ["loved_it"])).toBe(1);
    expect(reviewSignal(3, ["tasty"])).toBe(0.5);
    expect(reviewSignal(3, ["dry"])).toBe(-0.5);
    expect(reviewSignal(3, ["dry", "bland"])).toBe(-1);
    expect(reviewSignal(4, ["dry", "bland", "too_salty", "soggy"])).toBe(-0.5); // 0.5 + cap −1
    expect(reviewSignal(2, ["tasty", "too_oily"])).toBe(-0.5); // −0.5 + 0.5 − 0.5
  });

  it("clamps the sum to [−1, 1] and counts a repeated tag once", () => {
    expect(reviewSignal(5, ["loved_it", "tasty"])).toBe(1);
    expect(reviewSignal(1, ["dry", "bland"])).toBe(-1);
    expect(reviewSignal(3, ["tasty", "tasty"])).toBe(0.5);
  });

  it("without a rating the tags alone are the signal; no rating and no taste tag is no signal", () => {
    expect(reviewSignal(null, ["loved_it"])).toBe(1);
    expect(reviewSignal(null, ["too_spicy"])).toBe(-0.5);
    expect(reviewSignal(null, [])).toBeNull();
    expect(reviewSignal(null, ["too_much", "more_often", "my_custom_tag"])).toBeNull();
  });

  it("quantity, frequency, practical, kitchen and custom tags carry no appeal signal", () => {
    expect(
      reviewSignal(3, [
        "too_much",
        "still_hungry",
        "more_often",
        "hard_to_pack",
        "recipe_unclear",
        "x",
      ]),
    ).toBe(0);
  });

  it("rejects a rating outside 1–5", () => {
    expect(() => reviewSignal(0, [])).toThrow(RangeError);
    expect(() => reviewSignal(6, [])).toThrow(RangeError);
    expect(() => reviewSignal(2.5, [])).toThrow(RangeError);
  });
});
