// PLN-11 week improvement pass (ADR-1 §5): for each unlocked meal, try the top 5 alternatives and
// keep a swap if the week's total score improves.
//
// The week total is Σ PLN-9 scores, each meal scored against every other served meal. A swap at
// meal i changes meal i's own score and, for every other meal j, only the parts of j's context that
// meal i contributes to: j's economy window, the cuisine count and, when i is the meal just before
// j, the previous-meal terms. So each meal j's context is prepared once without meal i, and a trial
// adds meal i's old or new version back. The result is exactly the change of the full total (the
// unit test compares the two) at O(N) per trial instead of O(N²).
import { IMPROVEMENT_ALTERNATIVES, SCORE_EPSILON } from "./config.js";
import { dayNumber, laterThan, type Served } from "./filters.js";
import { mealKey, type MealSpec } from "./meals.js";
import type { MealParts, Run, ScoredMeal } from "./run.js";
import { scoreDish } from "./score.js";
import type { PlannedMeal } from "./types.js";

const servedMemo = new WeakMap<PlannedMeal, Served>();

export function servedOf(run: Run, m: PlannedMeal): Served {
  let s = servedMemo.get(m);
  if (s === undefined) {
    s = run.served(m.date, m.slotTypeId, m.memberScope, m.dishId, m.plates);
    servedMemo.set(m, s);
  }
  return s;
}

export function scoredMealOf(run: Run, m: PlannedMeal): ScoredMeal {
  return {
    date: m.date,
    attendees: m.plates.map((p) => p.memberId),
    timeKey: run.timeKeyOf(m.slotTypeId),
    mealKey: mealKey(m.date, m.slotTypeId, m.memberScope),
  };
}

/** Σ PLN-9 totals of the meals, each scored against every other served meal (and the context). */
export function weekTotal(
  run: Run,
  meals: readonly PlannedMeal[],
  context: readonly Served[],
): number {
  const served = [...context, ...meals.map((m) => servedOf(run, m))];
  let total = 0;
  for (const m of meals) {
    const dish = run.pool.dish(m.dishId);
    total +=
      dish === undefined
        ? m.scoreBreakdown.total
        : run.score(scoredMealOf(run, m), dish, m.plates, served).total;
  }
  return total;
}

export function specOf(run: Run, m: PlannedMeal): MealSpec | null {
  const slot = run.cfg.slotTypes.find((s) => s.id === m.slotTypeId);
  if (slot === undefined) return null;
  return {
    date: m.date,
    slot,
    kind: m.kind,
    memberScope: m.memberScope,
    attendees: [...m.attendees],
    splitMembers: [...m.splitMembers],
    split: m.split,
  };
}

/** Meal j's scoring context with meal i left out, ready to take any version of meal i. */
type Prepared = {
  meal: ScoredMeal;
  parts: MealParts;
  day: number;
  windowDays: number;
  attending: Set<string>;
  cuisineKey: string;
  /** Ingredient → count over the window, meal i and j excluded. */
  counts: Map<string, number>;
  cuisineDates: Set<string>;
  previous: Served | null;
};

function prepare(
  run: Run,
  j: PlannedMeal,
  served: readonly Served[],
  skip: ReadonlySet<string>,
): Prepared | null {
  const dish = run.pool.dish(j.dishId);
  if (dish === undefined) return null;
  const meal = scoredMealOf(run, j);
  const windowDays = run.weightsOn(j.date).economyWindowDays;
  const day = dayNumber(j.date);
  const attending = new Set(meal.attendees);
  const counts = new Map<string, number>();
  const cuisineDates = new Set<string>();
  let previous: Served | null = null;
  for (const s of served) {
    if (skip.has(s.mealKey) || s.mealKey === meal.mealKey) continue;
    if (Math.abs(s.day - day) <= windowDays - 1) {
      for (const x of s.core) counts.set(x, (counts.get(x) ?? 0) + 1);
      if (s.cuisineKey === dish.cuisineKey && s.memberIds.some((m) => attending.has(m)))
        cuisineDates.add(s.date);
    }
    if (
      s.date === meal.date &&
      s.timeKey < meal.timeKey &&
      s.memberIds.some((m) => attending.has(m)) &&
      (previous === null || laterThan(s, previous))
    )
      previous = s;
  }
  return {
    meal,
    parts: run.parts(dish, j.plates, j.date),
    day,
    windowDays,
    attending,
    cuisineKey: dish.cuisineKey,
    counts,
    cuisineDates,
    previous,
  };
}

