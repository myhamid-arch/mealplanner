// One plan run: the pool, the household context, the slot targets, the per-run solve cache
// (ADR-1 §1) and candidate evaluation (plates, PLN-8 eligibility, PLN-9 §6.4 variant merging).
import type { HouseholdConfig, SlotTypeRow } from "../../types/index.js";
import { solvePlate, type PlateSolution } from "../solver/index.js";
import { resolveSlotTargets, type SlotTarget } from "../targets/index.js";
import { MACRO_EPSILON } from "./config.js";
import {
  dayNumber,
  frequencyReason,
  laterThan,
  neverReason,
  passesExclusions,
  plannable,
  suitsSlot,
  type Served,
} from "./filters.js";
import { mealKey, type MealSpec } from "./meals.js";
import { Household } from "./members.js";
import { Pool, servedVariantIds } from "./pool.js";
import { scoreDish, type ScoreInput } from "./score.js";
import type { PlanDish, PlannedPlate, PlanWeights, ScoreBreakdown } from "./types.js";
import { weightsFor } from "./weights.js";

const MACROS = ["kcal", "protein", "carbs", "fat"] as const;

/** What a meal's score needs to know about the meal itself. */
export type ScoredMeal = {
  date: string;
  attendees: readonly string[];
  timeKey: string;
  mealKey: string;
};
export type MealParts = Omit<ScoreInput, "window" | "previous">;
export type MealContext = Pick<ScoreInput, "window" | "previous">;

/** Component id → the variant ids a plate may use (PLN-9 §6.4 merges, R-28 re-solves). */
export type VariantLimits = Record<string, string[]>;

/** A candidate dish solved for every attendee of a meal against the resolver's targets. */
export type Candidate = {
  dish: PlanDish;
  plates: PlannedPlate[];
  /** PLN-8: no plate infeasible (strict: every targeted plate in tolerance, adjusters allowed). */
  eligible: boolean;
  /** Least-bad order: Σ over targeted plates of Σ|dev| / tol. */
  badness: number;
  variantLimits: VariantLimits;
  explain: string[];
};

/**
 * `solvePlate` is pure, so its results are memoised by input: per dish object (a WeakMap, so a dish
 * that is no longer referenced releases its entries), then by member context, target, the adjuster
 * objects offered and the variant limits. Identity keys the objects, so an edited dish or adjuster
 * (a new object) never reuses an old solution.
 */
const SOLVE_MEMO = new WeakMap<PlanDish, Map<string, PlateSolution>>();
const OBJECT_IDS = new WeakMap<object, number>();
let nextObjectId = 1;
function objectId(o: object): number {
  let id = OBJECT_IDS.get(o);
  if (id === undefined) {
    id = nextObjectId++;
    OBJECT_IDS.set(o, id);
  }
  return id;
}

export class Run {
  readonly pool: Pool;
  readonly household: Household;
  readonly stats = { solves: 0, cacheHits: 0 };
  private readonly candidateCache = new Map<string, Candidate>();
  /** Candidates evaluated per meal (key without the dish), in evaluation order. */
  private readonly evaluatedByMeal = new Map<string, Candidate[]>();
  private readonly targets = new Map<string, Map<string, SlotTarget>>();
  private readonly weights = new Map<string, PlanWeights>();

  constructor(
    readonly cfg: HouseholdConfig,
    dishes: readonly PlanDish[],
    adjusters: readonly PlanDish[],
    readonly seed: number,
  ) {
    this.pool = new Pool(dishes, adjusters);
    this.household = new Household(cfg, this.pool);
  }

  weightsOn(date: string): PlanWeights {
    let w = this.weights.get(date);
    if (w === undefined) {
      w = weightsFor(this.cfg, date);
      this.weights.set(date, w);
    }
    return w;
  }

  /** The resolver's target for a targeted member at a slot on a date (PLN-4); null if untargeted. */
  target(date: string, memberId: string, slotTypeId: string): SlotTarget | null {
    let byKey = this.targets.get(date);
    if (byKey === undefined) {
      byKey = new Map(
        resolveSlotTargets(this.cfg, date).map((t) => [`${t.memberId}|${t.slotTypeId}`, t]),
      );
      this.targets.set(date, byKey);
    }
    return byKey.get(`${memberId}|${slotTypeId}`) ?? null;
  }

