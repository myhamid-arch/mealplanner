// `plans.preview` (UX-4 "with these weights, tomorrow would change 2 meals"; PlanningBalance "Next
// week, if you save"; BLD-8 R-55, R-56; leaf-1.4.7 SPEC-Q-6). A what-if plan that writes nothing:
// the planner runs on exactly the input `plan.generate` would load after `weights.set` with these
// weights (the same loader and seed, the weights row overlaid the way the op merges it), so the
// proposed side equals the real replan (PLN-11, deterministic since R-51). No recipe generation
// runs in a preview (it would write dishes); the replan's generation requests are counted instead.
// Current = the saved plan when every date has one, else a run with the current weights.
import {
  coreIngredients,
  type CoreIngredientCandidate,
} from "@mealplanner/core/learning/preferences";
import {
  planDays,
  type PlanDish,
  type PlanInput,
  type PlannedMeal,
  type PlanProgress,
} from "@mealplanner/core/planner";
import type { HouseholdContext, PlanningWeightsRow } from "@mealplanner/core/types";
import type { Executor } from "@mealplanner/db/repos";
import { loadPlanInput } from "@mealplanner/db/services/plans";
import { toJson, type JobHandler } from "../runner.js";

/** The weights a preview may change: the five numeric weights of `weights.set`. */
export type PreviewWeights = Partial<
  Pick<
    PlanningWeightsRow,
    "macroPrecision" | "appeal" | "ingredientEconomy" | "variety" | "fairness"
  >
>;

export interface PreviewArgs {
  dates: readonly string[];
  weights: PreviewWeights;
  seed: number;
  onProgress?: (side: "current" | "proposed", e: PlanProgress) => void;
}

export interface PreviewMetrics {
  distinctIngredients: number;
  inTolerancePct: number | null;
  meals: number;
  targetedPlates: number;
}

export interface PreviewSide {
  dishId: string;
  dishName: string;
  variants: string[];
}

export interface PreviewChange {
  date: string;
  slotKey: string;
  slotLabel: string;
  memberScope: string;
  kind: "dish" | "variant" | "added" | "removed";
  memberId: string | null;
  before: PreviewSide | null;
  after: PreviewSide | null;
}

export interface PreviewResult {
  dates: string[];
  seed: number;
  currentSource: "saved" | "computed";
  current: PreviewMetrics;
  proposed: PreviewMetrics;
  changes: PreviewChange[];
  generationRequests: number;
  /** The proposed meals, for comparison with a real replan (not part of the API result). */
  proposedMeals: PlannedMeal[];
}

/**
 * `weights.set`'s merge (`{ ...row, ...definedFields(p) }`) applied to the loaded config. The
 * weights come from JSON (the job payload), which carries no undefined fields.
 */
export function withWeights(input: PlanInput, weights: PreviewWeights): PlanInput {
  return {
    ...input,
    config: { ...input.config, planningWeights: { ...input.config.planningWeights, ...weights } },
  };
}

type Dishes = ReadonlyMap<string, PlanDish>;

function variantOf(dishes: Dishes, dishId: string, variantId: string) {
  const dish = dishes.get(dishId);
  for (const c of dish?.components ?? [])
    for (const v of c.variants) if (v.id === variantId) return { component: c, variant: v };
  return null;
}

/** SC-2's count: distinct core ingredients over every plate of the meals, adjusters included. */
export function metricsOf(meals: readonly PlannedMeal[], dishes: Dishes): PreviewMetrics {
  const used: CoreIngredientCandidate[] = [];
  let targeted = 0;
  let inTolerance = 0;
  for (const meal of meals)
    for (const plate of meal.plates) {
      if (plate.targeted) {
        targeted += 1;
        if (plate.fitStatus === "in_tolerance") inTolerance += 1;
      }
      const parts = [
        ...plate.solution.items.map((i) => ({ dishId: meal.dishId, variantId: i.variantId })),
        ...plate.solution.adjusters.map((a) => ({ dishId: a.dishId, variantId: a.variantId })),
      ];
      for (const p of parts)
        for (const ing of variantOf(dishes, p.dishId, p.variantId)?.variant.ingredients ?? [])
          used.push({ ingredientId: ing.id, slug: ing.slug, category: ing.category });
    }
  return {
    distinctIngredients: coreIngredients(used).length,
    inTolerancePct: targeted === 0 ? null : Math.round((1000 * inTolerance) / targeted) / 10,
    meals: meals.length,
    targetedPlates: targeted,
  };
}

const mealKey = (m: PlannedMeal) => `${m.date}|${m.slotKey}|${m.memberScope}`;

/**
 * A plate's variant per component, in the dish's component order: component id → "Fried eggs".
 * (Stored plate items come back in storage order, so the order is taken from the dish.)
 */
function plateVariants(meal: PlannedMeal, memberId: string, dishes: Dishes): Map<string, string> {
  const labels = new Map<string, string>();
  const plate = meal.plates.find((p) => p.memberId === memberId);
  for (const item of plate?.solution.items ?? []) {
    const found = variantOf(dishes, meal.dishId, item.variantId);
    if (found !== null)
      labels.set(item.componentId, `${found.variant.label} ${found.component.name.toLowerCase()}`);
  }
  const order = dishes.get(meal.dishId)?.components.map((c) => c.id) ?? [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return new Map([...labels].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)));
}

