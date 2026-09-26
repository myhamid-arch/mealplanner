// PLN-14 cook sheet: batch raw totals equal the sum of plate raw equivalents, the plating table
// covers every attendee, R2-UX-2 allergy banners, the NUT-6 banner, and a snapshot of the F1 Monday
// sheet.
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildCookSheet,
  NUT6_BANNER,
  type CookSheet,
  type PlanResult,
} from "../../../src/planner/index.js";
import { MONDAY, planF1, seedLibrary } from "./support.js";

let plan: PlanResult;
let sheet: CookSheet;

beforeAll(async () => {
  plan = await planF1([MONDAY]);
  sheet = buildCookSheet(plan, seedLibrary().catalog);
}, 120_000);

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

describe("buildCookSheet", () => {
  it("has one meal per planned meal and the NUT-6 banner", () => {
    expect(sheet.banner).toEqual(NUT6_BANNER);
    expect(sheet.days.map((d) => d.meals.length)).toEqual(plan.days.map((d) => d.meals.length));
  });

  it("batch raw quantities equal the sum of the plates' raw equivalents, per variant and ingredient", () => {
    for (const meal of sheet.days.flatMap((d) => d.meals)) {
      for (const b of meal.batches) {
        const fromPlates = new Map<string, number>();
        let grams = 0;
        let servings = 0;
        for (const p of meal.plates)
          for (const x of b.kind === "component" ? p.items : p.adjusters)
            if (x.variantId === b.variantId) {
              grams += x.cookedG;
              servings++;
              for (const [id, g] of Object.entries(x.rawEquivalent))
                fromPlates.set(id, (fromPlates.get(id) ?? 0) + g);
            }
        expect(b.totalCookedG).toBe(grams);
        expect(b.servings).toBe(servings);
        const batch = new Map<string, number>();
        for (const r of [...b.raw, ...b.discardedFat])
          batch.set(r.ingredientId, (batch.get(r.ingredientId) ?? 0) + r.rawG);
        expect([...batch.keys()].sort()).toEqual([...fromPlates.keys()].sort());
        for (const [id, g] of batch) expect(g).toBeCloseTo(fromPlates.get(id) ?? NaN, 6);
      }
    }
  });

  it("the plating table has a row for every attendee and a column for every component", () => {
    for (const day of plan.days)
      for (const m of day.meals) {
        const cm = sheet.days
          .find((d) => d.date === day.date)
          ?.meals.find((x) => x.slotKey === m.slotKey && x.memberScope === m.memberScope);
        expect(cm?.plating.rows.map((r) => r.memberId).sort()).toEqual([...m.attendees].sort());
        const dish = plan.dishes[m.dishId];
        expect(cm?.plating.columns.map((c) => c.componentId)).toEqual(
          dish?.components.map((c) => c.id),
        );
        for (const row of cm?.plating.rows ?? []) {
          const plate = m.plates.find((p) => p.memberId === row.memberId);
          const served = row.cells.filter((c) => c.cookedG > 0);
          expect(served.map((c) => [c.componentId, c.variantId, c.cookedG])).toEqual(
            plate?.solution.items.map((i) => [i.componentId, i.variantId, i.cookedG]),
          );
          expect(row.sides.map((s) => s.label)).toEqual(
            plate?.solution.adjusters.map(() => `+ side for ${row.memberName}`),
          );
        }
      }
  });

  it("shows C3's sesame allergy banner at every meal C3 attends, with no batch containing sesame", () => {
    for (const cm of sheet.days.flatMap((d) => d.meals)) {
      const attends = cm.plating.rows.some((r) => r.memberId === "c3");
      const banners = cm.allergyBanners.filter((b) => b.memberId === "c3");
      expect(banners.length).toBe(attends ? 1 : 0);
      for (const b of banners) {
        expect(b.text).toBe("Child C3: no sesame. Plate Child C3's first, separate spoon.");
        expect(b.presentIn).toEqual([]);
      }
    }
  });

  it("notes packed handling", () => {
    const school = sheet.days[0]?.meals.find((m) => m.slotKey === "packed_school_lunch");
    expect(school?.notes.some((n) => n.includes("no reheating"))).toBe(true);
  });

  it("matches the snapshot of the F1 Monday sheet", () => {
    const compact = sheet.days.map((d) => ({
      date: d.date,
      meals: d.meals.map((m) => ({
        meal: `${m.time} ${m.slotKey}/${m.memberScope}: ${m.dishName}`,
        batches: m.batches.map(
          (b) =>
            `${b.kind} ${b.variantId} ${String(b.totalCookedG)} g cooked x${String(b.servings)}: ` +
            b.raw.map((r) => `${r.slug} ${String(round(r.rawG))}`).join(", ") +
            (b.discardedFat.length > 0
              ? ` | frying fat ${b.discardedFat.map((r) => `${r.slug} ${String(round(r.rawG))}`).join(", ")}`
              : ""),
        ),
        plating: m.plating.rows.map(
          (r) =>
            `${r.memberName}: ${r.cells.map((c) => `${c.variantLabel ?? "-"} ${String(c.cookedG)}`).join(" | ")}` +
            (r.sides.length > 0
              ? ` ${r.sides.map((s) => `${s.label} ${s.dishName} ${String(s.cookedG)}`).join("; ")}`
              : ""),
        ),
        notes: m.notes,
        allergy: m.allergyBanners.map((b) => b.text),
      })),
    }));
    expect(compact).toMatchSnapshot();
  });
});