  /** Every resolver target of a member on a date (PLN-4). */
  targetsOf(date: string, memberId: string): SlotTarget[] {
    this.target(date, memberId, "");
    return [...(this.targets.get(date)?.values() ?? [])].filter((t) => t.memberId === memberId);
  }

  /** Adjusters offered at a slot (PLN-6, SPEC-Q-7). */
  adjustersFor(slot: SlotTypeRow, weights: PlanWeights): PlanDish[] {
    if (!weights.adjustersEnabled) return [];
    const disabled = new Set(this.cfg.adjusters.filter((a) => !a.enabled).map((a) => a.dishId));
    return [...this.pool.adjusters.values()].filter(
      (a) => !disabled.has(a.id) && plannable(a) && suitsSlot(a, slot),
    );
  }

  /** Dishes that pass the state-independent filters for a meal (PLN-9 §6.3 without frequency). */
  eligiblePool(meal: MealSpec): PlanDish[] {
    const adjusters: PlanDish[] = [];
    return [...this.pool.dishes.values()].filter(
      (d) =>
        plannable(d) &&
        suitsSlot(d, meal.slot) &&
        passesExclusions(
          d,
          meal.attendees.map((m) => this.household.ctx(m, meal.slot, d, adjusters)),
        ) &&
        neverReason(d, meal.attendees, this.household, this.pool) === null,
    );
  }

  frequencyBlocked(dish: PlanDish, meal: MealSpec, history: readonly Served[]): boolean {
    return (
      frequencyReason(
        dish,
        meal.date,
        meal.attendees,
        history,
        this.cfg.frequencyRules,
        this.pool,
      ) !== null
    );
  }

  /** `solvePlate`, memoised (ADR-1 §1). */
  solve(
    dish: PlanDish,
    memberId: string,
    slot: SlotTypeRow,
    target: SlotTarget | null,
    limits: VariantLimits,
  ): PlateSolution {
    const weights = target === null ? null : this.weightsOn(target.date);
    const adjusters = weights === null ? [] : this.adjustersFor(slot, weights);
    const member = this.household.ctx(memberId, slot, dish, adjusters);
    const key = JSON.stringify([
      member,
      target === null
        ? null
        : [
            target.kcal,
            target.protein,
            target.carbs,
            target.fat,
            target.satFatMax ?? null,
            target.fibreGoal ?? null,
            target.solubleFibreGoal ?? null,
            target.tol,
            target.mode,
            target.carbBasis,
          ],
      adjusters.map(objectId),
      limits,
    ]);
    let memo = SOLVE_MEMO.get(dish);
    if (memo === undefined) {
      memo = new Map();
      SOLVE_MEMO.set(dish, memo);
    }
    const hit = memo.get(key);
    if (hit !== undefined) {
      this.stats.cacheHits++;
      return hit;
    }
    this.stats.solves++;
    const solution = solvePlate({ dish: limitVariants(dish, limits), target, member, adjusters });
    memo.set(key, solution);
    return solution;
  }

  plate(
    dish: PlanDish,
    memberId: string,
    slot: SlotTypeRow,
    target: SlotTarget | null,
    resolverTarget: SlotTarget | null,
    limits: VariantLimits,
  ): PlannedPlate {
    const solution = this.solve(dish, memberId, slot, target, limits);
    return {
      memberId,
      targeted: target !== null,
      fitStatus: solution.status,
      target,
      resolverTarget,
      solution,
      flag: flagOf(solution),
    };
  }

