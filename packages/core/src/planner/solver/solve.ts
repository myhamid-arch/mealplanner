// PLN-5 … 8: solve one plate (one member, one dish, one slot target).
//
// Strict: the best in-tolerance combination; else the best with ≤ 2 adjusters (PLN-6); else the
// least-deviation plate, marked infeasible (SPEC-Q-12). Flexible: the least-deviation plate; if it
// misses, adjusters are tried with hard tolerances; else it is a flexible miss (SPEC-Q-11).
// Every plate's status comes from re-checking its grid grams with plateNutrients (BLD-8 R-25).
import { plateNutrients, type Nutrients } from "../../nutrition/index.js";
import type { SlotTarget } from "../targets/index.js";
import { appealOf, enumerateCombinations } from "./combos.js";
import { CHECK_EPSILON, LAMBDA_APPEAL, TIME_LIMIT_PER_COMBINATION_S } from "./config.js";
import { adjusterOptions, variantAllowed, type AdjusterOption } from "./eligibility.js";
import { SolverError } from "./errors.js";
import { highsRuntime, solveMilp } from "./highs.js";
import {
  MACROS,
  buildPlateModel,
  deviationWeight,
  gridOf,
  macroValue,
  plateObjective,
  type AdjusterTerm,
  type MainTerm,
} from "./milp.js";
import type {
  DishForSolve,
  MacroKey,
  MemberCtx,
  PlateSolution,
  SolvePlateInput,
  VariantForSolve,
} from "./types.js";
import { solveUntargeted } from "./untargeted.js";

type Combo = (VariantForSolve | null)[];

type Candidate = {
  combo: Combo;
  mainGrams: number[];
  adjusters: Array<{ option: AdjusterOption; cookedG: number }>;
  actual: Nutrients;
  deviation: Record<MacroKey, number>;
  inTolerance: boolean;
  objective: number;
};

type Problem = {
  dish: DishForSolve;
  target: SlotTarget;
  member: MemberCtx;
  targetValues: Record<MacroKey, number>;
  gRef: number;
  rhos: number[];
};

function assertValidDish(dish: DishForSolve, role: string): void {
  if (dish.components.length === 0)
    throw new SolverError("invalid_input", `${role} ${dish.id} has no components`);
  for (const c of dish.components) {
    if (!(c.minServingG >= 0 && c.maxServingG >= c.minServingG && c.defaultServingG >= 0))
      throw new SolverError(
        "invalid_input",
        `component ${c.id}: serving bounds must satisfy 0 ≤ min ≤ max and default ≥ 0`,
      );
    if (c.variants.length === 0)
      throw new SolverError("invalid_input", `component ${c.id} has no variants`);
    for (const v of c.variants)
      for (const key of ["kcal", "protein", "carbs", "fat", "satFat", "fibre"] as const)
        if (!(Number.isFinite(v.per100g[key]) && v.per100g[key] >= 0))
          throw new SolverError(
            "invalid_input",
            `variant ${v.id}: ${key} per 100 g must be a finite number ≥ 0`,
          );
  }
}

/** A combination's appeal: mean appeal of the served components' variants (SPEC-Q-16). */
function comboAppeal(combo: Combo, grams: readonly number[], member: MemberCtx): number {
  const served = combo.filter((v, i): v is VariantForSolve => v !== null && (grams[i] ?? 0) > 0);
  if (served.length === 0) return 0;
  return served.reduce((sum, v) => sum + appealOf(v, member), 0) / served.length;
}

function evaluate(
  p: Problem,
  combo: Combo,
  main: readonly MainTerm[],
  mainGrams: number[],
  adjusterTerms: readonly AdjusterTerm[],
  options: readonly AdjusterOption[],
  adjusterGrams: number[],
  hard: boolean,
): Candidate {
  const items: Array<{ per100g: Nutrients; cookedG: number }> = [];
  combo.forEach((variant, i) => {
    const g = mainGrams[i] ?? 0;
    if (variant !== null && g > 0) items.push({ per100g: variant.per100g, cookedG: g });
  });
  const adjusters: Candidate["adjusters"] = [];
  options.forEach((option, j) => {
    const g = adjusterGrams[j] ?? 0;
    if (g > 0) {
      items.push({ per100g: option.variant.per100g, cookedG: g });
      adjusters.push({ option, cookedG: g });
    }
  });
  const actual = plateNutrients(items);
  const { tol, carbBasis, satFatMax } = p.target;
  const deviation = {} as Record<MacroKey, number>;
  for (const m of MACROS) deviation[m] = macroValue(actual, m, carbBasis) - p.targetValues[m];
  const inTolerance =
    MACROS.every((m) => Math.abs(deviation[m]) <= tol[m] + CHECK_EPSILON) &&
    (satFatMax === undefined || actual.satFat <= satFatMax + CHECK_EPSILON);
  const objective =
    plateObjective({
      mainGrams,
      main,
      adjusterGrams,
      adjusters: adjusterTerms,
      actual,
      target: p.targetValues,
      tol,
      basis: carbBasis,
      satFatMax,
      gRef: p.gRef,
      hard,
    }) -
    LAMBDA_APPEAL * comboAppeal(combo, mainGrams, p.member);
  return { combo, mainGrams, adjusters, actual, deviation, inTolerance, objective };
}

