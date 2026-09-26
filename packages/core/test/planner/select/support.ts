// Shared test support: the seed library, F1 plans memoised per file, and small config helpers.
import { planDays, type PlanDish, type PlanResult } from "../../../src/planner/index.js";
import type { HouseholdConfig, MealOverrideRow } from "../../../src/types/index.js";
import { f1PlanConfig, F1_WEEK, slotId } from "./f1.js";
import { buildSeedLibrary, type SeedLibrary } from "./library.js";
import { seedFiles } from "./seed-files.js";

let library: SeedLibrary | undefined;
export function seedLibrary(): SeedLibrary {
  library ??= buildSeedLibrary(seedFiles());
  return library;
}

export const MONDAY = F1_WEEK[0];
export const TUESDAY = F1_WEEK[1];

export async function planF1(
  dates: readonly string[],
  opts: { seed?: number; config?: HouseholdConfig; dishes?: PlanDish[] } = {},
): Promise<PlanResult> {
  const lib = seedLibrary();
  return planDays(
    {
      config: opts.config ?? f1PlanConfig(),
      dates,
      dishes: opts.dishes ?? lib.dishes,
      adjusters: lib.adjusters,
    },
    { seed: opts.seed ?? 1 },
  );
}

export function override(
  date: string,
  slotKey: string,
  kind: MealOverrideRow["kind"],
  memberIds: string[],
): MealOverrideRow {
  return {
    id: `override-${date}-${slotKey}-${kind}`,
    householdId: "household-test",
    planDate: date,
    slotTypeId: slotId(slotKey),
    kind,
    memberIds,
    createdBy: "user-admin",
    createdAt: new Date(0),
  };
}

/** Every plate of the plan with its meal. */
export function platesOf(plan: PlanResult) {
  return plan.days.flatMap((d) =>
    d.meals.flatMap((meal) => meal.plates.map((plate) => ({ meal, plate }))),
  );
}

/**
 * A plan without its run counters (wall-clock time, and solves and cache hits, which depend on
 * what earlier runs in the process memoised), for equality checks.
 */
export function stable(plan: PlanResult): unknown {
  return { ...plan, stats: { ...plan.stats, ms: 0, solves: 0, cacheHits: 0 } };
}
