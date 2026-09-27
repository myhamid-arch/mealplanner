import { describe, expect, it } from "vitest";
import {
  addDays,
  carbLabel,
  carbsOn,
  cuisineFamily,
  fibreGoals,
  fitLook,
  fitSummary,
  isIsoDate,
  localDate,
  dayMonth,
  localMinutes,
  mediumDay,
  longDay,
  macroLine,
  macrosOf,
  mondayOf,
  num,
  ratingsByDish,
  satFatCap,
  shortDay,
  sumMacros,
  weekDates,
  weekStats,
  weekdayOf,
} from "./logic";

describe("dates", () => {
  it("local date and minutes follow the household zone", () => {
    const at = new Date("2026-09-27T21:30:00Z");
    expect(localDate(at, "Asia/Dubai")).toBe("2026-09-28");
    expect(localDate(at, "UTC")).toBe("2026-09-27");
    expect(localMinutes(at, "Asia/Dubai")).toBe(90);
    expect(localDate(at, "Not/AZone")).toBe("2026-09-27");
  });
  it("weeks start on Monday (R-24)", () => {
    expect(weekdayOf("2026-09-28")).toBe(0);
    expect(weekdayOf("2026-09-27")).toBe(6);
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
    expect(weekDates("2026-09-28")).toHaveLength(7);
    expect(weekDates("2026-09-28")[6]).toBe("2026-10-04");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("formats like the mockups", () => {
    expect(longDay("2026-09-27")).toBe("Sunday 27 September");
    expect(shortDay("2026-09-28")).toBe("Mon 28");
    expect(mediumDay("2026-09-27")).toBe("Sunday 27 Sep");
    expect(dayMonth("2026-09-21")).toBe("21 Sep");
  });
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("tomorrow")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("macros (R-20, R-28)", () => {
  const n = { kcal: 523.4, protein: 43.2, carbs: 41, fat: 16.8, fibre: 6 };
  it("carbs are total unless the basis says available", () => {
    expect(carbsOn(n)).toBe(47);
    expect(carbsOn(n, "total")).toBe(47);
    expect(carbsOn(n, "available")).toBe(41);
    expect(carbLabel()).toBe("Carbs g (total)");
    expect(carbLabel("available")).toBe("Carbs g (available)");
  });
  it("sums and prints a macro line", () => {
    const m = sumMacros([macrosOf(n), macrosOf(n)]);
    expect(m.carbs).toBe(94);
    expect(macroLine(macrosOf(n))).toBe("523 kcal · P43 C47 F17");
    expect(num(3.24)).toBe("3.2");
    expect(num(12.6)).toBe("13");
  });
  it("sat-fat cap defaults to 6 % of energy; fibre to 14 g / 1,000 kcal, a quarter soluble", () => {
    expect(satFatCap(1800, null)).toBeCloseTo(12, 5);
    expect(satFatCap(1800, 18)).toBe(18);
    expect(fibreGoals(2000, { fibreMinG: null, solubleFibreMinG: null })).toEqual({
      fibre: 28,
      soluble: 7,
    });
    expect(fibreGoals(2000, { fibreMinG: 30, solubleFibreMinG: 10 })).toEqual({
      fibre: 30,
      soluble: 10,
    });
  });
});

describe("fit", () => {
  it("every status has text and an icon (UX-6)", () => {
    for (const s of ["in_tolerance", "flexible_miss", "infeasible", "untargeted"] as const) {
      expect(fitLook(s).label.length).toBeGreaterThan(0);
      expect(fitLook(s).icon.length).toBeGreaterThan(0);
    }
  });
  it("summarises targeted plates only", () => {
    expect(fitSummary(["in_tolerance", "in_tolerance", "untargeted"]).text).toBe(
      "All 2 targeted meals on target",
    );
    const miss = fitSummary(["in_tolerance", "infeasible", "untargeted"]);
    expect(miss.text).toBe("1 of 2 targeted meals off target");
    expect(miss.tone).toBe("pomegranate");
    expect(fitSummary(["untargeted"]).targeted).toBe(0);
  });
});

describe("week stats and cuisines", () => {
  it("counts distinct raw ingredients, cuisines and targeted plates on target", () => {
    const sheets = [
      {
        meals: [
          {
            cuisineKey: "levantine",
            batches: [
              {
                raw: [
                  { ingredientId: "a", rawG: 100 },
                  { ingredientId: "b", rawG: 5 },
                ],
              },
            ],
          },
          { cuisineKey: "italian", batches: [{ raw: [{ ingredientId: "a", rawG: 30 }] }] },
        ],
      },
      {
        meals: [{ cuisineKey: "levantine", batches: [{ raw: [{ ingredientId: "c", rawG: 0 }] }] }],
      },
    ];
    expect(weekStats(sheets, ["in_tolerance", "flexible_miss", "untargeted"])).toEqual({
      distinctIngredients: 2,
      targeted: 2,
      onTarget: 1,
      onTargetPct: 50,
      cuisines: 2,
    });
    expect(weekStats([], []).onTargetPct).toBeNull();
  });
  it("maps every catalogue cuisine to a family", () => {
    expect(cuisineFamily("emirati_gulf").family).toBe("Levantine & Gulf");
    expect(cuisineFamily("pakistani").tone).toBe("saffron");
    expect(cuisineFamily("unknown").family).toBe("Other");
  });
});

describe("ratings (SPEC-Q-11)", () => {
  it("averages top-level ratings per dish, skipping replies and unmapped targets", () => {
    const reviews = [
      { targetType: "dish", targetId: "d1", planMealId: null, rating: 5, parentReviewId: null },
      {
        targetType: "plan_meal",
        targetId: "m1",
        planMealId: "m1",
        rating: 4,
        parentReviewId: null,
      },
      { targetType: "dish", targetId: "d1", planMealId: null, rating: 1, parentReviewId: "r" },
      { targetType: "dish", targetId: "d1", planMealId: null, rating: null, parentReviewId: null },
      { targetType: "cuisine", targetId: "x", planMealId: null, rating: 2, parentReviewId: null },
    ];
    const map = ratingsByDish(reviews, (type, id) =>
      type === "dish" ? id : type === "plan_meal" && id === "m1" ? "d1" : null,
    );
    expect(map.get("d1")).toEqual({ mean: 4.5, count: 2 });
    expect(map.size).toBe(1);
  });
});
