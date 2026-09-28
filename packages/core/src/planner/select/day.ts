// PLN-11 day search (ADR-1 §3–4): pre-score, top K, solve, beam of width B across the meals of the
// day, strict eligibility with the least-bad fallback (PLN-8), and the PLN-12 generation trigger.
import { seededUnit } from "./rng.js";
import {
  AI_DISH_COUNT,
  AI_MIN_BEST_SCORE,
  AI_MIN_CANDIDATES,
  BEAM_WIDTH,
  PRE_SCORE_JITTER,
  PRE_SCORE_TOP_K,
  SCORE_EPSILON,
} from "./config.js";
import { dayNumber, type Served } from "./filters.js";
import { mealsOfDate, type MealSpec } from "./meals.js";
import type { Candidate, Run } from "./run.js";
import { scoreUpperBound } from "./bound.js";
import { bySlug } from "./pool.js";
import { economyOf, appealOf } from "./score.js";
import type {
  PlanDish,
  PlanFlag,
  PlanGenerationRequest,
  PlannedMeal,
  PlanOptions,
  ScoreBreakdown,
} from "./types.js";

type Choice =
  | {
      spec: MealSpec;
      locked: null;
      candidate: Candidate;
      score: ScoreBreakdown;
      relaxed: string | null;
    }
  | {
      spec: MealSpec | null;
      locked: PlannedMeal;
      candidate: null;
      score: ScoreBreakdown;
      relaxed: null;
    };

/** `path`: the slugs of the state's dishes in meal order, the beam's tie-break key (W-17). */
type State = { choices: Choice[]; served: Served[]; total: number; path: string };

/** A locked meal's path step when its dish is not in the pool (every state takes the same step). */
const LOCKED_PATH = "(locked)";

export type DayOutput = {
  flags: PlanFlag[];
  generationRequests: PlanGenerationRequest[];
};

/** Core ingredients in the economy window of `date` over the served meals. */
function windowIngredients(history: readonly Served[], date: string, days: number): Set<string> {
  const out = new Set<string>();
  for (const s of history)
    if (Math.abs(s.day - dayNumber(date)) <= days - 1) for (const i of s.core) out.add(i);
  return out;
}

function defaultVariantIds(dish: PlanDish): string[] {
  return dish.components.flatMap((c) => c.variants.filter((v) => v.isDefault).map((v) => v.id));
}

/** PLN-11 cheap pre-score: appeal + economy of the default variants, no solve, plus seeded jitter. */
export function preScore(
  run: Run,
  spec: MealSpec,
  dish: PlanDish,
  window: ReadonlySet<string>,
): number {
  const w = run.weightsOn(spec.date);
  const variants = defaultVariantIds(dish);
  const appeal = appealOf(
    spec.attendees.map((m) => ({
      memberId: m,
      targeted: false,
      fit: 0,
      appeal: run.household.appeal(m, dish, variants),
    })),
    w.fairness,
  );
  const economy = economyOf(run.pool.coreOf(variants), window, {}).value;
  // W-17 (R-73): keyed on natural keys only (the meal's date, slot key and member position, and
  // the dish slug), so the plan does not depend on the database's surrogate ids.
  const jitter =
    PRE_SCORE_JITTER *
    seededUnit(run.seed, `${run.mealKey(spec.date, spec.slot.id, spec.memberScope)}|${dish.slug}`);
  return w.appeal * appeal + w.ingredientEconomy * economy + jitter;
}

/** Filtered pool of the meal, ordered by pre-score in the context of `history` (ADR-1 §4). */
export function rankedPool(run: Run, spec: MealSpec, history: readonly Served[]): PlanDish[] {
  const window = windowIngredients(history, spec.date, run.weightsOn(spec.date).economyWindowDays);
  return run
    .eligiblePool(spec)
    .map((dish) => ({ dish, s: preScore(run, spec, dish, window) }))
    .sort((a, b) => b.s - a.s || bySlug(a.dish, b.dish))
    .map((x) => x.dish);
}

/** Days to the nearest serving of the dish to an attendee (Infinity if none). */
function nearestServing(dish: PlanDish, spec: MealSpec, history: readonly Served[]): number {
  const day = dayNumber(spec.date);
  let nearest = Infinity;
  for (const s of history)
    if (s.dishId === dish.id && s.memberIds.some((m) => spec.attendees.includes(m)))
      nearest = Math.min(nearest, Math.abs(s.day - day));
  return nearest;
}

