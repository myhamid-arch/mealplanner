// R2-MEAL-2 through the planner (PLN-11 honours meal_override; 11 §5 r2 addition for 1.2.3).
import { describe, expect, it } from "vitest";
import { f1PlanConfig } from "./f1.js";
import { MONDAY, override, planF1 } from "./support.js";

describe("meal overrides in planDays", () => {
  it("split_member: split members get their own meal; the shared meal lists them and keeps the rest", async () => {
    const cfg = f1PlanConfig();
    cfg.mealOverrides = [override(MONDAY, "dinner", "split_member", ["adult_b", "c3"])];
    const plan = await planF1([MONDAY], { config: cfg });
    const dinners = plan.days[0]?.meals.filter((m) => m.slotKey === "dinner") ?? [];
    const shared = dinners.find((m) => m.kind === "shared");
    expect(shared?.attendees).toEqual(["adult_a", "c1", "c2"]);
    expect(shared?.splitMembers).toEqual(["adult_b", "c3"]);
    expect(shared?.plates.map((p) => p.memberId)).toEqual(["adult_a", "c1", "c2"]);
    for (const m of ["adult_b", "c3"]) {
      const own = dinners.find((x) => x.memberScope === m);
      expect(own).toMatchObject({ kind: "individual", split: true, attendees: [m] });
      expect(own?.plates.map((p) => p.memberId)).toEqual([m]);
    }
    const b = dinners.find((x) => x.memberScope === "adult_b")?.plates[0];
    expect(b?.targeted).toBe(true);
    expect(plan.memberDays.find((d) => d.memberId === "adult_b")?.flaggedSlots).not.toContain(
      "dinner",
    );
  }, 120_000);

  it("make_individual: every attendee of the slot gets an individual meal", async () => {
    const cfg = f1PlanConfig();
    cfg.mealOverrides = [override(MONDAY, "breakfast", "make_individual", [])];
    const plan = await planF1([MONDAY], { config: cfg });
    const breakfasts = plan.days[0]?.meals.filter((m) => m.slotKey === "breakfast") ?? [];
    expect(breakfasts.map((m) => [m.kind, m.memberScope, m.attendees.join()])).toEqual([
      ["individual", "adult_a", "adult_a"],
      ["individual", "adult_b", "adult_b"],
      ["individual", "c1", "c1"],
      ["individual", "c2", "c2"],
      ["individual", "c3", "c3"],
    ]);
  }, 120_000);
});
