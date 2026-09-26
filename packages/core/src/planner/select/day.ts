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
import { mealKey, mealsOfDate, type MealSpec } from "./meals.js";
import type { Candidate, Run } from "./run.js";
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

type State = { choices: Choice[]; served: Served[]; total: number; path: string };

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
  const jitter =
    PRE_SCORE_JITTER *
    seededUnit(run.seed, `${mealKey(spec.date, spec.slot.id, spec.memberScope)}|${dish.id}`);
  return w.appeal * appeal + w.ingredientEconomy * economy + jitter;
}

/** Filtered pool of the meal, ordered by pre-score in the context of `history` (ADR-1 §4). */
export function rankedPool(run: Run, spec: MealSpec, history: readonly Served[]): PlanDish[] {
  const window = windowIngredients(history, spec.date, run.weightsOn(spec.date).economyWindowDays);
  return run
    .eligiblePool(spec)
    .map((dish) => ({ dish, s: preScore(run, spec, dish, window) }))
    .sort((a, b) => b.s - a.s || (a.dish.id < b.dish.id ? -1 : a.dish.id > b.dish.id ? 1 : 0))
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
 * SPEC-Q-15: when frequency blocks every dish that passes the other hard filters, the dishes served
 * longest ago are used instead ("plan with the best available dish", PLN-12), and the meal is
 * flagged. Exclusions, `never` and slot suitability are never relaxed.
 */
function candidatesFor(
  run: Run,
  spec: MealSpec,
  ranked: readonly PlanDish[],
  history: readonly Served[],
): { eligible: Candidate[]; evaluated: Candidate[]; relaxed: string | null } {
  let open = ranked.filter((d) => !run.frequencyBlocked(d, spec, history));
  let relaxed: string | null = null;
  if (open.length === 0 && ranked.length > 0) {
    const gaps = new Map(ranked.map((d) => [d.id, nearestServing(d, spec, history)]));
    open = ranked
      .map((d, i) => ({ d, i }))
      .sort((a, b) => (gaps.get(b.d.id) ?? 0) - (gaps.get(a.d.id) ?? 0) || a.i - b.i)
      .map((x) => x.d);
    relaxed = `Frequency relaxed: all ${String(ranked.length)} suitable dishes were served to an attendee within their minimum gap (SPEC-Q-15)`;
  }
  const evaluated: Candidate[] = [];
  for (let start = 0; start < open.length; start += PRE_SCORE_TOP_K) {
    for (const dish of open.slice(start, start + PRE_SCORE_TOP_K))
      evaluated.push(run.evaluate(spec, dish));
    const eligible = evaluated.filter((c) => c.eligible);
    if (eligible.length > 0) return { eligible, evaluated, relaxed };
  }
  return { eligible: [], evaluated, relaxed };
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
    variantLimits: candidate.variantLimits,
    explain: [
      ...(choice.relaxed === null ? [] : [choice.relaxed]),
      ...candidate.explain,
      ...(candidate.eligible
        ? []
        : [
            `No candidate had every targeted plate in tolerance; least-bad dish ${candidate.dish.name} used (PLN-8)`,
          ]),
    ],
  };
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
  const lockedByKey = new Map(locked.map((m) => [mealKey(m.date, m.slotTypeId, m.memberScope), m]));
  let states: State[] = [{ choices: [], served: [], total: 0, path: "" }];

  // Locked meals whose slot no longer exists for the date are kept too (PLN-13).
  const specKeys = new Set(specs.map((s) => mealKey(date, s.slot.id, s.memberScope)));
  for (const m of locked) {
    const key = mealKey(m.date, m.slotTypeId, m.memberScope);
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
    const key = mealKey(date, spec.slot.id, spec.memberScope);
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
        path: `${s.path}/${fixed.dishId}`,
      }));
      continue;
    }

    let ranked = rankedPool(run, spec, history);
    const expand = (state: State) => {
      const context = [...history, ...state.served];
      const { eligible, evaluated, relaxed } = candidatesFor(run, spec, ranked, context);
      const picks =
        eligible.length > 0 ? eligible : [leastBad(evaluated)].filter((c) => c !== undefined);
      const meta = { date, attendees: spec.attendees, timeKey, mealKey: key };
      return {
        eligibleCount: eligible.length,
        children: picks.map((candidate) => {
          const score = run.score(meta, candidate.dish, candidate.plates, context);
          const served = run.served(
            date,
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
            path: `${state.path}/${candidate.dish.id}`,
          } satisfies State;
        }),
      };
    };

    let expansions = states.map(expand);
    const first = expansions[0];
    const best =
      first === undefined
        ? 0
        : Math.max(0, ...first.children.map((c) => c.total - (states[0]?.total ?? 0)));
    const count = first?.eligibleCount ?? 0;
    if (count < AI_MIN_CANDIDATES || best < AI_MIN_BEST_SCORE) {
      const reason =
        count < AI_MIN_CANDIDATES
          ? `only ${String(count)} candidate(s) pass the filters and the solver (< ${String(AI_MIN_CANDIDATES)})`
          : `best score ${best.toFixed(2)} is below ${String(AI_MIN_BEST_SCORE)}`;
      const mode = run.weightsOn(date).aiGeneration;
      const request = generationRequest(run, spec, history, reason);
      if (mode === "ask") out.generationRequests.push(request);
      else if (mode === "auto" && opts.requestDishes !== undefined) {
        opts.onProgress?.({ type: "ai_generating", date, slotKey: spec.slot.key, reason });
        const dishes = await opts.requestDishes(request);
        for (const d of dishes) run.pool.add(d, false);
        ranked = rankedPool(run, spec, history);
        expansions = states.map(expand);
      }
    }

    const children = expansions.flatMap((e) => e.children);
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
    children.sort(
      (a, b) =>
        b.total - a.total ||
        seededUnit(run.seed, a.path) - seededUnit(run.seed, b.path) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
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
  for (const c of bestState.choices)
    if (c.relaxed !== null)
      out.flags.push({
        kind: "frequency_relaxed",
        date,
        slotKey: c.spec.slot.key,
        memberId: c.spec.kind === "individual" ? c.spec.memberScope : null,
        reason: `${c.relaxed}; ${c.candidate.dish.name} used`,
      });
  return bestState.choices.map((c) => (c.locked === null ? plannedMeal(run, c) : c.locked));
}
