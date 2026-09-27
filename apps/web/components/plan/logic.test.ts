import { describe, expect, it } from "vitest";
import {
  addDays,
  moveOptions,
  unmovable,
  type MovableMeal,
  type MoveDay,
  dayTarget,
  dayKindOf,
  dayProfile,
  profileMacros,
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

describe("the day's target (R-28, CP3 finding 1)", () => {
  const profile = (kind: string, kcal: number, carbsG: number) => ({
    memberId: "omar",
    kind,
    kcal,
    proteinG: 180,
    carbsG,
    fatG: 70,
    satFatMaxG: 22,
    fibreMinG: null,
    solubleFibreMinG: null,
  });
  const profiles = [profile("default", 2150, 200), profile("training", 2390, 260)];
  // F1: Omar trains Mon/Wed/Fri (weekday 0/2/4); 2026-09-28 is a Monday.
  const f1 = {
    training: [0, 2, 4].map((weekday) => ({ memberId: "omar", weekday })),
    dayOverrides: [],
  };
  it("F1: Omar's rest day is 2150 kcal and his training day 2390, whatever the slot targets sum to", () => {
    const slotSum = { kcal: 2146, protein: 179, carbs: 199, fat: 70 };
    expect(dayProfile(profiles, "omar", "2026-09-27", f1, slotSum)?.kcal).toBe(2150);
    expect(dayProfile(profiles, "omar", "2026-09-28", f1, slotSum)?.kcal).toBe(2390);
    expect(dayProfile(profiles, "omar", "2026-09-29", f1, null)?.kcal).toBe(2150);
    expect(dayProfile(profiles, "omar", "2026-09-30", f1, null)?.kcal).toBe(2390);
  });
  it("day overrides win over the schedule, as in the resolver", () => {
    const s = {
      training: f1.training,
      dayOverrides: [
        { memberId: "omar", date: "2026-09-28", kind: "rest" },
        { memberId: "omar", date: "2026-09-27", kind: "training" },
      ],
    };
    expect(dayKindOf(s, "omar", "2026-09-28")).toBe("default");
    expect(dayKindOf(s, "omar", "2026-09-27")).toBe("training");
  });
  it("without schedules, the profile nearest the slot targets; one profile is used every day", () => {
    expect(
      dayProfile(profiles, "omar", "2026-09-28", null, {
        kcal: 2386,
        protein: 179,
        carbs: 258,
        fat: 70,
      })?.kind,
    ).toBe("training");
    expect(
      dayProfile(profiles, "omar", "2026-09-28", null, {
        kcal: 2146,
        protein: 179,
        carbs: 199,
        fat: 70,
      })?.kind,
    ).toBe("default");
    expect(
      dayProfile([profile("default", 2150, 200)], "omar", "2026-09-28", null, {
        kcal: 2390,
        protein: 1,
        carbs: 1,
        fat: 1,
      })?.kcal,
    ).toBe(2150);
    expect(dayProfile(profiles, "sara", "2026-09-28", f1, null)).toBeNull();
  });
  it("negative control: summing slot targets is not the day target", () => {
    const slotSum = { kcal: 2146, protein: 179, carbs: 199, fat: 70 };
    expect(slotSum.kcal).not.toBe(profileMacros(profiles[0] ?? profile("default", 0, 0)).kcal);
  });
});

// Leaf 1.4.8 G3 (W-7, BLD-8 R-58/R-60) ---------------------------------------------------------------
describe("W-7: the day target on Plan and Plate", () => {
  const profile = (kind: string, kcal: number, carbsG: number) => ({
    memberId: "omar",
    kind,
    kcal,
    proteinG: 180,
    carbsG,
    fatG: 70,
    satFatMaxG: 22,
    fibreMinG: null,
    solubleFibreMinG: null,
  });
  const profiles = [profile("default", 2150, 200), profile("training", 2390, 260)];
  const f1 = {
    training: [0, 2, 4].map((weekday) => ({ memberId: "omar", weekday })),
    dayOverrides: [],
  };
  // F1 seed 1, Sunday 2026-10-04: Omar's plates as stored (R-28 re-targeted kcal targets), measured
  // by packages/core/test/planner/targets/day-sums.test.ts.
  const sunday = [566, 677.48, 677.58, 224.76].map((kcal) => ({
    memberId: "omar",
    target: { kcal, protein: 45, carbs: 50, fat: 17.5 },
  }));
  /** The pre-fix rule (1.4.4 before CP3): the sum of the plates' targets. */
  const preFix = (plates: typeof sunday) =>
    Math.round(plates.reduce((a, p) => a + p.target.kcal, 0));

  it("F1 Sunday: the day target is 2150 (rest day), with or without schedules", () => {
    expect(dayTarget(profiles, "omar", "2026-10-04", f1, sunday)).toEqual({
      kcal: 2150,
      kind: "default",
      label: "rest day",
    });
    expect(dayTarget(profiles, "omar", "2026-10-04", null, sunday)?.kcal).toBe(2150);
    // Without schedules a default profile does not tell the day kind.
    expect(dayTarget(profiles, "omar", "2026-10-04", null, sunday)?.label).toBeNull();
    // Sara-like: one profile, training by schedule: the kind comes from the schedule.
    const one = [{ ...profile("default", 1655, 160), memberId: "sara" }];
    const s = { training: [{ memberId: "sara", weekday: 1 }], dayOverrides: [] };
    expect(dayTarget(one, "sara", "2026-09-29", s, [])).toMatchObject({
      kcal: 1655,
      label: "training day",
    });
    expect(dayTarget(profiles, "omar", "2026-10-05", f1, sunday)?.label).toBe("training day");
    expect(dayTarget(profiles, "sara", "2026-10-04", f1, sunday)).toBeNull();
  });

  it("negative control: the pre-fix sum of plate targets gives 2146", () => {
    expect(preFix(sunday)).toBe(2146);
    expect(preFix(sunday)).not.toBe(dayTarget(profiles, "omar", "2026-10-04", f1, sunday)?.kcal);
  });
});

// Leaf 1.4.8 G1 (UX-4 move; R-58, SPEC-Q-3, SPEC-Q-7) ---------------------------------------------
describe("moving a meal: which days it can go to", () => {
  const meal = (over: Partial<MovableMeal> = {}): MovableMeal => ({
    id: "m1",
    date: "2027-03-01",
    slotTypeId: "dinner",
    memberScope: "shared",
    dishName: "Lamb kofta",
    locked: false,
    status: "planned",
    ...over,
  });
  const days = new Map<string, MoveDay>([
    ["2027-03-01", { date: "2027-03-01", status: "draft", meals: [meal()] }],
    [
      "2027-03-02",
      {
        date: "2027-03-02",
        status: "draft",
        meals: [meal({ id: "m2", date: "2027-03-02", dishName: "Dal" })],
      },
    ],
    ["2027-03-03", { date: "2027-03-03", status: "draft", meals: [] }],
    [
      "2027-03-04",
      {
        date: "2027-03-04",
        status: "draft",
        meals: [meal({ id: "m4", date: "2027-03-04", dishName: "Pilaf", locked: true })],
      },
    ],
    ["2027-03-05", { date: "2027-03-05", status: "published", meals: [] }],
  ]);
  const dates = [
    "2027-02-28",
    "2027-03-01",
    "2027-03-02",
    "2027-03-03",
    "2027-03-04",
    "2027-03-05",
    "2027-03-06",
  ];

  it("offers swap, move, and blocked days with the reason, from today on", () => {
    expect(moveOptions(meal(), days, dates, "2027-03-01")).toEqual([
      { date: "2027-03-02", kind: "swap", occupant: "Dal", reason: null },
      { date: "2027-03-03", kind: "move", occupant: null, reason: null },
      { date: "2027-03-04", kind: "blocked", occupant: "Pilaf", reason: "Pilaf there is locked." },
      {
        date: "2027-03-05",
        kind: "blocked",
        occupant: null,
        reason: "Already sent to the kitchen.",
      },
      { date: "2027-03-06", kind: "blocked", occupant: null, reason: "Not planned yet." },
    ]);
  });

  it("a locked, cooked or past meal, or one on a sent day, cannot be moved", () => {
    const day = days.get("2027-03-01");
    expect(unmovable(meal(), day, "2027-03-01")).toBeNull();
    expect(unmovable(meal({ locked: true }), day, "2027-03-01")).toMatch(/locked/);
    expect(unmovable(meal({ status: "cooked" }), day, "2027-03-01")).toMatch(/cooked/);
    expect(unmovable(meal(), day, "2027-03-02")).toMatch(/past/);
    expect(
      unmovable(meal(), { date: "2027-03-01", status: "published", meals: [] }, "2027-03-01"),
    ).toMatch(/kitchen/);
  });
});