  /** The candidate's plates at the resolver's targets, with PLN-9 §6.4 merging (cached). */
  evaluate(meal: MealSpec, dish: PlanDish): Candidate {
    const mealId = `${mealKey(meal.date, meal.slot.id, meal.memberScope)}|${meal.attendees.join(",")}`;
    const key = `${mealId}|${dish.id}`;
    const hit = this.candidateCache.get(key);
    if (hit !== undefined) return hit;
    const limits: VariantLimits = {};
    const explain: string[] = [];
    const solveAll = () =>
      meal.attendees.map((m) => {
        const t = this.target(meal.date, m, meal.slot.id);
        return this.plate(dish, m, meal.slot, t, t, limits);
      });
    let plates = solveAll();
    const max = this.weightsOn(meal.date).maxVariantsPerComponent;
    for (;;) {
      const merge = variantToMerge(dish, plates, max, (m, v) =>
        this.household.appeal(m, dish, [v]),
      );
      if (merge === null) break;
      limits[merge.componentId] = merge.keep;
      explain.push(
        `Variant limit ${String(max)} per component: ${merge.dropped} merged into ${merge.into}`,
      );
      plates = solveAll();
    }
    const candidate: Candidate = {
      dish,
      plates,
      eligible: plates.every((p) => p.fitStatus !== "infeasible"),
      badness: plates.reduce((s, p) => s + badnessOf(p), 0),
      variantLimits: limits,
      explain,
    };
    this.candidateCache.set(key, candidate);
    const list = this.evaluatedByMeal.get(mealId) ?? [];
    list.push(candidate);
    this.evaluatedByMeal.set(mealId, list);
    return candidate;
  }

  /** Every candidate solved for the meal so far (the day search's top-K blocks). */
  evaluated(meal: MealSpec): readonly Candidate[] {
    return (
      this.evaluatedByMeal.get(
        `${mealKey(meal.date, meal.slot.id, meal.memberScope)}|${meal.attendees.join(",")}`,
      ) ?? []
    );
  }

  /** The parts of a meal's PLN-9 score that depend only on its own dish and plates. */
  parts(dish: PlanDish, plates: readonly PlannedPlate[], date: string): MealParts {
    const variantIds = servedVariantIds(plates);
    const perComponent: Record<string, number> = {};
    for (const c of dish.components)
      perComponent[c.id] = c.variants.filter((v) => variantIds.has(v.id)).length;
    return {
      dish,
      plates: plates.map((p) => ({
        memberId: p.memberId,
        targeted: p.targeted,
        fit: p.solution.fit,
        appeal: this.household.appeal(
          p.memberId,
          dish,
          p.solution.items.map((i) => i.variantId),
        ),
      })),
      ingredients: this.pool.coreOf(variantIds),
      variantsPerComponent: perComponent,
      mainProtein: this.pool.mainProteinOf(dish, variantIds),
      weights: this.weightsOn(date),
      label: this.labels,
    };
  }

