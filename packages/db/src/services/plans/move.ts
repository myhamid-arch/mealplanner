// Move a meal to another day (UX-4 "drag to move a dish between days", W-5 addendum; BLD-8 R-58,
// R-60; leaf-1.4.8 SPEC-Q-3). The meal keeps its dish and goes to the same slot and member scope on
// another planned draft day; a meal already there (the occupant) goes to the source day, so the two
// exchange. Both meals must pass the planner on their new date (hard filters, slot, attendance);
// if either is refused, the whole move is refused and nothing is written. The plates of every
// unlocked meal of both days are then re-solved in time order with the planner's own single-meal
// search (`swapOp`, PLN-13), so the R-28 kcal re-targeting of later slots sees the moved meal.
// Locked meals stay as they are and are context. One change set: `plan_meal.move`, the adjuster
// rows, and a `plan.swap_dish` per re-solved meal; undoing it restores both days.
import type { ChangeOp } from "@mealplanner/core/changes";
import type { PlannedMeal } from "@mealplanner/core/planner";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
import { applyChangeSet, type AppliedChangeSet } from "../changes/index.js";
import { PlanServiceError } from "./errors.js";
import { loadPlanInput } from "./load-input.js";
import { swapOp, type MealState } from "./meal.js";
import { adjusterRowsOp, type ChangeActorInput } from "./store.js";

/** Why a move is refused as a conflict with the state of the plan (the API answers 409). */
export type PlanMoveErrorCode = "locked" | "not_draft" | "history";

export class PlanMoveError extends Error {
  constructor(
    readonly code: PlanMoveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlanMoveError";
  }
}

type MealRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createRepos>["plan_meal"]["get"]>>>;
type DayRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createRepos>["plan_day"]["get"]>>>;

/** The checks of `plan_meal.move`, made first so that conflicts are typed (409) and explained. */
async function assertMovable(
  db: Executor,
  ctx: HouseholdContext,
  meal: MealRow,
  day: DayRow,
  what: string,
): Promise<void> {
  if (meal.locked) throw new PlanMoveError("locked", `${what} is locked; unlock it to move it`);
  if (meal.status !== "planned")
    throw new PlanMoveError("history", `${what} is already ${meal.status}`);
  if ((await createRepos(db, ctx).review.list({ planMealId: meal.id })).length > 0)
    throw new PlanMoveError("history", `${what} has reviews, so it stays on ${day.date}`);
  if (day.status !== "draft")
    throw new PlanMoveError(
      "not_draft",
      `the plan for ${day.date} is ${day.status === "published" ? "already sent to the kitchen" : day.status}`,
    );
}

export interface MoveResult extends AppliedChangeSet {
  /** The moved meal on its new date, then the exchanged meal on the source date, if any. */
  meals: Array<PlannedMeal & { id: string }>;
}

export async function moveMeal(
  db: Executor,
  ctx: HouseholdContext,
  args: { planMealId: string; toDate: string; by: ChangeActorInput },
): Promise<MoveResult> {
  const repos = createRepos(db, ctx);
  const meal = await repos.plan_meal.get({ id: args.planMealId });
  if (meal === null)
    throw new PlanServiceError("not_found", `plan meal ${args.planMealId} not found`);
  const fromDay = await repos.plan_day.get({ id: meal.planDayId });
  if (fromDay === null)
    throw new PlanServiceError("not_found", `plan day ${meal.planDayId} not found`);
  await assertMovable(db, ctx, meal, fromDay, "this meal");
  if (fromDay.date === args.toDate)
    throw new PlanServiceError("invalid", `the meal is already on ${args.toDate}`);
  const [toDay] = await repos.plan_day.list({ date: args.toDate });
  if (toDay === undefined)
    throw new PlanServiceError("refused", `${args.toDate} has no plan yet; plan that day first`);
  if (toDay.status !== "draft")
    throw new PlanMoveError(
      "not_draft",
      `the plan for ${toDay.date} is ${toDay.status === "published" ? "already sent to the kitchen" : toDay.status}`,
    );
  const [occupant] = await repos.plan_meal.list({
    planDayId: toDay.id,
    slotTypeId: meal.slotTypeId,
    memberScope: meal.memberScope,
  });
  if (occupant !== undefined)
    await assertMovable(db, ctx, occupant, toDay, `the meal already on ${toDay.date}`);

  const { input, pool, stored } = await loadPlanInput(db, ctx, {
    dates: [fromDay.date, toDay.date],
  });
  const newDate = new Map<string, string>([[meal.id, toDay.date]]);
  if (occupant !== undefined) newDate.set(occupant.id, fromDay.date);
  const state: MealState = {
    config: input.config,
    pool,
    stored: stored.map((m) => ({ ...m, date: newDate.get(m.id) ?? m.date })),
  };

  const ops: ChangeOp[] = [];
  const solved: Array<PlannedMeal & { id: string }> = [];
  for (const date of [fromDay.date, toDay.date].sort()) {
    // `stored` is in time order within a date; each re-solve sees the meals before it (R-28).
    for (const m of state.stored.filter((x) => x.date === date && !x.locked)) {
      const moving = newDate.has(m.id);
      const dish = pool.byId.get(m.dishId);
      const where = `${m.slotLabel.toLowerCase()} on ${date}`;
      if (dish === undefined || dish.status !== "active") {
        if (moving)
          throw new PlanServiceError("refused", `${dish?.name ?? "The dish"} is no longer active`);
        continue;
      }
      const swap = await swapOp(state, m, dish);
      if (swap === null)
        throw new PlanServiceError(
          "refused",
          `${dish.name} cannot be the ${where} (exclusions, never-preferences, slot or attendance)`,
        );
      ops.push(swap.op);
      const next = { ...swap.solved, id: m.id, locked: m.locked };
      solved.push(next);
      state.stored = state.stored.map((x) => (x.id === m.id ? next : x));
    }
  }

  const slotLabel = solved.find((m) => m.id === meal.id)?.slotLabel ?? "meal";
  const applied = await applyChangeSet(db, ctx, {
    actor: args.by.actor,
    source: args.by.source,
    summary:
      occupant === undefined
        ? `Move ${slotLabel.toLowerCase()} from ${fromDay.date} to ${toDay.date}`
        : `Exchange ${slotLabel.toLowerCase()} of ${fromDay.date} and ${toDay.date}`,
    ops: [
      { kind: "plan_meal.move", payload: { planMealId: meal.id, toDate: toDay.date } },
      ...(await adjusterRowsOp(db, ctx, solved)),
      ...ops,
    ],
  });
  const order = [meal.id, ...(occupant === undefined ? [] : [occupant.id])];
  return {
    ...applied,
    meals: order.flatMap((id) => solved.filter((m) => m.id === id)),
  };
}
