// CP3 finding 1: the day beam's bound pruning is exact. The day search with pruning keeps exactly
// the meals, dishes and plates of the same search solving every (state, candidate) pair.
import { describe, expect, it } from "vitest";
import { planDay } from "../../../src/planner/select/day.js";
import { servedOf } from "../../../src/planner/select/improve.js";
import { Run } from "../../../src/planner/select/run.js";
import { loadPortionSolver } from "../../../src/planner/solver/index.js";
import type { PlannedMeal, PlanFlag } from "../../../src/planner/select/index.js";
import { f1PlanConfig, F1_WEEK } from "./f1.js";
import { buildSeedLibrary } from "./library.js";
import { seedFiles } from "./seed-files.js";

async function days(prune: boolean, seed: number) {
  await loadPortionSolver();
  // Fresh dish objects, so neither run reuses the other's memoised solves.
  const lib = buildSeedLibrary(seedFiles());
  const run = new Run(f1PlanConfig(), lib.dishes, lib.adjusters, seed);
  run.prune = prune;
  const out = { flags: [] as PlanFlag[], generationRequests: [] };
  const meals: PlannedMeal[] = [];
  for (const date of F1_WEEK.slice(0, 3)) {
    const history = meals.map((m) => servedOf(run, m));
    meals.push(...(await planDay(run, date, history, [], { seed }, out)));
  }
  return { meals, flags: out.flags, solves: run.stats.solves };
}

describe("day beam pruning", () => {
  it("gives the same day plans as solving every pair (F1 Mon–Wed, two seeds)", async () => {
    for (const seed of [1, 2]) {
      const pruned = await days(true, seed);
      const full = await days(false, seed);
      expect(pruned.meals).toEqual(full.meals);
      expect(pruned.flags).toEqual(full.flags);
      expect(pruned.solves).toBeLessThan(full.solves);
    }
  }, 300_000);
});
