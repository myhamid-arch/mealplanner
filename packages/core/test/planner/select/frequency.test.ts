// PLN-9 §6.3 repeat gaps by slot (OQ-8, R-62, R-63): main meals need a day difference of 7 (6 full
// days in between), snack and workout meals 4 (3 full days); two servings of one dish in slots of
// different kinds need the larger gap; a household `frequency_rule` on the dish replaces the
// default in every slot and keeps its days-apart meaning.
import { describe, expect, it } from "vitest";
import {
  MAIN_MIN_GAP_DAYS,
  SHORT_GAP_SLOT_KEYS,
  SHORT_MIN_GAP_DAYS,
} from "../../../src/planner/select/config.js";
import {
  dayNumber,
  frequencyReason,
  pairGap,
  repeatGap,
  type Served,
} from "../../../src/planner/select/filters.js";
import type { PlanDish } from "../../../src/planner/select/index.js";
import { Pool } from "../../../src/planner/select/pool.js";
import type { FrequencyRuleRow } from "../../../src/types/index.js";
import { seedLibrary } from "./support.js";

const lib = seedLibrary();
const pool = new Pool(lib.dishes, lib.adjusters);
const dish = (id: string): PlanDish => {
  const d = lib.dishes.find((x) => x.id === id);
  if (d === undefined) throw new Error(`missing ${id}`);
  return d;
};
const d = dish("chicken-shawarma-wrap");

