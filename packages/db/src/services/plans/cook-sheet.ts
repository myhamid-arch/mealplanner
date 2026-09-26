// The cook sheet of a stored day (PLN-14, R2-UX-2): the day's saved meals as planner output, run
// through the planner's `buildCookSheet` so the sheet is computed exactly as at generation time.
import {
  buildCookSheet,
  type CookSheet,
  type PlanMember,
  type PlanResult,
} from "@mealplanner/core/planner";
import type { HouseholdContext } from "@mealplanner/core/types";
import type { Executor } from "../../repos/index.js";
import { loadHouseholdConfig } from "../config/index.js";
import { loadPlanPool, loadPlannedMeals } from "./load-input.js";
import { createRepos } from "../../repos/index.js";

export interface StoredDay {
  sheet: CookSheet;
  plan: PlanResult;
  /** plan_meal ids of the day's meals, keyed `slotKey|memberScope`. */
  mealIds: Record<string, string>;
}

/** The stored meals of one date as a PlanResult, and its cook sheet. */
export async function cookSheetFor(
  db: Executor,
  ctx: HouseholdContext,
  date: string,
): Promise<StoredDay> {
  const config = await loadHouseholdConfig(db, ctx);
  const dishIds = new Set<string>();
  const day = (await createRepos(db, ctx).plan_day.list({ date }))[0];
  if (day !== undefined)
    for (const m of await createRepos(db, ctx).plan_meal.list({ planDayId: day.id }))
      dishIds.add(m.dishId);
  const pool = await loadPlanPool(db, ctx, { includeDishIds: [...dishIds] });
  const meals = await loadPlannedMeals(db, ctx, config, { from: date, to: date }, pool.byId);
  const members: PlanMember[] = config.members
    .filter((m) => m.archivedAt === null)
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      targeted: m.isTargeted,
      allergies: config.exclusions
        .filter((e) => e.reason === "allergy" && (e.memberId === null || e.memberId === m.id))
        .map((e) => ({ kind: e.kind, key: e.key })),
    }));
  const dishes: PlanResult["dishes"] = {};
  for (const m of meals) {
    const d = pool.byId.get(m.dishId);
    if (d !== undefined) dishes[d.id] = d;
    for (const p of m.plates)
      for (const a of p.solution.adjusters) {
        const ad = pool.byId.get(a.dishId);
        if (ad !== undefined) dishes[ad.id] = ad;
      }
  }
  const plan: PlanResult = {
    seed: 0,
    dates: [date],
    members,
    weights: {},
    days: [{ date, meals }],
    memberDays: [],
    flags: [],
    generationRequests: [],
    dishes,
    stats: { solves: 0, cacheHits: 0, infeasiblePlates: 0, improvementSwaps: 0, ms: 0 },
  };
  return {
    sheet: buildCookSheet(plan, pool.catalog.context),
    plan,
    mealIds: Object.fromEntries(meals.map((m) => [`${m.slotKey}|${m.memberScope}`, m.id])),
  };
}