/**
 * Solves the combinations and returns the best candidate by objective (lowest combination index on
 * ties). With `hard`, only plates that pass the TypeScript tolerance re-check count.
 *
 * Exact pruning: each combination's LP relaxation bounds its objective from below (appeal can lower
 * it by at most λ_appeal · its best variant appeal). Combinations are solved in bound order and the
 * rest are skipped once a bound exceeds the best objective found; an infeasible relaxation means an
 * infeasible combination.
 */
function runStage(
  p: Problem,
  combos: readonly Combo[],
  options: readonly AdjusterOption[],
  hard: boolean,
): Candidate | undefined {
  const dishIds = [...new Set(options.map((o) => o.dishId))];
  const adjusterTerms: AdjusterTerm[] = options.map((o) => ({
    grid: gridOf(o.component),
    per100g: o.variant.per100g,
    dishIndex: dishIds.indexOf(o.dishId),
  }));
  const modelInput = (main: MainTerm[], relaxed: boolean) => ({
    main,
    adjusters: adjusterTerms,
    target: p.targetValues,
    tol: p.target.tol,
    basis: p.target.carbBasis,
    satFatMax: p.target.satFatMax,
    gRef: p.gRef,
    hard,
    relaxed,
  });
  const bounded: Array<{ index: number; combo: Combo; main: MainTerm[]; bound: number }> = [];
  combos.forEach((combo, index) => {
    const main: MainTerm[] = p.dish.components.map((component, i) => ({
      grid: gridOf(component),
      per100g: combo[i]?.per100g ?? null,
      rho: p.rhos[i] ?? 0,
    }));
    const lp = solveMilp(
      buildPlateModel(modelInput(main, true)).milp,
      TIME_LIMIT_PER_COMBINATION_S,
    );
    if (lp.status !== "solved") return;
    const bestAppeal = Math.max(
      0,
      ...combo.filter((v): v is VariantForSolve => v !== null).map((v) => appealOf(v, p.member)),
    );
    bounded.push({ index, combo, main, bound: lp.objective - LAMBDA_APPEAL * bestAppeal });
  });
  bounded.sort((a, b) => a.bound - b.bound || a.index - b.index);

  let best: (Candidate & { index: number }) | undefined;
  for (const { index, combo, main, bound } of bounded) {
    if (best !== undefined && bound > best.objective + 1e-9) break;
    const model = buildPlateModel(modelInput(main, false));
    const result = solveMilp(model.milp, TIME_LIMIT_PER_COMBINATION_S);
    if (result.status !== "solved") continue;
    const mainGrams = main.map((term, i) => {
      const k = Math.round(result.x[model.mainCol(i)] ?? 0);
      return term.per100g === null ? 0 : k * term.grid.unit;
    });
    const adjusterGrams = adjusterTerms.map((term, j) => {
      const cols = model.adjusterCols(j);
      const used = Math.round(result.x[cols.y] ?? 0) === 1;
      return used ? Math.round(result.x[cols.x] ?? 0) * term.grid.unit : 0;
    });
    const candidate = evaluate(
      p,
      combo,
      main,
      mainGrams,
      adjusterTerms,
      options,
      adjusterGrams,
      hard,
    );
    if (hard && !candidate.inTolerance) continue;
    if (
      best === undefined ||
      candidate.objective < best.objective - 1e-9 ||
      (candidate.objective <= best.objective + 1e-9 && index < best.index)
    )
      best = { ...candidate, index };
  }
  return best;
}

function fitOf(deviation: Record<MacroKey, number>, tol: Record<MacroKey, number>): number {
  const ratios = MACROS.map((m) =>
    tol[m] > 0
      ? Math.abs(deviation[m]) / tol[m]
      : Math.abs(deviation[m]) <= CHECK_EPSILON
        ? 0
        : Infinity,
  );
  const fit = 1 - ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return Math.min(1, Math.max(0, fit));
}

function describeDeviation(deviation: Record<MacroKey, number>, basis: string): string {
  const f = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
  return `protein ${f(deviation.protein)} g, carbs (${basis}) ${f(deviation.carbs)} g, fat ${f(deviation.fat)} g, kcal ${f(deviation.kcal)}`;
}