/** Monday 2026-09-28 plus n days. */
const MON = "2026-09-28";
const plus = (n: number) => {
  const t = new Date(`${MON}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

const served = (date: string, slotKey: string, memberIds = ["c1"], dishId = d.id): Served => ({
  date,
  day: dayNumber(date),
  mealKey: `${date}|slot:${slotKey}|shared`,
  slotKey,
  dishId,
  memberIds,
  cuisineKey: d.cuisineKey,
  methodKeys: ["grilled"],
  core: ["ing:chicken-thigh"],
  mainProtein: null,
  timeKey: "12",
});

const rule = (over: Partial<FrequencyRuleRow>): FrequencyRuleRow => ({
  id: "r",
  householdId: "household-test",
  memberId: null,
  entityType: "dish",
  entityKey: d.id,
  minGapDays: null,
  maxPerWeek: null,
  source: "explicit",
  locked: false,
  ...over,
});

/** Is the dish blocked at `slot` on Monday + `day` after a serving at `prevSlot` on Monday? */
const blocked = (
  slot: string,
  day: number,
  prevSlot = slot,
  rules: FrequencyRuleRow[] = [],
  attendees = ["c1"],
) => frequencyReason(d, plus(day), slot, attendees, [served(MON, prevSlot)], rules, pool) !== null;

describe("repeat gap defaults (OQ-8)", () => {
  it("is 7 for main-meal slots and 4 for snack, pre_workout and post_workout", () => {
    expect(MAIN_MIN_GAP_DAYS).toBe(7);
    expect(SHORT_MIN_GAP_DAYS).toBe(4);
    expect([...SHORT_GAP_SLOT_KEYS].sort()).toEqual(["post_workout", "pre_workout", "snack"]);
    for (const k of ["breakfast", "lunch", "dinner", "packed_school_lunch", "packed_work_lunch"])
      expect(repeatGap(k)).toBe(7);
    for (const k of ["snack", "pre_workout", "post_workout"]) expect(repeatGap(k)).toBe(4);
  });
  it("treats a custom slot as a main meal (SPEC-Q-2)", () => {
    expect(repeatGap("custom_supper")).toBe(7);
  });
  it("takes the larger gap for a pair of slots of different kinds, in either order (R-63)", () => {
    expect(pairGap("snack", "dinner")).toBe(7);
    expect(pairGap("dinner", "snack")).toBe(7);
    expect(pairGap("snack", "post_workout")).toBe(4);
  });
});

describe("dinner boundaries (6 full days in between)", () => {
  it("blocks Mon → Sun and allows Mon → next Mon", () => {
    expect(blocked("dinner", 6)).toBe(true);
    expect(blocked("dinner", 7)).toBe(false);
  });
  it("blocks in the other direction too: next Sun is too close to Mon", () => {
    // Planning Monday with a serving 6 days later already in the plan (locked, or improvement pass).
    expect(
      frequencyReason(d, MON, "dinner", ["c1"], [served(plus(6), "dinner")], [], pool),
    ).not.toBeNull();
    expect(
      frequencyReason(d, MON, "dinner", ["c1"], [served(plus(7), "dinner")], [], pool),
    ).toBeNull();
  });
  it("applies to every main-meal slot, custom slots included", () => {
    for (const k of [
      "breakfast",
      "lunch",
      "packed_school_lunch",
      "packed_work_lunch",
      "custom_x",
    ]) {
      expect(blocked(k, 6), k).toBe(true);
      expect(blocked(k, 7), k).toBe(false);
    }
  });
  it("names the date and the gap in the reason", () => {
    expect(frequencyReason(d, plus(6), "dinner", ["c1"], [served(MON, "dinner")], [], pool)).toBe(
      `${d.name} was served ${MON} (min gap 7 days)`,
    );
  });
});

describe("snack and workout boundaries (3 full days in between)", () => {
  it("blocks Mon → Thu and allows Mon → Fri for a snack", () => {
    expect(blocked("snack", 3)).toBe(true);
    expect(blocked("snack", 4)).toBe(false);
  });
  it("uses the same gap for pre_workout and post_workout, and between them", () => {
    expect(blocked("pre_workout", 3)).toBe(true);
    expect(blocked("pre_workout", 4)).toBe(false);
    expect(blocked("post_workout", 3)).toBe(true);
    expect(blocked("post_workout", 4)).toBe(false);
    expect(blocked("post_workout", 3, "snack")).toBe(true);
    expect(blocked("post_workout", 4, "pre_workout")).toBe(false);
  });
});

describe("slots of different kinds (R-63: larger gap, symmetric)", () => {
  it("a main-meal serving keeps the dish from a snack for 7 days", () => {
    expect(blocked("snack", 4, "dinner")).toBe(true);
    expect(blocked("snack", 6, "breakfast")).toBe(true);
    expect(blocked("snack", 7, "breakfast")).toBe(false);
  });
  it("a snack serving keeps the dish from a main meal for 7 days", () => {
    expect(blocked("breakfast", 4, "snack")).toBe(true);
    expect(blocked("breakfast", 6, "snack")).toBe(true);
    expect(blocked("breakfast", 7, "snack")).toBe(false);
  });
  it("gives the same answer whichever of the two meals is planned first", () => {
    for (let n = 0; n <= 8; n++) {
      const forward = blocked("snack", n, "dinner");
      const backward =
        frequencyReason(d, MON, "dinner", ["c1"], [served(plus(n), "snack")], [], pool) !== null;
      expect(backward, `day difference ${String(n)}`).toBe(forward);
    }
  });
});

describe("who and what the gap covers", () => {
  it("does not block another attendee, or another dish", () => {
    expect(blocked("dinner", 1, "dinner", [], ["c2"])).toBe(false);
    expect(
      frequencyReason(d, plus(1), "dinner", ["c1"], [served(MON, "dinner", ["c1"], "x")], [], pool),
    ).toBeNull();
  });
  it("blocks when any attendee of a shared meal had the dish", () => {
    expect(blocked("dinner", 3, "dinner", [], ["c2", "c1"])).toBe(true);
  });
});

describe("frequency_rule keeps its days-apart meaning (OQ-8)", () => {
  it("a household dish rule replaces the default in every slot", () => {
    const every3 = [rule({ minGapDays: 3 })];
    expect(blocked("dinner", 2, "dinner", every3)).toBe(true);
    expect(blocked("dinner", 3, "dinner", every3)).toBe(false);
    expect(blocked("snack", 3, "dinner", every3)).toBe(false);
    const every10 = [rule({ minGapDays: 10 })];
    expect(blocked("snack", 9, "snack", every10)).toBe(true);
    expect(blocked("snack", 10, "snack", every10)).toBe(false);
  });
  it("a member-level dish rule adds to the default instead of replacing it", () => {
    const own = [rule({ memberId: "c1", minGapDays: 2 })];
    expect(blocked("dinner", 3, "dinner", own)).toBe(true);
    const longer = [rule({ memberId: "c1", minGapDays: 10 })];
    expect(blocked("dinner", 8, "dinner", longer)).toBe(true);
    expect(blocked("dinner", 10, "dinner", longer)).toBe(false);
  });
  it("a household rule without min_gap_days leaves the default in place", () => {
    const capped = [rule({ maxPerWeek: 5 })];
    expect(blocked("dinner", 6, "dinner", capped)).toBe(true);
    expect(blocked("dinner", 7, "dinner", capped)).toBe(false);
  });
});