/**
 * Solved candidates for one state: blocks of K from the ranked pool (frequency checked against the
 * state), until a block yields an eligible candidate or the pool is used up (ADR-1 §4).
 *
 * R-37 (SPEC-Q-15): when frequency blocks every dish that passes the other hard filters, the
 * eligible dish served longest ago is used ("plan with the best available dish", PLN-12), and the
 * meal is flagged. Exclusions, `never` and slot suitability are never relaxed.
 */
function candidatesFor(
  run: Run,
  spec: MealSpec,
  ranked: readonly PlanDish[],
  history: readonly Served[],
): { eligible: Candidate[]; evaluated: Candidate[]; relaxed: string | null } {
  const open = ranked.filter((d) => !run.frequencyBlocked(d, spec, history));
  const evaluated: Candidate[] = [];
  if (open.length === 0 && ranked.length > 0) {
    // R-37: the eligible dish served longest ago (ties in pre-score order); least-bad if none is.
    const gaps = new Map(ranked.map((d) => [d.id, nearestServing(d, spec, history)]));
    const byAge = ranked
      .map((d, i) => ({ d, i }))
      .sort((a, b) => (gaps.get(b.d.id) ?? 0) - (gaps.get(a.d.id) ?? 0) || a.i - b.i)
      .map((x) => x.d);
    const relaxed = `Frequency relaxed: all ${String(ranked.length)} suitable dishes were served to an attendee within their minimum gap (R-37)`;
    for (const dish of byAge) {
      const c = run.evaluate(spec, dish);
      evaluated.push(c);
      if (c.eligible) return { eligible: [c], evaluated, relaxed };
    }
    return { eligible: [], evaluated, relaxed };
  }
  for (let start = 0; start < open.length; start += PRE_SCORE_TOP_K) {
    for (const dish of open.slice(start, start + PRE_SCORE_TOP_K))
      evaluated.push(run.evaluate(spec, dish));
    const eligible = evaluated.filter((c) => c.eligible);
    if (eligible.length > 0) return { eligible, evaluated, relaxed: null };
  }
  return { eligible: [], evaluated, relaxed: null };
}

/** PLN-8: the least-bad candidate (smallest Σ|dev|/tol), earlier pre-score first on ties. */
function leastBad(evaluated: readonly Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of evaluated)
    if (best === undefined || c.badness < best.badness - SCORE_EPSILON) best = c;
  return best;
}

function generationRequest(
  run: Run,
  spec: MealSpec,
  history: readonly Served[],
  reason: string,
): PlanGenerationRequest {
  const days = run.weightsOn(spec.date).economyWindowDays;
  const inWindow = history.filter((s) => Math.abs(s.day - dayNumber(spec.date)) <= days - 1);
  const counts = new Map<string, number>();
  for (const s of inWindow) for (const i of s.core) counts.set(i, (counts.get(i) ?? 0) + 1);
  const cuisineCounts = new Map<string, number>();
  for (const s of inWindow)
    cuisineCounts.set(s.cuisineKey, (cuisineCounts.get(s.cuisineKey) ?? 0) + 1);
  return {
    date: spec.date,
    slotKey: spec.slot.key,
    count: AI_DISH_COUNT,
    palette: [...counts]
      .map(([id, n]) => ({ slug: run.pool.slugById.get(id) ?? id, timesUsed: n }))
      .sort((a, b) => b.timesUsed - a.timesUsed || (a.slug < b.slug ? -1 : 1)),
    avoidRecentCuisines: [...cuisineCounts]
      .filter(([, n]) => n >= 2)
      .map(([k]) => k)
      .sort(),
    avoidDishes: [
      ...new Set(inWindow.map((s) => run.pool.dish(s.dishId)?.name ?? s.dishId)),
    ].sort(),
    reason,
  };
}

