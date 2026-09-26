// PLN-9 §6.3 hard filters: slot suitability, exclusions (SPEC-Q-6, R-34, R-36), never
// preferences, frequency (SPEC-Q-5).
import { describe, expect, it } from "vitest";
import type { PlanDish } from "../../../src/planner/select/index.js";
import {
  dayNumber,
  frequencyReason,
  neverReason,
  passesExclusions,
  plannable,
  suitsSlot,
  type Served,
} from "../../../src/planner/select/filters.js";
import { Household } from "../../../src/planner/select/members.js";
import { Pool } from "../../../src/planner/select/pool.js";
import type {
  ExclusionRow,
  FrequencyRuleRow,
  PreferenceRow,
  SlotTypeRow,
} from "../../../src/types/index.js";
import { f1PlanConfig } from "./f1.js";
import { MONDAY, planF1, platesOf, seedLibrary } from "./support.js";

const slot = (key: string, isPacked = false, reheatAvailable = false): SlotTypeRow => ({
  id: `slot:${key}`,
  householdId: "household-test",
  key,
  label: key,
  icon: "x",
  sortOrder: 1,
  defaultTime: "12:00:00",
  isShared: true,
  isPacked,
  reheatAvailable,
  isTrainingSlot: false,
  constraintsNote: null,
  active: true,
});

function libDish(id: string): PlanDish {
  const d = seedLibrary().dishes.find((x) => x.id === id);
  if (d === undefined) throw new Error(`missing ${id}`);
  return d;
}

const exclusion = (over: Partial<ExclusionRow>): ExclusionRow => ({
  id: "ex",
  householdId: "household-test",
  memberId: "c3",
  kind: "dietary_flag",
  key: "contains_sesame",
  reason: "allergy",
  hard: true,
  ...over,
});

describe("plannable and slot suitability", () => {
  const base = libDish("chicken-shawarma-wrap");
  it("needs an active dish without needs_review variants", () => {
    expect(plannable(base)).toBe(true);
    expect(plannable({ ...base, status: "retired" })).toBe(false);
    const flagged = {
      ...base,
      components: base.components.map((c, i) =>
        i === 0 ? { ...c, variants: c.variants.map((v) => ({ ...v, needsReview: true })) } : c,
      ),
    };
    expect(plannable(flagged)).toBe(false);
  });
  it("accepts a listed slot, and a packable lunch dish for a packed slot", () => {
    const lunch = { ...base, slotKeys: ["lunch"], isPackable: true, servedColdOk: true };
    expect(suitsSlot(lunch, slot("lunch"))).toBe(true);
    expect(suitsSlot(lunch, slot("dinner"))).toBe(false);
    expect(suitsSlot(lunch, slot("packed_school_lunch", true, false))).toBe(true);
  });
  it("needs is_packable for packed slots and served_cold_ok without reheat", () => {
    const hot = {
      ...base,
      slotKeys: ["lunch", "packed_work_lunch", "packed_school_lunch"],
      isPackable: true,
      servedColdOk: false,
    };
    expect(suitsSlot(hot, slot("packed_work_lunch", true, true))).toBe(true);
    expect(suitsSlot(hot, slot("packed_school_lunch", true, false))).toBe(false);
    expect(suitsSlot({ ...hot, isPackable: false }, slot("packed_work_lunch", true, true))).toBe(
      false,
    );
  });
});

describe("exclusions (SPEC-Q-6, R-34, R-36)", () => {
  const lib = seedLibrary();
  const pool = new Pool(lib.dishes, lib.adjusters);
  const sesameDish = lib.dishes.find((d) =>
    d.components.some(
      (c) =>
        c.required &&
        c.variants.every((v) =>
          v.ingredients.some((i) => i.dietaryFlags.includes("contains_sesame")),
        ),
    ),
  );
  it("filters a dish whose required component has no allowed variant for an attendee", () => {
    expect(sesameDish).toBeDefined();
    const cfg = f1PlanConfig();
    const hh = new Household(cfg, pool);
    const d = sesameDish as PlanDish;
    expect(passesExclusions(d, [hh.ctx("c3", slot("dinner"), d, [])])).toBe(false);
    expect(passesExclusions(d, [hh.ctx("c2", slot("dinner"), d, [])])).toBe(true);
  });
  it("resolves ingredient exclusion keys as slugs to ingredient ids (R-36)", () => {
    const cfg = f1PlanConfig();
    cfg.exclusions = [
      exclusion({ kind: "ingredient", key: "chicken-thigh", reason: "dislike", hard: false }),
    ];
    const hh = new Household(cfg, pool);
    expect(hh.exclusionsOf("c3").ingredientIds).toEqual(["ing:chicken-thigh"]);
    expect(hh.exclusionsOf("c2").ingredientIds).toEqual([]);
  });
  it("applies household-level exclusions to every member", () => {
    const cfg = f1PlanConfig();
    cfg.exclusions = [
      exclusion({ memberId: null, kind: "category", key: "seafood", reason: "religious" }),
    ];
    const hh = new Household(cfg, pool);
    for (const m of ["adult_a", "c1"]) expect(hh.exclusionsOf(m).categories).toEqual(["seafood"]);
  });

  it("a hard: false dislike exclusion removes the ingredient from that member's plates (R-34)", async () => {
    const plain = await planF1([MONDAY]);
    const counts = new Map<string, number>();
    for (const { plate } of platesOf(plain).filter((x) => x.plate.memberId === "adult_a"))
      for (const item of plate.solution.items)
        for (const i of pool.variant(item.variantId)?.core ?? [])
          counts.set(i, (counts.get(i) ?? 0) + 1);
    const [top] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    expect(top).toBeDefined();
    const [id] = top as [string, number];
    const slug = pool.slugById.get(id) as string;
    const cfg = f1PlanConfig();
    cfg.exclusions = [
      ...cfg.exclusions,
      exclusion({
        id: "dislike",
        memberId: "adult_a",
        kind: "ingredient",
        key: slug,
        reason: "dislike",
        hard: false,
      }),
    ];
    const plan = await planF1([MONDAY], { config: cfg });
    const served = (memberId: string) =>
      platesOf(plan)
        .filter((x) => x.plate.memberId === memberId)
        .flatMap((x) => [
          ...x.plate.solution.items.map((i) => i.variantId),
          ...x.plate.solution.adjusters.map((a) => a.variantId),
        ])
        .flatMap((v) => pool.variant(v)?.variant.ingredients.map((i) => i.id) ?? []);
    expect(served("adult_a")).not.toContain(id);
    expect(served("adult_a").length).toBeGreaterThan(0);
  }, 60_000);
});

