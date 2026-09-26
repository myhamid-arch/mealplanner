// Persisting planner output (R-2 wiring of PLN-11/13/14): a `PlanResult` and its `CookSheet` become
// one `plan.save_days` change set (BLD-8 R-10); a re-solved meal becomes `plan.swap_dish`. Plates
// carry `plate_item.raw_equivalent` and the meal's `cook_batch` rows from `buildCookSheet`
// (leaf-1.2.3 SPEC-Q-14). The stored JSON is what `loadPlannedMeals` reads back.
//
// Adjusters (leaf-1.4.1 SPEC-Q-21): the planner treats a global adjuster as enabled unless the
// household disabled it, while `plan.save_days` accepts only adjusters with an enabled
// `household_adjuster` row. A save therefore first materialises every used adjuster that has no row
// as an enabled row (`adjusters.set`), in the same change set: this writes down the default the
// planner already applied and changes no behaviour.
import type { ChangeOp } from "@mealplanner/core/changes";
import type { CookMeal, CookSheet, PlannedMeal, PlanResult } from "@mealplanner/core/planner";
import type { ChangeActor, ChangeSource, HouseholdContext, Json } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
import { applyChangeSet, type AppliedChangeSet } from "../changes/index.js";
import {
  toJson,
  type PlanPool,
  type StoredBreakdown,
  type StoredDeviation,
  type StoredTarget,
} from "./load-input.js";

/** Bumped when the planner's stored meal format or search changes (`plan_day.generator_version`). */
export const GENERATOR_VERSION = "1.4.1";

export interface ChangeActorInput {
  actor: ChangeActor;
  source: ChangeSource;
}

type Plate = {
  memberId: string;
  fitStatus: PlannedMeal["plates"][number]["fitStatus"];
  target: Json;
  actual: Json;
  deviation: Json;
  items: Array<{
    componentId: string;
    variantId: string;
    cookedG: number;
    rawEquivalent: Record<string, number>;
  }>;
};
type Batch = {
  variantId: string;
  totalCookedG: number;
  rawIngredients: Record<string, number>;
  servings: number;
};

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function grams(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, round3(v)]));
}

/** The plates and cook batches of one planned meal, from its cook-sheet meal. */
export function mealRows(
  meal: PlannedMeal,
  cook: CookMeal | undefined,
  pool: PlanPool,
): {
  scoreBreakdown: Json;
  plates: Plate[];
  cookBatches: Batch[];
} {
  const stored: StoredBreakdown = {
    ...meal.scoreBreakdown,
    meal: {
      kind: meal.kind,
      attendees: meal.attendees,
      splitMembers: meal.splitMembers,
      split: meal.split,
      frequencyRelaxed: meal.frequencyRelaxed,
      variantLimits: meal.variantLimits,
      explain: meal.explain,
    },
  };
  const plates: Plate[] = meal.plates.map((p) => {
    const raw = cook?.plates.find((r) => r.memberId === p.memberId);
    const target: StoredTarget =
      p.target === null ? { untargeted: true } : { ...p.target, resolver: p.resolverTarget };
    const deviation: StoredDeviation = {
      ...p.solution.deviation,
      shortfall: p.solution.shortfall,
      objective: p.solution.objective,
      fit: p.solution.fit,
      explain: p.solution.explain,
      flag: p.flag,
    };
    const items = p.solution.items.map((i) => ({
      componentId: i.componentId,
      variantId: i.variantId,
      cookedG: i.cookedG,
      rawEquivalent: grams(
        raw?.items.find((r) => r.componentId === i.componentId && r.variantId === i.variantId)
          ?.rawEquivalent ?? {},
      ),
    }));
    const sides = p.solution.adjusters.map((a) => {
      const componentId = pool.byId.get(a.dishId)?.components[0]?.id;
      if (componentId === undefined) throw new Error(`adjuster ${a.dishId} is not loaded`);
      return {
        componentId,
        variantId: a.variantId,
        cookedG: a.cookedG,
        rawEquivalent: grams(
          raw?.adjusters.find((r) => r.dishId === a.dishId && r.variantId === a.variantId)
            ?.rawEquivalent ?? {},
        ),
      };
    });
    return {
      memberId: p.memberId,
      fitStatus: p.fitStatus,
      target: toJson(target),
      actual: toJson(p.solution.actual),
      deviation: toJson(deviation),
      items: [...items, ...sides],
    };
  });
  const cookBatches: Batch[] = (cook?.batches ?? []).map((b) => {
    const raw: Record<string, number> = {};
    for (const r of [...b.raw, ...b.discardedFat])
      raw[r.ingredientId] = (raw[r.ingredientId] ?? 0) + r.rawG;
    return {
      variantId: b.variantId,
      totalCookedG: round3(b.totalCookedG),
      rawIngredients: grams(raw),
      servings: b.servings,
    };
  });
  return { scoreBreakdown: toJson(stored), plates, cookBatches };
}

