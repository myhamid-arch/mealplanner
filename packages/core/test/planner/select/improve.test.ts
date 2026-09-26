// PLN-11 improvement pass: the incremental swap delta equals the change of the full week total.
import { describe, expect, it } from "vitest";
import { specOf, swapDelta, weekTotal } from "../../../src/planner/select/improve.js";
import { Run } from "../../../src/planner/select/run.js";
import type { PlannedMeal } from "../../../src/planner/select/index.js";
import { f1PlanConfig } from "./f1.js";
import { MONDAY, TUESDAY, planF1, seedLibrary } from "./support.js";

describe("swapDelta", () => {
  it("matches weekTotal(after) − weekTotal(before) for every meal and 3 alternatives each", async () => {
    const plan = await planF1([MONDAY, TUESDAY]);
    const lib = seedLibrary();
    const run = new Run(f1PlanConfig(), lib.dishes, lib.adjusters, 1);
    const meals: PlannedMeal[] = plan.days.flatMap((d) => d.meals);
    const before = weekTotal(run, meals, []);
    let checked = 0;
    meals.forEach((meal, i) => {
      const spec = specOf(run, meal);
      if (spec === null) return;
      const delta = swapDelta(run, meals, i, []);
      const alternatives = run
        .eligiblePool(spec)
        .filter((d) => d.id !== meal.dishId)
        .slice(0, 3)
        .map((d) => run.evaluate(spec, d));
      for (const c of alternatives) {
        const swapped = { ...meal, dishId: c.dish.id, plates: c.plates };
        const after = weekTotal(
          run,
          meals.map((m, j) => (j === i ? swapped : m)),
          [],
        );
        expect(delta(swapped)).toBeCloseTo(after - before, 9);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(40);
  }, 180_000);
});
