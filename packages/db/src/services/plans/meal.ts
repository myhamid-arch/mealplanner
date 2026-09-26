// One meal at a time (PLN-13): the top alternatives for a meal, a swap, and re-solving a meal's
// plates with its dish kept (`plates.resolve`, `plates.substitute`). Each runs the planner's own
// search (`planDays`, 04 §11) on the meal's date with every other meal of the date locked and the
// candidate pool narrowed to one dish, so hard filters, adjusters, variant choice, kcal
// re-targeting (R-28) and scoring (PLN-9) are exactly the planner's. Dishes of the other meals stay
// in the pool as non-plannable copies (status `retired`), so they still count as context for
// economy and variety without becoming candidates. AI generation is off for these runs.
import {
  buildCookSheet,
  planDays,
  type PlanDish,
  type PlannedMeal,
  type PlanResult,
} from "@mealplanner/core/planner";
import type { ChangeOp } from "@mealplanner/core/changes";
import type { HouseholdConfig, HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
import { applyChangeSet, type AppliedChangeSet } from "../changes/index.js";
import { addDays, loadPlanInput, type PlanPool } from "./load-input.js";
import { adjusterRowsOp, cookMealOf, mealRows, type ChangeActorInput } from "./store.js";
import { PlanServiceError } from "./errors.js";

/** PLN-13: alternatives shown for a swap. */
export const ALTERNATIVES = 5;
/** Seed for single-meal runs: deterministic results for the same state (PLN-11). */
export const MEAL_SEED = 1;

type StoredMeal = PlannedMeal & { id: string };

export interface MealState {
  config: HouseholdConfig;
  pool: PlanPool;
  stored: StoredMeal[];
}

function withoutAi(config: HouseholdConfig): HouseholdConfig {
  return {
    ...config,
    planningWeights: { ...config.planningWeights, aiGeneration: "off" },
    weightPresets: config.weightPresets.map((p) => {
      const values = { ...(p.values as Record<string, unknown>) };
      delete values.aiGeneration;
      return { ...p, values: values as typeof p.values };
    }),
  };
}

function retired(d: PlanDish): PlanDish {
  return { ...d, status: "retired" };
}

/** Plans `target`'s slot on its date with only `dish` as a candidate; null if the dish is refused. */
export async function solveMealWith(
  state: MealState,
  target: { date: string; slotTypeId: string; memberScope: string },
  dish: PlanDish,
): Promise<{ meal: PlannedMeal; result: PlanResult } | null> {
  const others = state.stored.filter(
    (m) =>
      m.date === target.date &&
      !(m.slotTypeId === target.slotTypeId && m.memberScope === target.memberScope),
  );
  const context = state.stored.filter((m) => m.date !== target.date);
  const contextDishes = new Set([...others, ...context].map((m) => m.dishId));
  contextDishes.delete(dish.id);
  const dishes = [
    dish,
    ...[...contextDishes].flatMap((id) => {
      const d = state.pool.byId.get(id);
      return d === undefined ? [] : [retired(d)];
    }),
  ];
  const result = await planDays(
    {
      config: withoutAi(state.config),
      dates: [target.date],
      dishes,
      adjusters: state.pool.adjusters,
      locked: others.map((m) => ({ ...m, locked: true })),
      context,
    },
    { seed: MEAL_SEED },
  );
  const meal = result.days
    .flatMap((d) => d.meals)
    .find(
      (m) =>
        m.slotTypeId === target.slotTypeId &&
        m.memberScope === target.memberScope &&
        m.dishId === dish.id,
    );
  return meal === undefined ? null : { meal, result };
}

export async function loadMealState(
  db: Executor,
  ctx: HouseholdContext,
  planMealId: string,
): Promise<MealState & { meal: StoredMeal }> {
  const row = await createRepos(db, ctx).plan_meal.get({ id: planMealId });
  if (row === null) throw new PlanServiceError("not_found", `plan meal ${planMealId} not found`);
  const day = await createRepos(db, ctx).plan_day.get({ id: row.planDayId });
  if (day === null) throw new PlanServiceError("not_found", `plan day ${row.planDayId} not found`);
  const { input, pool, stored } = await loadPlanInput(db, ctx, { dates: [day.date] });
  const meal = stored.find((m) => m.id === planMealId);
  if (meal === undefined)
    throw new PlanServiceError("not_found", `plan meal ${planMealId} is not on a configured slot`);
  return { config: input.config, pool, stored, meal };
}

/** A superset of PLN-9 §6.3 slot suitability, to avoid solving dishes that cannot qualify. */
function mayServe(dish: PlanDish, slotKey: string, isPacked: boolean): boolean {
  return (
    dish.status === "active" && (dish.slotKeys.includes(slotKey) || (isPacked && dish.isPackable))
  );
}

export interface Alternative {
  dishId: string;
  dishName: string;
  meal: PlannedMeal;
}

/** PLN-13: the top alternatives for a meal, best score first, each with its re-solved plates. */
export async function planAlternatives(
  db: Executor,
  ctx: HouseholdContext,
  planMealId: string,
  limit = ALTERNATIVES,
): Promise<{ current: PlannedMeal; alternatives: Alternative[] }> {
  const state = await loadMealState(db, ctx, planMealId);
  const { meal } = state;
  const out: Alternative[] = [];
  for (const dish of state.pool.dishes) {
    if (dish.id === meal.dishId || !mayServe(dish, meal.slotKey, meal.isPacked)) continue;
    const solved = await solveMealWith(state, meal, dish);
    if (solved !== null) out.push({ dishId: dish.id, dishName: dish.name, meal: solved.meal });
  }
  out.sort(
    (a, b) =>
      b.meal.scoreBreakdown.total - a.meal.scoreBreakdown.total || a.dishId.localeCompare(b.dishId),
  );
  return { current: meal, alternatives: out.slice(0, limit) };
}

/** The `plan.swap_dish` op for a stored meal re-solved with `dish` (its own dish to re-solve). */
export async function swapOp(
  state: MealState,
  meal: StoredMeal,
  dish: PlanDish,
): Promise<{ op: ChangeOp; solved: PlannedMeal } | null> {
  const solved = await solveMealWith(state, meal, dish);
  if (solved === null) return null;
  const sheet = buildCookSheet(solved.result, state.pool.catalog.context);
  const rows = mealRows(solved.meal, cookMealOf(sheet, solved.meal), state.pool);
  return {
    op: {
      kind: "plan.swap_dish",
      payload: { planMealId: meal.id, dishId: dish.id, ...rows },
    } as ChangeOp,
    solved: solved.meal,
  };
}

/** PLN-13: swaps a meal's dish; the plates are re-solved. */
export async function swapMeal(
  db: Executor,
  ctx: HouseholdContext,
  args: { planMealId: string; dishId: string; by: ChangeActorInput },
): Promise<AppliedChangeSet & { meal: PlannedMeal }> {
  const state = await loadMealState(db, ctx, args.planMealId);
  const dish = state.pool.byId.get(args.dishId);
  if (dish === undefined || dish.status !== "active")
    throw new PlanServiceError("invalid", `dish ${args.dishId} cannot be planned`);
  const swap = await swapOp(state, state.meal, dish);
  if (swap === null)
    throw new PlanServiceError(
      "refused",
      `${dish.name} is not allowed for this meal (exclusions, never-preferences or slot)`,
    );
  const applied = await applyChangeSet(db, ctx, {
    actor: args.by.actor,
    source: args.by.source,
    summary: `Swap ${state.meal.slotLabel} on ${state.meal.date} to ${dish.name}`,
    ops: [...(await adjusterRowsOp(db, ctx, [swap.solved])), swap.op],
  });
  return { ...applied, meal: swap.solved };
}

export interface ResolveReport {
  changeSetId: string | null;
  meals: number;
  /** Meals whose plates are now infeasible or a flexible miss (PLN-13: the agent proposes swaps). */
  flagged: Array<{ planMealId: string; date: string; slotKey: string; memberIds: string[] }>;
  /** Meals left unchanged, with why (dish retired, slot gone, dish no longer allowed). */
  skipped: Array<{ planMealId: string; reason: string }>;
}

/**
 * `plates.resolve` (ARC-7, PLN-13): re-solves the plates of every stored meal from `fromDate` on,
 * keeping each meal's dish and lock, as one change set. `dishFor` may replace a meal's dish (the
 * substitution job passes a household copy of the dish).
 */
export async function resolvePlates(
  db: Executor,
  ctx: HouseholdContext,
  args: {
    fromDate: string;
    toDate?: string;
    by: ChangeActorInput;
    summary?: string;
    onlyMealIds?: ReadonlySet<string>;
    extraDishes?: readonly PlanDish[];
    dishFor?: (meal: StoredMeal) => string;
    leadingOps?: readonly ChangeOp[];
  },
): Promise<ResolveReport> {
  const to = args.toDate ?? addDays(args.fromDate, 60);
  const planDates = await storedDates(db, ctx, args.fromDate, to);
  const report: ResolveReport = { changeSetId: null, meals: 0, flagged: [], skipped: [] };
  if (planDates.length === 0 && (args.leadingOps ?? []).length === 0) return report;
  const ops: ChangeOp[] = [];
  const solvedMeals: PlannedMeal[] = [];
  for (const date of planDates) {
    const { input, pool, stored } = await loadPlanInput(db, ctx, { dates: [date] });
    for (const d of args.extraDishes ?? []) pool.byId.set(d.id, d);
    const state: MealState = { config: input.config, pool, stored };
    for (const meal of stored.filter((m) => m.date === date)) {
      if (args.onlyMealIds !== undefined && !args.onlyMealIds.has(meal.id)) continue;
      const dish = pool.byId.get(args.dishFor?.(meal) ?? meal.dishId);
      if (dish === undefined || dish.status !== "active") {
        report.skipped.push({ planMealId: meal.id, reason: "the dish is no longer active" });
        continue;
      }
      const swap = await swapOp(state, meal, dish);
      if (swap === null) {
        report.skipped.push({
          planMealId: meal.id,
          reason:
            "the dish is no longer allowed for this meal (exclusions, never-preferences or slot)",
        });
        continue;
      }
      ops.push(swap.op);
      solvedMeals.push(swap.solved);
      report.meals += 1;
      const off = swap.solved.plates.filter((p) => p.targeted && p.fitStatus !== "in_tolerance");
      if (off.length > 0)
        report.flagged.push({
          planMealId: meal.id,
          date: meal.date,
          slotKey: meal.slotKey,
          memberIds: off.map((p) => p.memberId),
        });
    }
  }
  if (ops.length === 0 && (args.leadingOps ?? []).length === 0) return report;
  const applied = await applyChangeSet(db, ctx, {
    actor: args.by.actor,
    source: args.by.source,
    summary: args.summary ?? `Re-solve plates from ${args.fromDate}`,
    ops: [...(args.leadingOps ?? []), ...(await adjusterRowsOp(db, ctx, solvedMeals)), ...ops],
  });
  report.changeSetId = applied.changeSetId;
  return report;
}

async function storedDates(
  db: Executor,
  ctx: HouseholdContext,
  from: string,
  to: string,
): Promise<string[]> {
  return (await createRepos(db, ctx).plan_day.list())
    .map((d) => d.date)
    .filter((d) => d >= from && d <= to)
    .sort();
}