function toSolution(
  p: Problem,
  c: Candidate,
  status: PlateSolution["status"],
  explain: string[],
): PlateSolution {
  const items: PlateSolution["items"] = [];
  p.dish.components.forEach((component, i) => {
    const variant = c.combo[i];
    const g = c.mainGrams[i] ?? 0;
    if (variant !== null && variant !== undefined && g > 0)
      items.push({ componentId: component.id, variantId: variant.id, cookedG: g });
  });
  const adjusters = c.adjusters.map((a) => ({
    dishId: a.option.dishId,
    variantId: a.option.variant.id,
    cookedG: a.cookedG,
  }));
  for (const a of adjusters) explain.push(`+ side: adjuster ${a.dishId} ${String(a.cookedG)} g`);
  explain.push(`Deviation: ${describeDeviation(c.deviation, p.target.carbBasis)}`);
  return {
    status,
    items,
    adjusters,
    actual: c.actual,
    deviation: c.deviation,
    objective: c.objective,
    fit: status === "infeasible" ? 0 : fitOf(c.deviation, p.target.tol),
    explain,
  };
}

/** A plate with nothing served: a required component has no variant the member may eat. */
function emptyInfeasible(p: Problem, explain: string[]): PlateSolution {
  const actual = plateNutrients([]);
  const deviation = {} as Record<MacroKey, number>;
  for (const m of MACROS)
    deviation[m] = macroValue(actual, m, p.target.carbBasis) - p.targetValues[m];
  let objective = 0;
  for (const m of MACROS) objective += Math.abs(deviation[m]) * deviationWeight(p.target.tol[m]);
  return {
    status: "infeasible",
    items: [],
    adjusters: [],
    actual,
    deviation,
    objective,
    fit: 0,
    explain,
  };
}

/** PLN-5 (04 §11). Await `loadPortionSolver()` once before the first targeted solve. */
export function solvePlate(input: SolvePlateInput): PlateSolution {
  const { dish, target, member, adjusters } = input;
  assertValidDish(dish, "dish");
  if (target === null) return solveUntargeted(dish, member);
  if (target.memberId !== member.memberId)
    throw new SolverError(
      "invalid_input",
      `target is for member ${target.memberId}, member context is ${member.memberId}`,
    );
  highsRuntime();
  for (const a of adjusters) assertValidDish(a, "adjuster");

  const gRef = dish.components.reduce((sum, c) => sum + c.defaultServingG, 0);
  if (!(gRef > 0))
    throw new SolverError("invalid_input", `dish ${dish.id}: default servings sum to 0`);
  const p: Problem = {
    dish,
    target,
    member,
    targetValues: {
      kcal: target.kcal,
      protein: target.protein,
      carbs: target.carbs,
      fat: target.fat,
    },
    gRef,
    rhos: dish.components.map((c) => c.defaultServingG / gRef),
  };
  const explain: string[] = [];

  const allowed = dish.components.map((c) => c.variants.filter((v) => variantAllowed(v, member)));
  dish.components.forEach((c, i) => {
    const skipped = c.variants.length - (allowed[i]?.length ?? 0);
    if (skipped > 0)
      explain.push(
        `Component ${c.id}: ${String(skipped)} variant(s) skipped for this member's exclusions`,
      );
  });
  const blocked = dish.components.filter((c, i) => c.required && (allowed[i]?.length ?? 0) === 0);
  if (blocked.length > 0) {
    explain.push(
      `Infeasible: required component(s) ${blocked.map((c) => c.id).join(", ")} have no variant this member may eat`,
    );
    return emptyInfeasible(p, explain);
  }
  const { combos, pruned } = enumerateCombinations(allowed, member);
  if (pruned)
    explain.push(
      `More than 24 variant combinations: kept the top 3 variants per component by appeal`,
    );

  const eligible = adjusterOptions(adjusters, member);
  for (const r of eligible.rejected)
    explain.push(`Adjuster ${r.dishId} not eligible (${r.reason.replaceAll("_", " ")})`);
  const tryAdjusters = (): Candidate | undefined =>
    eligible.options.length > 0 ? runStage(p, combos, eligible.options, true) : undefined;

  if (target.mode === "strict") {
    const best = runStage(p, combos, [], true);
    if (best !== undefined) return toSolution(p, best, "in_tolerance", explain);
    const adjusted = tryAdjusters();
    if (adjusted !== undefined) {
      explain.push("No combination reaches tolerance alone; adjusters added");
      return toSolution(p, adjusted, "in_tolerance", explain);
    }
    const least = runStage(p, combos, [], false);
    if (least === undefined)
      throw new SolverError(
        "engine_error",
        `dish ${dish.id}: no plate found even without tolerances`,
      );
    explain.push("Infeasible in strict mode: showing the least-deviation plate");
    return toSolution(p, least, "infeasible", explain);
  }

  const soft = runStage(p, combos, [], false);
  if (soft === undefined)
    throw new SolverError(
      "engine_error",
      `dish ${dish.id}: no plate found even without tolerances`,
    );
  if (soft.inTolerance) return toSolution(p, soft, "in_tolerance", explain);
  const adjusted = tryAdjusters();
  if (adjusted !== undefined) {
    explain.push("The closest plate misses tolerance; adjusters added");
    return toSolution(p, adjusted, "in_tolerance", explain);
  }
  explain.push("Flexible mode: tolerance missed, showing the least-deviation plate");
  return toSolution(p, soft, "flexible_miss", explain);
}