export function cookMealOf(sheet: CookSheet, meal: PlannedMeal): CookMeal | undefined {
  return sheet.days
    .find((d) => d.date === meal.date)
    ?.meals.find((m) => m.slotKey === meal.slotKey && m.memberScope === meal.memberScope);
}

/** SPEC-Q-21: `adjusters.set` for used adjusters without a household row (none when all have one). */
export async function adjusterRowsOp(
  db: Executor,
  ctx: HouseholdContext,
  meals: readonly PlannedMeal[],
): Promise<ChangeOp[]> {
  const used = new Set(
    meals.flatMap((m) => m.plates.flatMap((p) => p.solution.adjusters.map((a) => a.dishId))),
  );
  if (used.size === 0) return [];
  const rows = new Set((await createRepos(db, ctx).household_adjuster.list()).map((r) => r.dishId));
  const missing = [...used].filter((d) => !rows.has(d)).sort();
  return missing.length === 0
    ? []
    : [
        {
          kind: "adjusters.set",
          payload: { dishes: missing.map((dishId) => ({ dishId, enabled: true })) },
        },
      ];
}

/** The `plan.save_days` op of a plan: every unlocked meal of every planned date. */
export function saveDaysOp(
  plan: PlanResult,
  sheet: CookSheet,
  pool: PlanPool,
  generatedAt: Date,
): ChangeOp {
  return {
    kind: "plan.save_days",
    payload: {
      days: plan.days.map((day) => ({
        date: day.date,
        status: "draft",
        weightsSnapshot: toJson(plan.weights[day.date] ?? {}),
        generatedAt: generatedAt.toISOString(),
        generatorVersion: GENERATOR_VERSION,
        meals: day.meals
          .filter((m) => !m.locked)
          .map((m) => ({
            slotTypeId: m.slotTypeId,
            dishId: m.dishId,
            memberScope: m.memberScope,
            status: "planned",
            ...mealRows(m, cookMealOf(sheet, m), pool),
          })),
      })),
    },
  };
}

/** Saves a generated plan as one change set (DM-6). */
export async function savePlan(
  db: Executor,
  ctx: HouseholdContext,
  args: { plan: PlanResult; sheet: CookSheet; pool: PlanPool; by: ChangeActorInput; now?: Date },
): Promise<AppliedChangeSet> {
  const meals = args.plan.days.flatMap((d) => d.meals).filter((m) => !m.locked);
  const ops = [
    ...(await adjusterRowsOp(db, ctx, meals)),
    saveDaysOp(args.plan, args.sheet, args.pool, args.now ?? new Date()),
  ];
  const dates = args.plan.days.map((d) => d.date);
  return applyChangeSet(db, ctx, {
    actor: args.by.actor,
    source: args.by.source,
    summary:
      dates.length === 1
        ? `Plan ${dates[0] ?? ""}`
        : `Plan ${dates[0] ?? ""} to ${dates[dates.length - 1] ?? ""}`,
    ops,
  });
}
