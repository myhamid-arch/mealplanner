// PLN-4 target resolver (ledger G1 and the rules behind it).
import { describe, expect, it } from "vitest";
import {
  CARB_TARGET_BASIS,
  TargetResolverError,
  apportion,
  attendedSlots,
  resolveSlotTargets,
  type SlotTarget,
} from "../../../src/planner/targets/index.js";
import type { HouseholdConfig } from "../../../src/types/index.js";
import { F1_WEEK, f1Config, slotId } from "./config.js";

const MACROS = ["kcal", "protein", "carbs", "fat"] as const;

function dailyProfile(cfg: HouseholdConfig, memberId: string, kind: string) {
  const own = cfg.targetProfiles.filter((p) => p.memberId === memberId);
  const p = own.find((x) => x.kind === kind) ?? own.find((x) => x.kind === "default");
  if (p === undefined) throw new Error("no profile");
  return { kcal: p.kcal, protein: p.proteinG, carbs: p.carbsG, fat: p.fatG };
}

function byMemberDay(targets: SlotTarget[]) {
  const groups = new Map<string, SlotTarget[]>();
  for (const t of targets) {
    const key = `${t.memberId}|${t.date}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return groups;
}

describe("F1 week (G1)", () => {
  const cfg = f1Config();
  const week = F1_WEEK.flatMap((date) => resolveSlotTargets(cfg, date));

  it("gives slot targets only to the two targeted adults, every day", () => {
    expect(new Set(week.map((t) => t.memberId))).toEqual(new Set(["adult_a", "adult_b"]));
    expect(byMemberDay(week).size).toBe(14);
  });

  it("per-slot targets sum to the daily target within 1 g / 1 kcal", () => {
    for (const [, slots] of byMemberDay(week)) {
      const first = slots[0];
      if (first === undefined) throw new Error("empty group");
      const daily = dailyProfile(cfg, first.memberId, first.dayKind);
      for (const m of MACROS) {
        const sum = slots.reduce((a, t) => a + t[m], 0);
        expect(Math.abs(sum - daily[m])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("adds pre/post-workout slots on training days for the training member only", () => {
    const training: Record<string, readonly number[]> = { adult_a: [0, 2, 4], adult_b: [1, 3, 5] };
    F1_WEEK.forEach((date, weekday) => {
      for (const memberId of ["adult_a", "adult_b"]) {
        const keys = week
          .filter((t) => t.memberId === memberId && t.date === date)
          .map((t) => t.slotKey);
        const trains = training[memberId]?.includes(weekday) ?? false;
        expect(keys.includes("pre_workout")).toBe(trains);
        expect(keys.includes("post_workout")).toBe(trains);
        const kinds = new Set(
          week.filter((t) => t.memberId === memberId && t.date === date).map((t) => t.dayKind),
        );
        expect([...kinds]).toEqual([trains ? "training" : "default"]);
      }
    });
  });

  it("uses Adult A's training profile on training days and the default profile for Adult B", () => {
    const monA = week.filter((t) => t.memberId === "adult_a" && t.date === F1_WEEK[0]);
    expect(monA.reduce((a, t) => a + t.kcal, 0)).toBe(2390);
    expect(monA.reduce((a, t) => a + t.carbs, 0)).toBe(260);
    const tueB = week.filter((t) => t.memberId === "adult_b" && t.date === F1_WEEK[1]);
    expect(tueB.reduce((a, t) => a + t.kcal, 0)).toBe(1655);
  });

  it("follows the F1 attendance: packed work lunch replaces lunch for A on weekdays", () => {
    const monA = week
      .filter((t) => t.memberId === "adult_a" && t.date === F1_WEEK[0])
      .map((t) => t.slotKey);
    expect(monA).toEqual([
      "breakfast",
      "packed_work_lunch",
      "snack",
      "pre_workout",
      "post_workout",
      "dinner",
    ]);
    const satA = week
      .filter((t) => t.memberId === "adult_a" && t.date === F1_WEEK[5])
      .map((t) => t.slotKey);
    expect(satA).toEqual(["breakfast", "lunch", "snack", "dinner"]);
  });

  it("uses coarse PLN-2 weights and the member tolerance", () => {
    const monB = week.filter((t) => t.memberId === "adult_b" && t.date === F1_WEEK[0]);
    // Monday is a rest day for B: breakfast 0.25, lunch 0.30, snack 0.10, dinner 0.30 → Σ 0.95
    expect(monB.map((t) => t.kcal)).toEqual(apportion(1655, [0.25, 0.3, 0.1, 0.3]));
    for (const t of week) {
      expect(t.tol).toEqual({ kcal: 50, protein: 5, carbs: 5, fat: 2 });
      expect(t.mode).toBe("strict");
      expect(t.carbBasis).toBe(CARB_TARGET_BASIS);
      expect(t.slotTypeId).toBe(slotId(t.slotKey));
    }
  });

  it("splits sat fat and soluble fibre by share", () => {
    const monA = week.filter((t) => t.memberId === "adult_a" && t.date === F1_WEEK[0]);
    expect(monA.reduce((a, t) => a + (t.satFatMax ?? 0), 0)).toBeCloseTo(22, 0);
    expect(monA.reduce((a, t) => a + (t.solubleFibreGoal ?? 0), 0)).toBeCloseTo(10, 0);
    // Adult B has no soluble-fibre minimum (OQ-4: no default).
    expect(
      week.filter((t) => t.memberId === "adult_b").every((t) => t.solubleFibreGoal === undefined),
    ).toBe(true);
  });
});

describe("carbohydrate basis (R-20, OQ-7)", () => {
  it("defaults to total carbohydrate", () => {
    expect(CARB_TARGET_BASIS).toBe("total");
    expect(resolveSlotTargets(f1Config(), F1_WEEK[0]).every((t) => t.carbBasis === "total")).toBe(
      true,
    );
  });
  it("can resolve on available carbohydrate with the same gram values", () => {
    const total = resolveSlotTargets(f1Config(), F1_WEEK[0], { carbBasis: "total" });
    const available = resolveSlotTargets(f1Config(), F1_WEEK[0], { carbBasis: "available" });
    expect(available.every((t) => t.carbBasis === "available")).toBe(true);
    expect(available.map((t) => t.carbs)).toEqual(total.map((t) => t.carbs));
  });
});

describe("day kind and attendance (PLN-4 steps 1 and 3, SPEC-Q-3)", () => {
  const mon = F1_WEEK[0];
  const tue = F1_WEEK[1];
  it("a rest override on a training day drops the training slots and profile", () => {
    const cfg = f1Config();
    cfg.dayOverrides.push({
      id: "o1",
      householdId: cfg.household.id,
      memberId: "adult_a",
      date: mon,
      kind: "rest",
      slotTypeId: null,
    });
    const a = attendedSlots(cfg, "adult_a", mon);
    expect(a.dayKind).toBe("default");
    expect(a.slots.some((s) => s.isTrainingSlot)).toBe(false);
    const sum = resolveSlotTargets(cfg, mon)
      .filter((t) => t.memberId === "adult_a")
      .reduce((x, t) => x + t.kcal, 0);
    expect(sum).toBe(2150);
  });
  it("a training override on a rest day adds them", () => {
    const cfg = f1Config();
    cfg.dayOverrides.push({
      id: "o2",
      householdId: cfg.household.id,
      memberId: "adult_a",
      date: tue,
      kind: "training",
      slotTypeId: null,
    });
    const a = attendedSlots(cfg, "adult_a", tue);
    expect(a.dayKind).toBe("training");
    expect(a.slots.map((s) => s.key)).toContain("pre_workout");
  });
  it("absent_slot removes and extra_slot adds a slot for that date", () => {
    const cfg = f1Config();
    cfg.dayOverrides.push(
      {
        id: "o3",
        householdId: cfg.household.id,
        memberId: "adult_b",
        date: tue,
        kind: "absent_slot",
        slotTypeId: slotId("snack"),
      },
      {
        id: "o4",
        householdId: cfg.household.id,
        memberId: "adult_b",
        date: tue,
        kind: "extra_slot",
        slotTypeId: slotId("packed_work_lunch"),
      },
    );
    const keys = attendedSlots(cfg, "adult_b", tue).slots.map((s) => s.key);
    expect(keys).not.toContain("snack");
    expect(keys).toContain("packed_work_lunch");
    const sum = resolveSlotTargets(cfg, tue)
      .filter((t) => t.memberId === "adult_b")
      .reduce((x, t) => x + t.protein, 0);
    expect(sum).toBe(130);
  });
  it("never attends an inactive slot, even with extra_slot", () => {
    const cfg = f1Config();
    const slot = cfg.slotTypes.find((s) => s.key === "snack");
    if (slot === undefined) throw new Error("no snack slot");
    slot.active = false;
    cfg.dayOverrides.push({
      id: "o5",
      householdId: cfg.household.id,
      memberId: "adult_b",
      date: tue,
      kind: "extra_slot",
      slotTypeId: slot.id,
    });
    expect(attendedSlots(cfg, "adult_b", tue).slots.map((s) => s.key)).not.toContain("snack");
  });
  it("a schedule row with attends = false suppresses a training slot", () => {
    const cfg = f1Config();
    cfg.memberSlotSchedules.push({
      householdId: cfg.household.id,
      memberId: "adult_a",
      slotTypeId: slotId("pre_workout"),
      weekday: 0,
      attends: false,
    });
    const keys = attendedSlots(cfg, "adult_a", mon).slots.map((s) => s.key);
    expect(keys).not.toContain("pre_workout");
    expect(keys).toContain("post_workout");
  });
  it("gives untargeted members attendance but no targets (SPEC-Q-2)", () => {
    const cfg = f1Config();
    expect(attendedSlots(cfg, "c3", mon).slots.map((s) => s.key)).toEqual([
      "breakfast",
      "packed_school_lunch",
      "snack",
      "dinner",
    ]);
    expect(resolveSlotTargets(cfg, mon).some((t) => t.memberId === "c3")).toBe(false);
  });
  it("skips archived members", () => {
    const cfg = f1Config();
    const b = cfg.members.find((m) => m.id === "adult_b");
    if (b === undefined) throw new Error("no adult_b");
    b.archivedAt = new Date(0);
    expect(resolveSlotTargets(cfg, mon).some((t) => t.memberId === "adult_b")).toBe(false);
  });
});

describe("shares (PLN-4 step 4, SPEC-Q-4 and 5)", () => {
  const mon = F1_WEEK[0]; // a rest day for Adult B
  it("uses detailed meal_distribution rows when they cover the attended slots", () => {
    const cfg = f1Config();
    const shares: Record<string, number> = { breakfast: 0.2, lunch: 0.4, snack: 0.1, dinner: 0.3 };
    for (const [key, share] of Object.entries(shares))
      cfg.mealDistributions.push({
        householdId: cfg.household.id,
        memberId: "adult_b",
        dayKind: "default",
        slotTypeId: slotId(key),
        share,
      });
    const t = resolveSlotTargets(cfg, mon).filter((x) => x.memberId === "adult_b");
    expect(t.map((x) => x.kcal)).toEqual(apportion(1655, [0.2, 0.4, 0.1, 0.3]));
  });
  it("falls back to coarse weights when the rows do not cover an attended slot", () => {
    const cfg = f1Config();
    cfg.mealDistributions.push({
      householdId: cfg.household.id,
      memberId: "adult_b",
      dayKind: "default",
      slotTypeId: slotId("dinner"),
      share: 1,
    });
    const t = resolveSlotTargets(cfg, mon).filter((x) => x.memberId === "adult_b");
    expect(t.map((x) => x.kcal)).toEqual(apportion(1655, [0.25, 0.3, 0.1, 0.3]));
  });
  it("renormalises detailed shares when an override removes a slot", () => {
    const cfg = f1Config();
    for (const [key, share] of Object.entries({
      breakfast: 0.2,
      lunch: 0.4,
      snack: 0.1,
      dinner: 0.3,
    }))
      cfg.mealDistributions.push({
        householdId: cfg.household.id,
        memberId: "adult_b",
        dayKind: "default",
        slotTypeId: slotId(key),
        share,
      });
    cfg.dayOverrides.push({
      id: "o",
      householdId: cfg.household.id,
      memberId: "adult_b",
      date: mon,
      kind: "absent_slot",
      slotTypeId: slotId("snack"),
    });
    const t = resolveSlotTargets(cfg, mon).filter((x) => x.memberId === "adult_b");
    expect(t.map((x) => x.kcal)).toEqual(apportion(1655, [0.2, 0.4, 0.3]));
  });
  it("keeps expert overrides and spreads the remainder by share", () => {
    const cfg = f1Config();
    cfg.slotTargetOverrides.push({
      householdId: cfg.household.id,
      memberId: "adult_b",
      dayKind: "default",
      slotTypeId: slotId("dinner"),
      kcal: 700,
      proteinG: 60,
      carbsG: null,
      fatG: null,
    });
    const t = resolveSlotTargets(cfg, mon).filter((x) => x.memberId === "adult_b");
    const dinner = t.find((x) => x.slotKey === "dinner");
    expect(dinner?.kcal).toBe(700);
    expect(dinner?.protein).toBe(60);
    expect(t.reduce((a, x) => a + x.kcal, 0)).toBe(1655);
    expect(t.reduce((a, x) => a + x.protein, 0)).toBe(130);
    const rest = t.filter((x) => x.slotKey !== "dinner").map((x) => x.kcal);
    expect(rest).toEqual(apportion(1655 - 700, [0.25, 0.3, 0.1]));
    // Carbs were not overridden: plain share split.
    expect(t.map((x) => x.carbs)).toEqual(apportion(160, [0.25, 0.3, 0.1, 0.3]));
  });
  it("clamps a negative remainder at zero", () => {
    const cfg = f1Config();
    cfg.slotTargetOverrides.push({
      householdId: cfg.household.id,
      memberId: "adult_b",
      dayKind: "default",
      slotTypeId: slotId("dinner"),
      kcal: 2000,
      proteinG: null,
      carbsG: null,
      fatG: null,
    });
    const t = resolveSlotTargets(cfg, mon).filter((x) => x.memberId === "adult_b");
    expect(t.find((x) => x.slotKey === "dinner")?.kcal).toBe(2000);
    expect(t.filter((x) => x.slotKey !== "dinner").every((x) => x.kcal === 0)).toBe(true);
  });
});

describe("rounding, defaults and errors", () => {
  it("apportions whole units that sum exactly to the total", () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(7, [0.25, 0.3, 0.1, 0.3])).toEqual([2, 2, 1, 2]);
    expect(apportion(5, [0, 0])).toEqual([3, 2]);
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    for (let total = 0; total < 300; total += 7)
      expect(apportion(total, [0.25, 0.3, 0.1, 0.15, 0.1]).reduce((a, b) => a + b, 0)).toBe(total);
  });
  it("defaults the sat-fat cap to household.sat_fat_default_pct of kcal (OQ-4, SPEC-Q-7)", () => {
    const cfg = f1Config();
    for (const p of cfg.targetProfiles) if (p.memberId === "adult_b") p.satFatMaxG = null;
    cfg.household.satFatDefaultPct = 10;
    const t = resolveSlotTargets(cfg, F1_WEEK[1]).filter((x) => x.memberId === "adult_b");
    expect(t.reduce((a, x) => a + (x.satFatMax ?? 0), 0)).toBeCloseTo((1655 * 0.1) / 9, 0);
  });
  it("uses the 02 defaults and household precision without a tolerance row (SPEC-Q-8)", () => {
    const cfg = f1Config();
    cfg.tolerances = cfg.tolerances.filter((t) => t.memberId !== "adult_b");
    cfg.household.defaultPrecision = "flexible";
    const t = resolveSlotTargets(cfg, F1_WEEK[1]).filter((x) => x.memberId === "adult_b");
    expect(
      t.every(
        (x) => x.mode === "flexible" && x.tol.protein === 5 && x.tol.fat === 2 && x.tol.kcal === 50,
      ),
    ).toBe(true);
  });
  it("throws typed errors", () => {
    const cfg = f1Config();
    expect(() => resolveSlotTargets(cfg, "2026-02-30")).toThrow(TargetResolverError);
    expect(() => resolveSlotTargets(cfg, "28/09/2026")).toThrow(TargetResolverError);
    expect(() => attendedSlots(cfg, "nobody", F1_WEEK[0])).toThrow(TargetResolverError);
    cfg.targetProfiles = cfg.targetProfiles.filter((p) => p.memberId !== "adult_b");
    try {
      resolveSlotTargets(cfg, F1_WEEK[0]);
      throw new Error("expected missing_profile");
    } catch (e) {
      expect(e).toBeInstanceOf(TargetResolverError);
      expect((e as TargetResolverError).code).toBe("missing_profile");
    }
  });
  it("is deterministic", () => {
    expect(resolveSlotTargets(f1Config(), F1_WEEK[2])).toEqual(
      resolveSlotTargets(f1Config(), F1_WEEK[2]),
    );
  });
});