describe("never preferences", () => {
  const lib = seedLibrary();
  const pool = new Pool(lib.dishes, lib.adjusters);
  const pref = (over: Partial<PreferenceRow>): PreferenceRow => ({
    id: "p",
    householdId: "household-test",
    memberId: "c1",
    entityType: "dish",
    entityKey: "chicken-shawarma-wrap",
    score: -1,
    evidenceWeight: 1,
    source: "explicit",
    locked: true,
    hard: "never",
    updatedAt: new Date(0),
    ...over,
  });
  const d = libDish("chicken-shawarma-wrap");
  it("filters a dish marked never by an attendee", () => {
    const cfg = f1PlanConfig();
    cfg.preferences = [pref({})];
    const hh = new Household(cfg, pool);
    expect(neverReason(d, ["c1"], hh, pool)).not.toBeNull();
    expect(neverReason(d, ["c2"], hh, pool)).toBeNull();
  });
  it("filters on a never ingredient present in every variant of a required component", () => {
    const required = d.components.find((c) => c.required);
    const shared = required?.variants
      .map((v) => new Set(pool.variant(v.id)?.core))
      .reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    const ing = [...(shared ?? [])][0] as string;
    const cfg = f1PlanConfig();
    cfg.preferences = [pref({ memberId: null, entityType: "ingredient", entityKey: ing })];
    expect(neverReason(d, ["c2"], new Household(cfg, pool), pool)).not.toBeNull();
  });
});

describe("frequency (SPEC-Q-5)", () => {
  const lib = seedLibrary();
  const pool = new Pool(lib.dishes, lib.adjusters);
  const d = libDish("chicken-shawarma-wrap");
  const served = (date: string, memberIds: string[], dishId = d.id): Served => ({
    date,
    day: dayNumber(date),
    mealKey: `${date}|x|shared`,
    dishId,
    memberIds,
    cuisineKey: d.cuisineKey,
    methodKeys: ["grilled"],
    core: ["ing:chicken-thigh"],
    mainProtein: null,
    timeKey: "12",
  });
  it("blocks the same dish for an attendee fewer than 6 days away, either direction", () => {
    expect(
      frequencyReason(d, "2026-10-01", ["c1"], [served("2026-09-26", ["c1"])], [], pool),
    ).not.toBeNull();
    expect(
      frequencyReason(d, "2026-10-01", ["c1"], [served("2026-10-06", ["c1"])], [], pool),
    ).not.toBeNull();
    expect(
      frequencyReason(d, "2026-10-01", ["c1"], [served("2026-09-25", ["c1"])], [], pool),
    ).toBeNull();
    expect(
      frequencyReason(d, "2026-10-01", ["c2"], [served("2026-09-30", ["c1"])], [], pool),
    ).toBeNull();
  });
  const rule = (over: Partial<FrequencyRuleRow>): FrequencyRuleRow => ({
    id: "r",
    householdId: "household-test",
    memberId: null,
    entityType: "cuisine",
    entityKey: d.cuisineKey,
    minGapDays: null,
    maxPerWeek: null,
    source: "explicit",
    locked: false,
    ...over,
  });
  it("applies max_per_week over the ISO week and member-level rules only to that member", () => {
    const other = served("2026-09-28", ["c1"], "other-dish");
    const other2 = served("2026-09-29", ["c1"], "other-dish-2");
    const max2 = rule({ maxPerWeek: 2 });
    expect(frequencyReason(d, "2026-10-01", ["c1"], [other, other2], [max2], pool)).not.toBeNull();
    expect(frequencyReason(d, "2026-10-05", ["c1"], [other, other2], [max2], pool)).toBeNull();
    const own = rule({ memberId: "c2", maxPerWeek: 1 });
    expect(frequencyReason(d, "2026-10-01", ["c1"], [other], [own], pool)).toBeNull();
  });
  it("lets a household dish rule replace the default gap", () => {
    const short = rule({ entityType: "dish", entityKey: d.id, minGapDays: 2 });
    expect(
      frequencyReason(d, "2026-10-01", ["c1"], [served("2026-09-28", ["c1"])], [short], pool),
    ).toBeNull();
    expect(
      frequencyReason(d, "2026-10-01", ["c1"], [served("2026-09-30", ["c1"])], [short], pool),
    ).not.toBeNull();
  });
});