function plannedMeal(run: Run, choice: Choice & { locked: null }): PlannedMeal {
  const { spec, candidate } = choice;
  return {
    date: spec.date,
    slotKey: spec.slot.key,
    slotTypeId: spec.slot.id,
    slotLabel: spec.slot.label,
    time: spec.slot.defaultTime,
    isPacked: spec.slot.isPacked,
    reheatAvailable: spec.slot.reheatAvailable,
    kind: spec.kind,
    memberScope: spec.memberScope,
    attendees: [...spec.attendees],
    splitMembers: [...spec.splitMembers],
    split: spec.split,
    dishId: candidate.dish.id,
    dishVersion: candidate.dish.version,
    locked: false,
    scoreBreakdown: choice.score,
    plates: candidate.plates,
    frequencyRelaxed: choice.relaxed,
    variantLimits: candidate.variantLimits,
    explain: [
      ...candidate.explain,
      ...(candidate.eligible
        ? []
        : [
            `No candidate had every targeted plate in tolerance; least-bad dish ${candidate.dish.name} used (PLN-8)`,
          ]),
    ],
  };
}

type Meta = { date: string; attendees: readonly string[]; timeKey: string; mealKey: string };

/**
 * Beam order: summed score, then a seeded tie-break on the state's path of dish slugs (W-17), then
 * the path itself; equal paths keep their expansion order (stable sort).
 */
