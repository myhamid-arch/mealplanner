// Leaf 1.4.8 G3 (W-7; BLD-8 R-58, R-60 SPEC-Q-1). For F1 over the reference week, every targeted
// member's slot kcal (and P/C/F) targets sum exactly to the day target of the day kind's profile,
// on both day kinds. The 2146 vs 2150 case is reproduced: the targets stored on plates are the
// R-28 re-targeted ones (slot target − the kcal deviation of the member's earlier plates), so a
// screen that sums them does not get the day target. Screens take the day target from the profile.
import { beforeAll, describe, expect, it } from "vitest";
import type { PlanResult } from "../../../src/planner/index.js";
import { resolveSlotTargets } from "../../../src/planner/targets/index.js";
import { dayKindOf } from "../../../src/planner/targets/day.js";
import { f1PlanConfig, F1_WEEK } from "../select/f1.js";
import { planF1, platesOf } from "../select/support.js";

const cfg = f1PlanConfig();
const targeted = cfg.members.filter((m) => m.isTargeted && m.archivedAt === null);

function profile(memberId: string, date: string) {
  const kind = dayKindOf(cfg, memberId, date);
  const own = cfg.targetProfiles.filter((p) => p.memberId === memberId);
  const p = own.find((x) => x.kind === kind) ?? own.find((x) => x.kind === "default");
  if (p === undefined) throw new Error(`no profile for ${memberId}`);
  return { kind, p };
}

describe("W-7: slot targets sum to the day target (F1, full week)", () => {
  it("every targeted member, every day and both day kinds: Σ slot kcal/P/C/F = the profile", () => {
    const kinds = new Set<string>();
    for (const date of F1_WEEK)
      for (const m of targeted) {
        const { kind, p } = profile(m.id, date);
        kinds.add(`${m.id}:${kind}`);
        const slots = resolveSlotTargets(cfg, date).filter((t) => t.memberId === m.id);
        const sum = (k: "kcal" | "protein" | "carbs" | "fat") =>
          slots.reduce((a, t) => a + t[k], 0);
        expect([date, m.id, sum("kcal")]).toEqual([date, m.id, p.kcal]);
        expect(sum("protein")).toBe(p.proteinG);
        expect(sum("carbs")).toBe(p.carbsG);
        expect(sum("fat")).toBe(p.fatG);
      }
    // Both targeted adults are seen on a default and a training day.
    for (const m of targeted) {
      expect(kinds.has(`${m.id}:default`)).toBe(true);
      expect(kinds.has(`${m.id}:training`)).toBe(true);
    }
  });
});

// 1.2.7 (R-73): the plan changed once with W-17's natural keys (2146 became 2147), so the case
// asserts what W-7 is about, a stored sum that misses the day target, and prints the sum.
describe("W-7: the stored sum vs 2150 case (F1 seed 1)", () => {
  let plan: PlanResult;
  beforeAll(async () => {
    plan = await planF1([...F1_WEEK]);
  }, 600_000);

  const storedSum = (date: string, memberId: string) =>
    platesOf(plan)
      .filter((x) => x.meal.date === date && x.plate.memberId === memberId)
      .reduce((a, x) => a + (x.plate.target?.kcal ?? 0), 0);

  it("reproduced: Sunday adult_a's plate targets do not sum to the 2150 of his rest day", () => {
    const sunday = F1_WEEK[6];
    expect(profile("adult_a", sunday)).toMatchObject({ kind: "default", p: { kcal: 2150 } });
    const stored = Math.round(storedSum(sunday, "adult_a"));
    console.log(`W-7: Sunday adult_a's stored plate targets sum to ${String(stored)} kcal`);
    expect(stored).not.toBe(2150);
    // The resolver's own targets on those plates do sum to 2150.
    const resolver = platesOf(plan)
      .filter((x) => x.meal.date === sunday && x.plate.memberId === "adult_a")
      .reduce((a, x) => a + (x.plate.resolverTarget?.kcal ?? 0), 0);
    expect(resolver).toBe(2150);
  });

  it("summing plate targets misses the day target on several member-days, not only Sunday", () => {
    let differs = 0;
    for (const date of F1_WEEK)
      for (const m of targeted)
        if (Math.round(storedSum(date, m.id)) !== profile(m.id, date).p.kcal) differs += 1;
    expect(differs).toBeGreaterThan(1);
  });
});
