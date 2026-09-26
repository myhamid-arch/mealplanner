// R2-MEAL-1/2 and SPEC-Q-10: shared and individual meals, meal overrides, planning order.
import { describe, expect, it } from "vitest";
import { mealsOfDate } from "../../../src/planner/select/index.js";
import { f1PlanConfig } from "./f1.js";
import { MONDAY, override } from "./support.js";

const summary = (specs: ReturnType<typeof mealsOfDate>) =>
  specs.map(
    (s) => `${s.slot.key}/${s.memberScope}:${s.attendees.join("+")}${s.split ? "(split)" : ""}`,
  );

describe("mealsOfDate", () => {
  it("F1 Monday: shared meals first in time order, then individual meals per member", () => {
    const specs = mealsOfDate(f1PlanConfig(), MONDAY);
    expect(summary(specs)).toEqual([
      "breakfast/shared:adult_a+adult_b+c1+c2+c3",
      "packed_school_lunch/shared:c1+c2+c3",
      "packed_work_lunch/shared:adult_a",
      "lunch/shared:adult_b",
      "dinner/shared:adult_a+adult_b+c1+c2+c3",
      "snack/adult_a:adult_a",
      "pre_workout/adult_a:adult_a",
      "post_workout/adult_a:adult_a",
      "snack/adult_b:adult_b",
      "snack/c1:c1",
      "snack/c2:c2",
      "snack/c3:c3",
    ]);
  });

  it("split_member takes members out of the shared meal into their own", () => {
    const cfg = f1PlanConfig();
    cfg.mealOverrides = [override(MONDAY, "dinner", "split_member", ["c3", "adult_b"])];
    const specs = mealsOfDate(cfg, MONDAY);
    const dinner = specs.filter((s) => s.slot.key === "dinner");
    expect(summary(dinner)).toEqual([
      "dinner/shared:adult_a+c1+c2",
      "dinner/adult_b:adult_b(split)",
      "dinner/c3:c3(split)",
    ]);
    expect(dinner[0]?.splitMembers).toEqual(["adult_b", "c3"]);
  });

  it("make_individual gives every attendee their own meal", () => {
    const cfg = f1PlanConfig();
    cfg.mealOverrides = [override(MONDAY, "breakfast", "make_individual", [])];
    const breakfast = mealsOfDate(cfg, MONDAY).filter((s) => s.slot.key === "breakfast");
    expect(breakfast.map((s) => [s.kind, s.memberScope])).toEqual([
      ["individual", "adult_a"],
      ["individual", "adult_b"],
      ["individual", "c1"],
      ["individual", "c2"],
      ["individual", "c3"],
    ]);
  });

  it("an override for another date or slot changes nothing", () => {
    const cfg = f1PlanConfig();
    cfg.mealOverrides = [override("2026-09-29", "dinner", "make_individual", [])];
    expect(summary(mealsOfDate(cfg, MONDAY))).toEqual(summary(mealsOfDate(f1PlanConfig(), MONDAY)));
  });

  it("a split of every attendee leaves no shared meal", () => {
    const cfg = f1PlanConfig();
    cfg.mealOverrides = [override(MONDAY, "lunch", "split_member", ["adult_b"])];
    const lunch = mealsOfDate(cfg, MONDAY).filter((s) => s.slot.key === "lunch");
    expect(summary(lunch)).toEqual(["lunch/adult_b:adult_b(split)"]);
  });
});