function side(meal: PlannedMeal, dishes: Dishes, variants: string[] = []): PreviewSide {
  return { dishId: meal.dishId, dishName: dishes.get(meal.dishId)?.name ?? meal.dishId, variants };
}

/** Meals whose dish differs, plates whose variant choice differs, and meals only one side has. */
export function mealChanges(
  before: readonly PlannedMeal[],
  after: readonly PlannedMeal[],
  dishes: Dishes,
): PreviewChange[] {
  const was = new Map(before.map((m) => [mealKey(m), m]));
  const now = new Map(after.map((m) => [mealKey(m), m]));
  const changes: PreviewChange[] = [];
  const base = (m: PlannedMeal) => ({
    date: m.date,
    slotKey: m.slotKey,
    slotLabel: m.slotLabel,
    memberScope: m.memberScope,
  });
  for (const [key, b] of was) {
    const a = now.get(key);
    if (a === undefined) {
      changes.push({
        ...base(b),
        kind: "removed",
        memberId: null,
        before: side(b, dishes),
        after: null,
      });
      continue;
    }
    if (a.dishId !== b.dishId) {
      changes.push({
        ...base(b),
        kind: "dish",
        memberId: null,
        before: side(b, dishes),
        after: side(a, dishes),
      });
      continue;
    }
    const members = [...new Set([...b.plates, ...a.plates].map((p) => p.memberId))].sort();
    for (const memberId of members) {
      const vb = plateVariants(b, memberId, dishes);
      const va = plateVariants(a, memberId, dishes);
      const components = [...new Set([...vb.keys(), ...va.keys()])].filter(
        (c) => vb.get(c) !== va.get(c),
      );
      if (components.length === 0) continue;
      changes.push({
        ...base(b),
        kind: "variant",
        memberId,
        before: side(
          b,
          dishes,
          components.flatMap((c) => vb.get(c) ?? []),
        ),
        after: side(
          a,
          dishes,
          components.flatMap((c) => va.get(c) ?? []),
        ),
      });
    }
  }
  for (const [key, a] of now)
    if (!was.has(key))
      changes.push({
        ...base(a),
        kind: "added",
        memberId: null,
        before: null,
        after: side(a, dishes),
      });
  const time = new Map([...before, ...after].map((m) => [mealKey(m), m.time]));
  return changes.sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      (time.get(`${x.date}|${x.slotKey}|${x.memberScope}`) ?? "").localeCompare(
        time.get(`${y.date}|${y.slotKey}|${y.memberScope}`) ?? "",
      ) ||
      x.slotKey.localeCompare(y.slotKey) ||
      x.memberScope.localeCompare(y.memberScope) ||
      (x.memberId ?? "").localeCompare(y.memberId ?? ""),
  );
}

export async function previewPlan(
  db: Executor,
  ctx: HouseholdContext,
  args: PreviewArgs,
): Promise<PreviewResult> {
  const { input, pool, stored } = await loadPlanInput(db, ctx, { dates: args.dates });
  const dishes = new Map(pool.byId);
  const proposed = await planDays(withWeights(input, args.weights), {
    seed: args.seed,
    ...(args.onProgress === undefined
      ? {}
      : { onProgress: (e: PlanProgress) => args.onProgress?.("proposed", e) }),
  });
  for (const d of Object.values(proposed.dishes)) if (!dishes.has(d.id)) dishes.set(d.id, d);
  const planned = new Set(input.dates);
  const saved = stored.filter((m) => planned.has(m.date));
  const everyDateSaved = input.dates.every((d) => saved.some((m) => m.date === d));
  let currentMeals: PlannedMeal[];
  if (everyDateSaved) currentMeals = saved;
  else {
    const current = await planDays(input, {
      seed: args.seed,
      ...(args.onProgress === undefined
        ? {}
        : { onProgress: (e: PlanProgress) => args.onProgress?.("current", e) }),
    });
    for (const d of Object.values(current.dishes)) if (!dishes.has(d.id)) dishes.set(d.id, d);
    currentMeals = current.days.flatMap((d) => d.meals);
  }
  const proposedMeals = proposed.days.flatMap((d) => d.meals);
  return {
    dates: [...input.dates],
    seed: args.seed,
    currentSource: everyDateSaved ? "saved" : "computed",
    current: metricsOf(currentMeals, dishes),
    proposed: metricsOf(proposedMeals, dishes),
    changes: mealChanges(currentMeals, proposedMeals, dishes),
    generationRequests: proposed.generationRequests.length,
    proposedMeals,
  };
}

export const plansPreview: JobHandler = async (ctx) => {
  const p = ctx.job.payload as { dates: string[]; weights: PreviewWeights; seed?: number };
  const result = await previewPlan(ctx.rt.db, ctx.household(), {
    dates: p.dates,
    weights: p.weights,
    seed: p.seed ?? 1,
    onProgress: (which, e) => {
      if (e.type === "day_started") ctx.emit("day_started", { side: which, date: e.date });
    },
  });
  const { proposedMeals, ...dto } = result;
  ctx.log.info(
    { dates: dto.dates.length, changes: dto.changes.length, meals: proposedMeals.length },
    "plan previewed",
  );
  return toJson(dto);
};
