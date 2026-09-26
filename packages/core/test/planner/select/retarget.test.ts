// R-28 / ADR-1 §2 invariant, tested directly (R-34): with target kcal = resolver kcal − D and
// tolerance Bᵢ (the cumulative band), an in-tolerance plate at slot i keeps the running deviation
// within ±Bᵢ, so a member-day of in-tolerance plates ends within ±tolerance.kcal.
import { describe, expect, it } from "vitest";
import { retargeted } from "../../../src/planner/select/index.js";
import { mulberry32 } from "../../../src/planner/select/rng.js";
import type { SlotTarget } from "../../../src/planner/targets/index.js";
import { MONDAY, planF1, platesOf } from "./support.js";

const base = (kcal: number, band: number): SlotTarget => ({
  memberId: "m",
  date: MONDAY,
  slotKey: "s",
  slotTypeId: "slot:s",
  dayKind: "default",
  kcal,
  protein: 30,
  carbs: 40,
  fat: 10,
  tol: { kcal: band, protein: 5, carbs: 5, fat: 2 },
  mode: "strict",
  carbBasis: "total",
});

/** Splits `total` into `n` positive integer bands. */
function bands(rand: () => number, n: number, total: number): number[] {
  const w = Array.from({ length: n }, () => 0.2 + rand());
  const s = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.max(1, Math.floor((x / s) * total)));
  out[n - 1] = (out[n - 1] ?? 0) + total - out.reduce((a, b) => a + b, 0);
  return out;
}

describe("kcal re-targeting invariant", () => {
  it("keeps |D| ≤ Bᵢ after every slot and ≤ the daily band at the end (10,000 random days)", () => {
    const rand = mulberry32(20260926);
    for (let trial = 0; trial < 10_000; trial++) {
      const n = 2 + Math.floor(rand() * 6);
      const daily = 20 + Math.floor(rand() * 80);
      const b = bands(rand, n, daily);
      let d = 0;
      let cumulative = 0;
      for (let i = 0; i < n; i++) {
        const t0 = 200 + rand() * 600;
        cumulative += b[i] ?? 0;
        const t = retargeted(base(t0, b[i] ?? 0), d, cumulative);
        expect(t.tol.kcal).toBe(cumulative);
        // Any plate in tolerance: actual kcal anywhere in [t − Bᵢ, t + Bᵢ], extremes included.
        const u = rand();
        const pick = u < 0.1 ? -1 : u < 0.2 ? 1 : 2 * rand() - 1;
        const actual = t.kcal + pick * t.tol.kcal;
        d += actual - t0;
        expect(Math.abs(d)).toBeLessThanOrEqual(cumulative + 1e-9);
      }
      expect(Math.abs(d)).toBeLessThanOrEqual(daily + 1e-9);
    }
  });

  it("changes only kcal and its tolerance", () => {
    const t = retargeted(base(500, 10), 7, 25);
    expect(t.kcal).toBe(493);
    expect(t.tol).toEqual({ kcal: 25, protein: 5, carbs: 5, fat: 2 });
    expect({ ...t, kcal: 500, tol: base(500, 10).tol }).toEqual(base(500, 10));
  });

  it("negative control: the cumulative band without moving the target can end outside the daily band", () => {
    const b = [10, 15, 25];
    let d = 0;
    let cumulative = 0;
    for (const bi of b) {
      cumulative += bi;
      d += cumulative; // each plate at +Bᵢ around the unmoved resolver target
    }
    expect(Math.abs(d)).toBeGreaterThan(50);
  });

  it("on an F1 day, every member-day without a flagged slot is within ±tolerance.kcal and plates carry the re-targeted window", async () => {
    const plan = await planF1([MONDAY]);
    expect(plan.memberDays.map((m) => m.memberId).sort()).toEqual(["adult_a", "adult_b"]);
    for (const md of plan.memberDays) {
      if (md.flaggedSlots.length === 0) expect(md.within).toBe(true);
      expect(md.band).toBe(50);
    }
    for (const { plate } of platesOf(plan).filter((x) => x.plate.targeted)) {
      const t = plate.target as SlotTarget;
      const r = plate.resolverTarget as SlotTarget;
      expect(t.tol.kcal).toBeGreaterThanOrEqual(r.tol.kcal);
      expect([t.protein, t.carbs, t.fat, t.tol.protein, t.tol.carbs, t.tol.fat]).toEqual([
        r.protein,
        r.carbs,
        r.fat,
        r.tol.protein,
        r.tol.carbs,
        r.tol.fat,
      ]);
      if (plate.fitStatus === "in_tolerance")
        expect(Math.abs(plate.solution.actual.kcal - t.kcal)).toBeLessThanOrEqual(
          t.tol.kcal + 1e-6,
        );
    }
  }, 60_000);
});