function compareChildren(seed: number): (a: State, b: State) => number {
  return (a, b) =>
    b.total - a.total ||
    seededUnit(seed, a.path) - seededUnit(seed, b.path) ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function childOf(
  run: Run,
  spec: MealSpec,
  meta: Meta,
  state: State,
  context: readonly Served[],
  candidate: Candidate,
  relaxed: string | null,
): State {
  const score = run.score(meta, candidate.dish, candidate.plates, context);
  const served = run.served(
    spec.date,
    spec.slot.id,
    spec.memberScope,
    candidate.dish.id,
    candidate.plates,
  );
  const choice: Choice = { spec, locked: null, candidate, score, relaxed };
  return {
    choices: [...state.choices, choice],
    served: [...state.served, served],
    total: state.total + score.total,
    path: `${state.path}/${candidate.dish.slug}`,
  };
}

/** A state's children as the full search defines them: its whole candidate block (ADR-1 §4). */
function exactChildren(
  run: Run,
  spec: MealSpec,
  meta: Meta,
  state: State,
  ranked: readonly PlanDish[],
  context: readonly Served[],
): State[] {
  const { eligible, evaluated, relaxed } = candidatesFor(run, spec, ranked, context);
  const picks =
    eligible.length > 0 ? eligible : [leastBad(evaluated)].filter((c) => c !== undefined);
  return picks.map((c) => childOf(run, spec, meta, state, context, c, relaxed));
}

/**
 * The children of every beam state for one meal (PLN-11), solving only what can matter (CP3
 * finding 1). Every (state, candidate) pair of each state's top-K block gets an upper bound on its
 * child's total (bound.ts). Pairs are solved in descending bound order until the next bound falls
 * below the B-th best exact child found so far: no pair left can enter the beam, so the kept states
 * are exactly those of solving every pair. A state left with no eligible child is expanded in full
 * (further blocks, least-bad) if its best bound over its whole pool can still reach the beam.
 * Within a pair, targeted plates are solved one at a time, and each fit found replaces its 1 in the
 * MacroFit bound. A plate that is infeasible makes the candidate ineligible, so it is not a child.
 */
function expandBeam(
  run: Run,
  spec: MealSpec,
  meta: Meta,
  states: readonly State[],
  ranked: readonly PlanDish[],
  history: readonly Served[],
): State[] {
  const children: State[] = [];
  const totals: number[] = [];
  const add = (c: State) => {
    children.push(c);
    const at = totals.findIndex((t) => t < c.total);
    totals.splice(at < 0 ? totals.length : at, 0, c.total);
  };
  const threshold = () =>
    totals.length < BEAM_WIDTH ? -Infinity : (totals[BEAM_WIDTH - 1] ?? -Infinity);
  const pairs: Array<{ i: number; dish: PlanDish; order: number; ub: number }> = [];
  const bestBound: number[] = [];
  const contexts = states.map((s) => [...history, ...s.served]);
  // PLN-11: the meal's top K, by pre-score in the day's entry context (ADR-1 §4). A state only
  // drops the candidates its own meals block for frequency.
  const block = new Set(
    ranked
      .filter((d) => !run.frequencyBlocked(d, spec, history))
      .slice(0, PRE_SCORE_TOP_K)
      .map((d) => d.id),
  );
  states.forEach((state, i) => {
    const context = contexts[i] ?? [];
    const open = ranked.filter((d) => !run.frequencyBlocked(d, spec, context));
    if (open.length === 0) {
      // R-37 (relaxed) or nothing suitable: the full definition decides.
      for (const c of exactChildren(run, spec, meta, state, ranked, context)) add(c);
      bestBound[i] = -Infinity;
      return;
    }
    const bound = (d: PlanDish) =>
      state.total +
      scoreUpperBound(run, spec, d, run.context(meta, d.cuisineKey, context), (m) =>
        run.appealBound(m, spec, d),
      );
    let best = -Infinity;
    open.forEach((d, order) => {
      const ub = bound(d);
      best = Math.max(best, ub);
      if (block.has(d.id)) pairs.push({ i, dish: d, order, ub });
    });
    bestBound[i] = best;
  });
  pairs.sort((a, b) => b.ub - a.ub || a.i - b.i || a.order - b.order);
  const w = run.weightsOn(spec.date);
  const sumW = w.macroPrecision + w.appeal + w.ingredientEconomy + w.variety;
  const targeted = spec.attendees.filter((m) => run.target(spec.date, m, spec.slot.id) !== null);
  const withEligible = new Set<number>();
  for (const p of pairs) {
    const cut = run.prune ? threshold() - SCORE_EPSILON : -Infinity;
    if (p.ub < cut) break;
    const state = states[p.i];
    if (state === undefined) continue;
    // Solve the targeted attendees one at a time: each fit found tightens the MacroFit bound
    // (unsolved plates count as fit 1), and the pair stops as soon as it cannot reach the beam.
    if (run.prune && sumW > 0 && targeted.length > 0 && !run.mayMergeVariants(spec, p.dish)) {
      let dropped = false;
      let fits = 0;
      for (const m of targeted) {
        const sol = run.solve(p.dish, m, spec.slot, run.target(spec.date, m, spec.slot.id), {});
        if (sol.status === "infeasible") {
          dropped = true;
          break;
        }
        fits += 1 - sol.fit;
        if (p.ub - (w.macroPrecision * fits) / targeted.length / sumW < cut) {
          dropped = true;
          break;
        }
      }
      if (dropped) continue;
    }
    const c = run.evaluate(spec, p.dish);
    if (!c.eligible) continue;
    withEligible.add(p.i);
    add(childOf(run, spec, meta, state, contexts[p.i] ?? [], c, null));
  }
  states.forEach((state, i) => {
    const b = bestBound[i] ?? -Infinity;
    if (withEligible.has(i) || b === -Infinity || (run.prune && b < threshold() - SCORE_EPSILON))
      return;
    for (const c of exactChildren(run, spec, meta, state, ranked, contexts[i] ?? [])) add(c);
  });
  return children;
}

/** PLN-12 figures for one state: eligible candidates and the best score, solved lazily. */
function triggerFigures(
  run: Run,
  spec: MealSpec,
  ranked: readonly PlanDish[],
  context: readonly Served[],
  meta: Meta,
): { count: number; best: number } {
  const open = ranked.filter((d) => !run.frequencyBlocked(d, spec, context));
  let count = 0;
  let best = 0;
  if (open.length > 0)
    for (const d of open.slice(0, PRE_SCORE_TOP_K)) {
      const c = run.evaluate(spec, d);
      if (!c.eligible) continue;
      count++;
      best = Math.max(best, run.score(meta, c.dish, c.plates, context).total);
      if (count >= AI_MIN_CANDIDATES && best >= AI_MIN_BEST_SCORE) return { count, best };
    }
  if (count > 0) return { count, best };
  // No eligible dish in the first block: the full definition (further blocks, R-37, least-bad).
  const { eligible, evaluated } = candidatesFor(run, spec, ranked, context);
  const picks =
    eligible.length > 0 ? eligible : [leastBad(evaluated)].filter((c) => c !== undefined);
  for (const c of picks) best = Math.max(best, run.score(meta, c.dish, c.plates, context).total);
  return { count: eligible.length, best };
}

/**
 * Plans one date (PLN-11): meals in planning order, each expanded from every beam state with its
 * solved candidates, keeping the best `BEAM_WIDTH` states by summed score. `history` holds every
 * other served meal (earlier days, context and locked meals outside the date).
 */
export async function planDay(
  run: Run,
  date: string,
  history: readonly Served[],
  locked: readonly PlannedMeal[],
  opts: PlanOptions,
  out: DayOutput,
): Promise<PlannedMeal[]> {
  opts.onProgress?.({ type: "day_started", date });
  const specs = mealsOfDate(run.cfg, date);
  const lockedByKey = new Map(
    locked.map((m) => [run.mealKey(m.date, m.slotTypeId, m.memberScope), m]),
  );
  let states: State[] = [{ choices: [], served: [], total: 0, path: "" }];

  // Locked meals whose slot no longer exists for the date are kept too (PLN-13).
  const specKeys = new Set(specs.map((s) => run.mealKey(date, s.slot.id, s.memberScope)));
  for (const m of locked) {
    const key = run.mealKey(m.date, m.slotTypeId, m.memberScope);
    if (specKeys.has(key)) continue;
    const served = run.served(m.date, m.slotTypeId, m.memberScope, m.dishId, m.plates);
    states = states.map((s) => ({
      ...s,
      choices: [
        ...s.choices,
        { spec: null, locked: m, candidate: null, score: m.scoreBreakdown, relaxed: null },
      ],
      served: [...s.served, served],
    }));
  }

  for (const spec of specs) {
    const key = run.mealKey(date, spec.slot.id, spec.memberScope);
    const timeKey = run.timeKeyOf(spec.slot.id);
    const fixed = lockedByKey.get(key);
    if (fixed !== undefined) {
      const served = run.served(date, spec.slot.id, spec.memberScope, fixed.dishId, fixed.plates);
      states = states.map((s) => ({
        choices: [
          ...s.choices,
          { spec, locked: fixed, candidate: null, score: fixed.scoreBreakdown, relaxed: null },
        ],
        served: [...s.served, served],
        total: s.total + fixed.scoreBreakdown.total,
        path: `${s.path}/${run.pool.dish(fixed.dishId)?.slug ?? LOCKED_PATH}`,
      }));
      continue;
    }

    let ranked = rankedPool(run, spec, history);
    const meta = { date, attendees: spec.attendees, timeKey, mealKey: key };

    // PLN-12 trigger, from the best state's solved candidates (solved lazily: it stops as soon as
    // the outcome is decided, so it never solves more than the full block would).
    const mode = run.weightsOn(date).aiGeneration;
    const first = states[0];
    if (mode !== "off" && first !== undefined) {
      const { count, best } = triggerFigures(
        run,
        spec,
        ranked,
        [...history, ...first.served],
        meta,
      );
      if (count < AI_MIN_CANDIDATES || best < AI_MIN_BEST_SCORE) {
        const reason =
          count < AI_MIN_CANDIDATES
            ? `only ${String(count)} candidate(s) pass the filters and the solver (< ${String(AI_MIN_CANDIDATES)})`
            : `best score ${best.toFixed(2)} is below ${String(AI_MIN_BEST_SCORE)}`;
        const request = generationRequest(run, spec, history, reason);
        if (mode === "ask") out.generationRequests.push(request);
        else if (opts.requestDishes !== undefined) {
          opts.onProgress?.({ type: "ai_generating", date, slotKey: spec.slot.key, reason });
          const dishes = await opts.requestDishes(request);
          for (const d of dishes) run.pool.add(d, false);
          ranked = rankedPool(run, spec, history);
        }
      }
    }

    const children = expandBeam(run, spec, meta, states, ranked, history);
    if (children.length === 0) {
      out.flags.push({
        kind: "no_candidate",
        date,
        slotKey: spec.slot.key,
        memberId: spec.kind === "individual" ? spec.memberScope : null,
        reason: `No dish passes the hard filters for ${spec.slot.label} (${spec.attendees.join(", ")})`,
      });
      continue;
    }
    children.sort(compareChildren(run.seed));
    states = children.slice(0, BEAM_WIDTH);
    const chosen = states[0]?.choices.at(-1);
    if (chosen !== undefined && chosen.locked === null)
      opts.onProgress?.({
        type: "meal_planned",
        date,
        slotKey: spec.slot.key,
        memberScope: spec.memberScope,
        dishId: chosen.candidate.dish.id,
      });
  }

  const bestState = states[0];
  if (bestState === undefined) return [];
  return bestState.choices.map((c) => (c.locked === null ? plannedMeal(run, c) : c.locked));
}