  /** The window and previous-meal context of a meal among the other served meals (SPEC-Q-9). */
  context(meal: ScoredMeal, cuisineKey: string, others: readonly Served[]): MealContext {
    const n = this.weightsOn(meal.date).economyWindowDays;
    const attending = new Set(meal.attendees);
    const day = dayNumber(meal.date);
    const windowIngredients = new Set<string>();
    const cuisineDates = new Set<string>();
    let previous: Served | null = null;
    for (const s of others) {
      if (s.mealKey === meal.mealKey) continue;
      if (Math.abs(s.day - day) <= n - 1) {
        for (const i of s.core) windowIngredients.add(i);
        if (s.cuisineKey === cuisineKey && s.memberIds.some((m) => attending.has(m)))
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
      window: { ingredients: windowIngredients, cuisineMealDays: cuisineDates.size },
      previous: previous === null ? null : this.previousOf(previous),
    };
  }

  previousOf(s: Served): NonNullable<MealContext["previous"]> {
    return {
      cuisineKey: s.cuisineKey,
      mainProtein: s.mainProtein,
      dishName: this.pool.dish(s.dishId)?.name ?? s.dishId,
    };
  }

  /** PLN-9 score of a meal's dish and plates in the context of every other served meal. */
  score(
    meal: ScoredMeal,
    dish: PlanDish,
    plates: readonly PlannedPlate[],
    others: readonly Served[],
  ): ScoreBreakdown {
    return scoreDish({
      ...this.parts(dish, plates, meal.date),
      ...this.context(meal, dish.cuisineKey, others),
    });
  }

  private readonly labels = {
    ingredient: (id: string) => this.pool.slugById.get(id) ?? id,
    member: (id: string) => this.household.member(id).displayName,
  };

  /** The meal as the frequency filter and the economy window see it. */
  served(
    date: string,
    slotTypeId: string,
    memberScope: string,
    dishId: string,
    plates: readonly PlannedPlate[],
  ): Served {
    const variantIds = servedVariantIds(plates);
    const dish = this.pool.dish(dishId);
    return {
      date,
      day: dayNumber(date),
      mealKey: mealKey(date, slotTypeId, memberScope),
      dishId,
      memberIds: plates.map((p) => p.memberId),
      cuisineKey: dish?.cuisineKey ?? "",
      methodKeys: [
        ...new Set([...variantIds].flatMap((v) => this.pool.variant(v)?.variant.methodKey ?? [])),
      ],
      core: this.pool.coreOf(variantIds),
      mainProtein: dish === undefined ? null : this.pool.mainProteinOf(dish, variantIds),
      timeKey: this.timeKeyOf(slotTypeId),
    };
  }

  timeKeyOf(slotTypeId: string): string {
    const slot = this.cfg.slotTypes.find((s) => s.id === slotTypeId);
    if (slot === undefined) return "99:99:99|999999|";
    return `${slot.defaultTime}|${String(slot.sortOrder).padStart(6, "0")}|${slot.key}`;
  }
}

/** The dish with each limited component's variants cut to the allowed ones. */
export function limitVariants<D extends PlanDish>(dish: D, limits: VariantLimits): D {
  if (Object.keys(limits).length === 0) return dish;
  return {
    ...dish,
    components: dish.components.map((c) => {
      const keep = limits[c.id];
      return keep === undefined
        ? c
        : { ...c, variants: c.variants.filter((v) => keep.includes(v.id)) };
    }),
  };
}

/**
 * PLN-9 §6.4: the next merge when a component is served in more than `max` distinct variants. The
 * least-appealing variant (summed over the plates that use it) merges into the nearest remaining
 * one by per-100 g protein, carbs and fat; ties go to component order.
 */
export function variantToMerge(
  dish: PlanDish,
  plates: readonly PlannedPlate[],
  max: number,
  appeal: (memberId: string, variantId: string) => number,
): { componentId: string; keep: string[]; dropped: string; into: string } | null {
  for (const c of dish.components) {
    const served = c.variants.filter((v) =>
      plates.some((p) => p.solution.items.some((i) => i.variantId === v.id)),
    );
    if (served.length <= Math.max(1, max)) continue;
    const total = (vId: string) =>
      plates
        .filter((p) => p.solution.items.some((i) => i.variantId === vId))
        .reduce((s, p) => s + appeal(p.memberId, vId), 0);
    const [drop] = [...served].sort((a, b) => total(a.id) - total(b.id));
    if (drop === undefined) continue;
    const rest = served.filter((v) => v !== drop);
    const dist = (v: (typeof rest)[number]) =>
      Math.hypot(
        v.per100g.protein - drop.per100g.protein,
        v.per100g.carbs - drop.per100g.carbs,
        v.per100g.fat - drop.per100g.fat,
      );
    const [into] = [...rest].sort((a, b) => dist(a) - dist(b));
    if (into === undefined) continue;
    return { componentId: c.id, keep: rest.map((v) => v.id), dropped: drop.id, into: into.id };
  }
  return null;
}

function badnessOf(p: PlannedPlate): number {
  if (p.target === null) return 0;
  const t = p.target;
  return MACROS.reduce(
    (s, m) =>
      s +
      (t.tol[m] > 0
        ? Math.abs(p.solution.deviation[m]) / t.tol[m]
        : Math.abs(p.solution.deviation[m])),
    0,
  );
}

/** PLN-8 / SC-1: the reason a targeted plate is not in tolerance, with its smallest deviation. */
export function flagOf(solution: PlateSolution): string | null {
  if (solution.status === "in_tolerance" || solution.status === "untargeted") return null;
  const lines = solution.explain.filter(
    (l) => l.startsWith("Infeasible") || l.startsWith("Flexible") || l.startsWith("Deviation"),
  );
  return lines.length > 0 ? lines.join("; ") : solution.status;
}

/** True when the plate's macros are within the target's tolerances and sat-fat cap. */
export function withinTarget(solution: PlateSolution, target: SlotTarget): boolean {
  const n = solution.actual;
  const value = (m: (typeof MACROS)[number]) =>
    m === "carbs" ? (target.carbBasis === "total" ? n.carbs + n.fibre : n.carbs) : n[m];
  return (
    MACROS.every((m) => Math.abs(value(m) - target[m]) <= target.tol[m] + MACRO_EPSILON) &&
    (target.satFatMax === undefined || n.satFat <= target.satFatMax + MACRO_EPSILON)
  );
}