/** Meal j's total with meal i served as `i`. */
function scoreWith(run: Run, p: Prepared, i: Served): number {
  const inWindow = Math.abs(i.day - p.day) <= p.windowDays - 1;
  const shares = i.memberIds.some((m) => p.attending.has(m));
  const window = new Set<string>();
  for (const x of p.parts.ingredients)
    if ((p.counts.get(x) ?? 0) > 0 || (inWindow && i.core.includes(x))) window.add(x);
  const cuisineMealDays =
    p.cuisineDates.size +
    (inWindow && shares && i.cuisineKey === p.cuisineKey && !p.cuisineDates.has(i.date) ? 1 : 0);
  let previous = p.previous;
  if (
    i.date === p.meal.date &&
    i.timeKey < p.meal.timeKey &&
    shares &&
    (previous === null || laterThan(i, previous))
  )
    previous = i;
  return scoreDish({
    ...p.parts,
    window: { ingredients: window, cuisineMealDays },
    previous: previous === null ? null : run.previousOf(previous),
  }).total;
}

/**
 * For meal `i`: a function giving the change of the week total when meal i is replaced by
 * `swapped` (whose own score in the plan is `swappedScore`, if already known).
 */
export function swapDelta(
  run: Run,
  meals: readonly PlannedMeal[],
  i: number,
  context: readonly Served[],
): (swapped: PlannedMeal, swappedScore?: number) => number {
  const meal = meals[i];
  const dish = meal === undefined ? undefined : run.pool.dish(meal.dishId);
  if (meal === undefined || dish === undefined)
    throw new RangeError(`no scorable meal at ${String(i)}`);
  const served = [...context, ...meals.map((m) => servedOf(run, m))];
  const self = scoredMealOf(run, meal);
  const others = served.filter((s) => s.mealKey !== self.mealKey);
  const skip = new Set([self.mealKey]);
  const prepared = meals
    .flatMap((m, j) => (j === i ? [] : [prepare(run, m, served, skip)]))
    .filter((p): p is Prepared => p !== null);
  const oldServed = servedOf(run, meal);
  const oldOthers = prepared.map((p) => scoreWith(run, p, oldServed));
  const oldSelf = run.score(self, dish, meal.plates, others).total;
  return (swapped, swappedScore) => {
    const newDish = run.pool.dish(swapped.dishId);
    if (newDish === undefined) throw new RangeError(`unknown dish ${swapped.dishId}`);
    const newSelf = swappedScore ?? run.score(self, newDish, swapped.plates, others).total;
    const newServed = servedOf(run, swapped);
    let delta = newSelf - oldSelf;
    prepared.forEach((p, k) => {
      delta += scoreWith(run, p, newServed) - (oldOthers[k] ?? 0);
    });
    return delta;
  };
}

/** One PLN-11 improvement pass over `meals` (changed in place); returns the swaps kept. */
export function improvePass(run: Run, meals: PlannedMeal[], context: readonly Served[]): number {
  let swaps = 0;
  for (let i = 0; i < meals.length; i++) {
    const meal = meals[i];
    if (meal === undefined || meal.locked) continue;
    const spec = specOf(run, meal);
    const dish = run.pool.dish(meal.dishId);
    if (spec === null || dish === undefined) continue;
    const served = [...context, ...meals.map((m) => servedOf(run, m))];
    const self = scoredMealOf(run, meal);
    const others = served.filter((s) => s.mealKey !== self.mealKey);

    // The top alternatives among the candidates the day search solved for this meal, scored in
    // the context of the whole plan (ADR-1 §5).
    const alternatives = run
      .evaluated(spec)
      .filter(
        (c) =>
          c.eligible && c.dish.id !== meal.dishId && !run.frequencyBlocked(c.dish, spec, others),
      )
      .map((c) => ({ c, s: run.score(self, c.dish, c.plates, others).total }))
      .sort((a, b) => b.s - a.s || (a.c.dish.id < b.c.dish.id ? -1 : 1))
      .slice(0, IMPROVEMENT_ALTERNATIVES);
    if (alternatives.length === 0) continue;

    const deltaOf = swapDelta(run, meals, i, context);
    let best: { delta: number; meal: PlannedMeal } | null = null;
    for (const { c, s: newSelf } of alternatives) {
      const swapped: PlannedMeal = {
        ...meal,
        dishId: c.dish.id,
        dishVersion: c.dish.version,
        plates: c.plates,
        variantLimits: c.variantLimits,
        explain: [...c.explain, `Improvement pass: replaced ${meal.dishId}`],
      };
      const delta = deltaOf(swapped, newSelf);
      if (delta > SCORE_EPSILON && (best === null || delta > best.delta + SCORE_EPSILON))
        best = { delta, meal: swapped };
    }
    if (best !== null) {
      meals[i] = best.meal;
      swaps++;
    }
  }
  return swaps;
}
