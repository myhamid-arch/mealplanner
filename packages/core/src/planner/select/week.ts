// PLN-11 week search (ADR-1 §5): days in date order with the plan so far as context, then up to 2
// improvement passes (top 5 alternatives per unlocked meal, a swap kept only if the week total
// improves), then the R-28 kcal re-targeting pass and the final scores, flags and totals.
import { loadPortionSolver } from "../solver/index.js";
import { assertIsoDate } from "../targets/day.js";
import { IMPROVEMENT_PASSES } from "./config.js";
import { planDay } from "./day.js";
import { improvePass, scoredMealOf, servedOf } from "./improve.js";
import { memberDayTotals, retargetDay } from "./retarget.js";
import { Run } from "./run.js";
import type {
  PlanDish,
  PlanFlag,
  PlanInput,
  PlannedMeal,
  PlanOptions,
  PlanResult,
  PlanWeights,
} from "./types.js";

function assertInput(input: PlanInput): string[] {
  for (const d of input.dates) assertIsoDate(d);
  if (input.dates.length === 0) throw new RangeError("planDays needs at least one date");
  return [...new Set(input.dates)].sort();
}

/** PLN-11 (04 §11): plans the dates. Awaits the solver runtime itself. */
export async function planDays(input: PlanInput, opts: PlanOptions): Promise<PlanResult> {
  const t0 = performance.now();
  const dates = assertInput(input);
  if (!Number.isInteger(opts.seed))
    throw new RangeError(`seed must be an integer, got ${String(opts.seed)}`);
  await loadPortionSolver();
  const run = new Run(input.config, input.dishes, input.adjusters, opts.seed);
  const planned = new Set(dates);
  const locked = input.locked ?? [];
  const context = (input.context ?? [])
    .filter((m) => !planned.has(m.date))
    .map((m) => servedOf(run, m));
  const out = {
    flags: [] as PlanFlag[],
    generationRequests: [] as PlanResult["generationRequests"],
  };

  const byDate = new Map<string, PlannedMeal[]>();
  for (const date of dates) {
    const earlier = [...byDate.values()].flat().map((m) => servedOf(run, m));
    const lockedElsewhere = locked.filter(
      (m) => m.date !== date && planned.has(m.date) && !byDate.has(m.date),
    );
    const history = [...context, ...earlier, ...lockedElsewhere.map((m) => servedOf(run, m))];
    const meals = await planDay(
      run,
      date,
      history,
      locked.filter((m) => m.date === date),
      opts,
      out,
    );
    byDate.set(date, meals);
  }

  const all = dates.flatMap((d) => byDate.get(d) ?? []);
  let swaps = 0;
  for (let pass = 1; pass <= IMPROVEMENT_PASSES; pass++) {
    const n = improvePass(run, all, context);
    swaps += n;
    opts.onProgress?.({ type: "improvement_pass", pass, swaps: n });
    if (n === 0) break;
  }

  const days: PlanResult["days"] = [];
  for (const date of dates) {
    opts.onProgress?.({ type: "retargeting", date });
    days.push({
      date,
      meals: retargetDay(
        run,
        all.filter((m) => m.date === date),
      ),
    });
  }

  // Final scores from the final plates, each against every other meal of the plan and context.
  const finalMeals = days.flatMap((d) => d.meals);
  const served = [...context, ...finalMeals.map((m) => servedOf(run, m))];
  for (const day of days)
    day.meals = day.meals.map((m) => {
      const dish = run.pool.dish(m.dishId);
      return m.locked || dish === undefined
        ? m
        : { ...m, scoreBreakdown: run.score(scoredMealOf(run, m), dish, m.plates, served) };
    });

  const memberDays = days.flatMap((d) => memberDayTotals(run, d.date, d.meals));
  const flags: PlanFlag[] = [...out.flags];
  let infeasiblePlates = 0;
  for (const day of days)
    for (const m of day.meals)
      for (const p of m.plates) {
        if (!p.targeted || p.fitStatus === "in_tolerance") continue;
        if (p.fitStatus === "infeasible") infeasiblePlates++;
        flags.push({
          kind: p.fitStatus === "infeasible" ? "infeasible_plate" : "flexible_miss",
          date: m.date,
          slotKey: m.slotKey,
          memberId: p.memberId,
          reason: p.flag ?? p.fitStatus,
        });
      }
  for (const md of memberDays)
    if (md.flaggedSlots.length > 0 || !md.within)
      flags.push({
        kind: "member_day_kcal",
        date: md.date,
        slotKey: null,
        memberId: md.memberId,
        reason:
          `Day total ${md.kcalActual.toFixed(0)} kcal against ${String(md.kcalTarget)} ± ${String(md.band)}` +
          (md.flaggedSlots.length > 0
            ? `; not in tolerance at ${md.flaggedSlots.join(", ")} (SPEC-Q-2)`
            : ""),
      });

  const dishes: Record<string, PlanDish> = {};
  for (const m of finalMeals) {
    const d = run.pool.dish(m.dishId);
    if (d !== undefined) dishes[d.id] = d;
    for (const p of m.plates)
      for (const a of p.solution.adjusters) {
        const ad = run.pool.dish(a.dishId);
        if (ad !== undefined) dishes[ad.id] = ad;
      }
  }
  const weights: Record<string, PlanWeights> = {};
  for (const date of dates) weights[date] = run.weightsOn(date);
  const ms = performance.now() - t0;
  opts.onProgress?.({ type: "done", ms });
  return {
    seed: opts.seed,
    dates,
    members: run.household.planMembers(),
    weights,
    days,
    memberDays,
    flags,
    generationRequests: out.generationRequests,
    dishes,
    stats: {
      solves: run.stats.solves,
      cacheHits: run.stats.cacheHits,
      infeasiblePlates,
      improvementSwaps: swaps,
      ms,
    },
  };
}
