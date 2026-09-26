// BLD-2: the fixtures describe what 11-build-plan §2 says (pure checks; G6 loads them into a
// database in packages/db/test/fixtures.int.test.ts).
import { describe, expect, it } from "vitest";
import {
  FixtureCatalogSchema,
  FixtureSchema,
  weekdayOf,
  type Fixture,
} from "../../src/types/index.js";
import { F1, F2, F3, F3_REVIEW_DAYS, F3_REVIEWS_PER_DAY, fixtureCatalog } from "./index.js";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

const parse = (input: unknown): Fixture => FixtureSchema.parse(input);
const AGE_REFERENCE_YEAR = 2026; // the ages in BLD-2 are as of the build year

describe("fixtures (BLD-2)", () => {
  it("F1 is the reference household of 11-build-plan §2", () => {
    const f1 = parse(F1);
    const a = must(f1.members.find((m) => m.key === "adult_a"));
    const b = must(f1.members.find((m) => m.key === "adult_b"));
    expect(a.targets?.default).toMatchObject({
      kcal: 2150,
      proteinG: 180,
      carbsG: 200,
      fatG: 70,
      satFatMaxG: 22,
      solubleFibreMinG: 10,
    });
    expect(a.targets?.training).toMatchObject({ kcal: 2390, proteinG: 180, carbsG: 260, fatG: 70 });
    expect(a.training.map((d) => [d.weekday, d.sessionTime])).toEqual([
      [0, "18:00:00"],
      [2, "18:00:00"],
      [4, "18:00:00"],
    ]); // Mon/Wed/Fri
    expect(b.targets?.default).toMatchObject({
      kcal: 1655,
      proteinG: 130,
      carbsG: 160,
      fatG: 55,
      satFatMaxG: 18,
    });
    expect(b.targets?.training).toBeUndefined();
    expect(b.training.map((d) => [d.weekday, d.sessionTime])).toEqual([
      [1, "07:00:00"],
      [3, "07:00:00"],
      [5, "07:00:00"],
    ]); // Tue/Thu/Sat
    const children = f1.members.filter((m) => m.targets === undefined);
    expect(
      children.map((c) => [AGE_REFERENCE_YEAR - must(c.birthYear), c.sex, c.appetite]),
    ).toEqual([
      [18, "female", "large"],
      [15, "male", "large"],
      [10, "male", "medium"],
    ]);
    expect(f1.slots.active.sort()).toEqual([
      "breakfast",
      "dinner",
      "lunch",
      "packed_school_lunch",
      "packed_work_lunch",
      "post_workout",
      "pre_workout",
      "snack",
    ]);
    for (const m of [a, b])
      expect(m.tolerance).toEqual({ proteinG: 5, carbsG: 5, fatG: 2, kcal: 50, mode: "strict" });
    expect(f1.cuisines).toEqual({
      liked: ["italian", "levantine", "american", "british", "indian"],
      disliked: [],
    });
    expect(f1.exclusions).toEqual([
      { member: "c3", kind: "dietary_flag", key: "contains_sesame", reason: "allergy" },
    ]);
    // Packed school lunch Mon–Fri replacing lunch for the children; packed work lunch Mon–Fri for A.
    const attends = (member: string, slot: string, weekday: number) =>
      f1.schedules.find(
        (s) => s.member === member && s.slot === slot && s.weekdays.includes(weekday),
      )?.attends;
    for (const child of ["c1", "c2", "c3"]) {
      for (const day of [0, 1, 2, 3, 4])
        expect([attends(child, "packed_school_lunch", day), attends(child, "lunch", day)]).toEqual([
          true,
          false,
        ]);
      for (const day of [5, 6]) expect(attends(child, "packed_school_lunch", day)).toBe(false);
    }
    for (const day of [0, 1, 2, 3, 4])
      expect([
        attends("adult_a", "packed_work_lunch", day),
        attends("adult_a", "lunch", day),
      ]).toEqual([true, false]);
  });

  it("F2 is one targeted adult with breakfast, lunch and dinner", () => {
    const f2 = parse(F2);
    expect(f2.members).toHaveLength(1);
    expect(must(f2.members[0]).targets).toBeDefined();
    expect(f2.slots.active.sort()).toEqual(["breakfast", "dinner", "lunch"]);
    expect(f2.slots.custom).toEqual([]);
  });

  it("F3 is 8 members (5 targeted), 10 slots with 2 custom, weekday presets and 30 days of reviews", () => {
    const f3 = parse(F3);
    expect(f3.members).toHaveLength(8);
    expect(f3.members.filter((m) => m.targets !== undefined)).toHaveLength(5);
    expect(f3.slots.active.length + f3.slots.custom.length).toBe(10);
    expect(f3.slots.custom).toHaveLength(2);
    expect(f3.presets.length).toBeGreaterThanOrEqual(2);
    expect(f3.presets.every((p) => (p.appliesToWeekdays?.length ?? 0) > 0)).toBe(true);
    const days = new Set(f3.reviews.map((r) => r.createdAt.slice(0, 10)));
    expect(days.size).toBe(F3_REVIEW_DAYS);
    expect(f3.reviews).toHaveLength(F3_REVIEW_DAYS * F3_REVIEWS_PER_DAY);
    // Deterministic: the generator gives the same reviews on every import.
    expect(JSON.stringify(parse(F3).reviews)).toBe(JSON.stringify(f3.reviews));
    expect(FixtureCatalogSchema.safeParse(fixtureCatalog).success).toBe(true);
  });

  it("every catalogue reference of the fixtures exists in the fixture catalogue", () => {
    const cuisines = new Set(fixtureCatalog.cuisines.map((c) => c.key));
    const methods = new Set(fixtureCatalog.methods.map((m) => m.key));
    const ingredients = new Set(fixtureCatalog.ingredients.map((i) => i.slug));
    for (const f of [F1, F2, F3].map(parse)) {
      for (const key of [...f.cuisines.liked, ...f.cuisines.disliked])
        expect(cuisines.has(key), key).toBe(true);
      for (const d of f.dishes) {
        expect(cuisines.has(d.cuisine), d.cuisine).toBe(true);
        for (const v of d.components.flatMap((c) => c.variants)) {
          expect(methods.has(v.method), v.method).toBe(true);
          for (const line of v.ingredients)
            expect(ingredients.has(line.slug), line.slug).toBe(true);
        }
      }
    }
  });

  it("weekdays are 0 = Monday", () => {
    expect(weekdayOf("2026-09-28")).toBe(0); // a Monday
    expect(weekdayOf("2026-10-04")).toBe(6); // a Sunday
  });

  it("negative control: a dangling reference, a missing admin or an invalid target is rejected", () => {
    const f1 = structuredClone(F1);
    expect(
      FixtureSchema.safeParse({
        ...f1,
        schedules: [{ member: "nobody", slot: "lunch", weekdays: [0], attends: true }],
      }).success,
    ).toBe(false);
    expect(
      FixtureSchema.safeParse({ ...f1, users: f1.users.map((u) => ({ ...u, role: "member" })) })
        .success,
    ).toBe(false);
    const badTarget = structuredClone(F2);
    must(must(badTarget.members[0]).targets).default.kcal = -1;
    expect(FixtureSchema.safeParse(badTarget).success).toBe(false);
  });
});
