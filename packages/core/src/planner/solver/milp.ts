// PLN-5 plate model for one variant combination, and the same objective evaluated in TypeScript.
//
// Columns: one grid integer per main component (grams = unit · x), then per adjuster option a grid
// integer and a use binary, then the positive and negative deviation of each macro, then one
// naturalness deviation per main component, then (soft mode with a cap) the sat-fat excess.
import type { Nutrients } from "../../nutrition/index.js";
import type { CarbBasis } from "../targets/index.js";
import {
  LAMBDA_ADJUSTER,
  LAMBDA_RATIO,
  LAMBDA_SAT_FAT,
  LAMBDA_SOLUBLE_FIBRE,
  MAX_ADJUSTERS,
} from "./config.js";
import { SolverError } from "./errors.js";
import type { Milp } from "./highs.js";
import type { ComponentForSolve, MacroKey } from "./types.js";

export const MACROS: readonly MacroKey[] = ["kcal", "protein", "carbs", "fat"];

/** The grams grid of a component: grams = unit · k with k in [kMin, kMax], or 0 if optional. */
export type Grid = { unit: number; kMin: number; kMax: number; optional: boolean };

/**
 * PLN-5 / SPEC-Q-10. `continuous` steps by `step_g`, `unit` by `unit_weight_g`; a `fixed`
 * component is exactly its default serving (or 0 g when not required).
 */
export function gridOf(component: ComponentForSolve): Grid {
  const optional = !component.required;
  if (component.portioning === "fixed")
    return { unit: component.defaultServingG, kMin: 1, kMax: 1, optional };
  const unit = component.portioning === "unit" ? component.unitWeightG : component.stepG;
  if (unit === null || !(unit > 0))
    throw new SolverError(
      "invalid_input",
      `component ${component.id}: ${component.portioning} portioning needs a positive ${component.portioning === "unit" ? "unit_weight_g" : "step_g"}`,
    );
  const kMin = Math.max(0, Math.ceil(component.minServingG / unit - 1e-9));
  const kMax = Math.floor(component.maxServingG / unit + 1e-9);
  if (kMin > kMax || (kMax === 0 && component.required))
    throw new SolverError(
      "invalid_input",
      `component ${component.id}: no ${String(unit)} g grid point lies in [${String(component.minServingG)}, ${String(component.maxServingG)}] g`,
    );
  return { unit, kMin, kMax, optional };
}

/** Nutrient per gram of a variant for a macro on the target's carbohydrate basis. */
export function perGram(n: Nutrients, macro: MacroKey, basis: CarbBasis): number {
  if (macro === "carbs") return (basis === "total" ? n.carbs + n.fibre : n.carbs) / 100;
  return n[macro] / 100;
}

/** A plate macro value on the carbohydrate basis. */
export function macroValue(n: Nutrients, macro: MacroKey, basis: CarbBasis): number {
  return macro === "carbs" ? (basis === "total" ? n.carbs + n.fibre : n.carbs) : n[macro];
}

export type MainTerm = {
  grid: Grid;
  /** null: no allowed variant, served 0 g. */
  per100g: Nutrients | null;
  /** Share of the reference plate, `default_serving_g / Σ default_serving_g`. */
  rho: number;
};

export type AdjusterTerm = { grid: Grid; per100g: Nutrients; dishIndex: number };

export type PlateModelInput = {
  main: readonly MainTerm[];
  adjusters: readonly AdjusterTerm[];
  target: Record<MacroKey, number>;
  tol: Record<MacroKey, number>;
  basis: CarbBasis;
  satFatMax: number | undefined;
  /** Reference plate weight, Σ default_serving_g. */
  gRef: number;
  /** Hard tolerances and cap (strict stage and adjuster retry) or soft (least deviation). */
  hard: boolean;
  /** The LP relaxation (every column continuous, optional components from 0): a lower bound. */
  relaxed?: boolean;
};

/** Objective weight of a unit of deviation: 1 / tol (a zero tolerance weighs like 1). */
export function deviationWeight(tol: number): number {
  return tol > 0 ? 1 / tol : 1;
}

export type PlateModel = {
  milp: Milp;
  mainCol: (i: number) => number;
  adjusterCols: (j: number) => { x: number; y: number };
};

export function buildPlateModel(input: PlateModelInput): PlateModel {
  const { main, adjusters, target, tol, basis, satFatMax, gRef, hard } = input;
  const relaxed = input.relaxed ?? false;
  const colCost: number[] = [];
  const colLower: number[] = [];
  const colUpper: number[] = [];
  const integrality: (0 | 1 | 3)[] = [];
  const addCol = (cost: number, lower: number, upper: number, type: 0 | 1 | 3): number => {
    colCost.push(cost);
    // The relaxation drops integrality; a semi-integer column relaxes to [0, upper].
    colLower.push(relaxed && type === 3 ? 0 : lower);
    colUpper.push(upper);
    integrality.push(relaxed ? 0 : type);
    return colCost.length - 1;
  };
  const nutrientCost = (n: Nutrients, unit: number) =>
    unit *
    ((-LAMBDA_SOLUBLE_FIBRE * (n.solubleFibre ?? 0)) / 100 + (LAMBDA_SAT_FAT * n.satFat) / 100);

  const mainCols = main.map((term) => {
    const { unit, kMin, kMax, optional } = term.grid;
    if (term.per100g === null) return addCol(0, 0, 0, 1);
    const cost = nutrientCost(term.per100g, unit);
    if (!optional) return addCol(cost, kMin, kMax, 1);
    // Optional: 0 or within [kMin, kMax] (semi-integer when kMin > 0).
    return kMin > 0 ? addCol(cost, kMin, kMax, 3) : addCol(cost, 0, kMax, 1);
  });
  const adjCols = adjusters.map((term) => {
    const x = addCol(nutrientCost(term.per100g, term.grid.unit), 0, term.grid.kMax, 1);
    const y = addCol(LAMBDA_ADJUSTER, 0, 1, 1);
    return { x, y };
  });
  const inf = Infinity;
  const devCols = MACROS.map((m) => {
    const w = deviationWeight(tol[m]);
    const bound = hard ? tol[m] : inf;
    return { plus: addCol(w, 0, bound, 0), minus: addCol(w, 0, bound, 0) };
  });
  const ratioCols = main.map(() => addCol(LAMBDA_RATIO / gRef, 0, inf, 0));
  const satExcessCol =
    !hard && satFatMax !== undefined ? addCol(deviationWeight(tol.fat), 0, inf, 0) : undefined;

  const rows: Milp["rows"] = [];
  const add = (entries: Map<number, number>, col: number, value: number) => {
    entries.set(col, (entries.get(col) ?? 0) + value);
  };
  // Macro rows: Σ nutrient·grams − dev⁺ + dev⁻ = target.
  MACROS.forEach((m, mi) => {
    const entries = new Map<number, number>();
    main.forEach((term, i) => {
      if (term.per100g !== null)
        add(entries, mainCols[i] ?? -1, term.grid.unit * perGram(term.per100g, m, basis));
    });
    adjusters.forEach((term, j) => {
      add(entries, adjCols[j]?.x ?? -1, term.grid.unit * perGram(term.per100g, m, basis));
    });
    const dev = devCols[mi];
    if (dev !== undefined) {
      add(entries, dev.plus, -1);
      add(entries, dev.minus, 1);
    }
    rows.push({ lower: target[m], upper: target[m], entries });
  });
  // Saturated-fat cap: hard, or soft through the excess column.
  if (satFatMax !== undefined) {
    const entries = new Map<number, number>();
    main.forEach((term, i) => {
      if (term.per100g !== null)
        add(entries, mainCols[i] ?? -1, (term.grid.unit * term.per100g.satFat) / 100);
    });
    adjusters.forEach((term, j) => {
      add(entries, adjCols[j]?.x ?? -1, (term.grid.unit * term.per100g.satFat) / 100);
    });
    if (satExcessCol !== undefined) add(entries, satExcessCol, -1);
    rows.push({ lower: -inf, upper: satFatMax, entries });
  }
  // Naturalness: u_i ≥ |g_i − ρ_i·G| with G = Σ g over main components.
  main.forEach((term, i) => {
    for (const sign of [1, -1]) {
      const entries = new Map<number, number>();
      main.forEach((other, j) => {
        add(entries, mainCols[j] ?? -1, -sign * term.rho * other.grid.unit);
      });
      add(entries, mainCols[i] ?? -1, sign * term.grid.unit);
      add(entries, ratioCols[i] ?? -1, -1);
      rows.push({ lower: -inf, upper: 0, entries });
    }
  });
  // Adjusters: x within [kMin·y, kMax·y]; at most MAX_ADJUSTERS; one variant per adjuster dish.
  if (adjusters.length > 0) {
    const all = new Map<number, number>();
    const perDish = new Map<number, Map<number, number>>();
    adjusters.forEach((term, j) => {
      const cols = adjCols[j];
      if (cols === undefined) return;
      rows.push({
        lower: 0,
        upper: inf,
        entries: new Map([
          [cols.x, 1],
          [cols.y, -Math.max(1, term.grid.kMin)],
        ]),
      });
      rows.push({
        lower: -inf,
        upper: 0,
        entries: new Map([
          [cols.x, 1],
          [cols.y, -term.grid.kMax],
        ]),
      });
      add(all, cols.y, 1);
      const dish = perDish.get(term.dishIndex) ?? new Map<number, number>();
      add(dish, cols.y, 1);
      perDish.set(term.dishIndex, dish);
    });
    rows.push({ lower: -inf, upper: MAX_ADJUSTERS, entries: all });
    for (const entries of perDish.values())
      if (entries.size > 1) rows.push({ lower: -inf, upper: 1, entries });
  }
  return {
    milp: { colCost, colLower, colUpper, integrality, rows },
    mainCol: (i) => mainCols[i] ?? -1,
    adjusterCols: (j) => adjCols[j] ?? { x: -1, y: -1 },
  };
}

/**
 * The PLN-5 objective of a plate, recomputed from its grams (appeal excluded): centring,
 * naturalness, soluble fibre, sat fat, adjuster count, and soft sat-fat excess.
 */
export function plateObjective(args: {
  mainGrams: readonly number[];
  main: readonly MainTerm[];
  adjusterGrams: readonly number[];
  adjusters: readonly AdjusterTerm[];
  actual: Nutrients;
  target: Record<MacroKey, number>;
  tol: Record<MacroKey, number>;
  basis: CarbBasis;
  satFatMax: number | undefined;
  gRef: number;
  hard: boolean;
}): number {
  const { mainGrams, main, adjusterGrams, adjusters, actual, target, tol, basis } = args;
  let total = 0;
  for (const m of MACROS)
    total += Math.abs(macroValue(actual, m, basis) - target[m]) * deviationWeight(tol[m]);
  const plate = mainGrams.reduce((a, b) => a + b, 0);
  main.forEach((term, i) => {
    total += (LAMBDA_RATIO * Math.abs((mainGrams[i] ?? 0) - term.rho * plate)) / args.gRef;
  });
  const knownSolubleFibre = (n: Nutrients | null, g: number) => ((n?.solubleFibre ?? 0) * g) / 100;
  let solubleFibre = 0;
  main.forEach((term, i) => (solubleFibre += knownSolubleFibre(term.per100g, mainGrams[i] ?? 0)));
  adjusters.forEach(
    (term, j) => (solubleFibre += knownSolubleFibre(term.per100g, adjusterGrams[j] ?? 0)),
  );
  total += -LAMBDA_SOLUBLE_FIBRE * solubleFibre + LAMBDA_SAT_FAT * actual.satFat;
  total += LAMBDA_ADJUSTER * adjusterGrams.filter((g) => g > 0).length;
  if (!args.hard && args.satFatMax !== undefined)
    total += Math.max(0, actual.satFat - args.satFatMax) * deviationWeight(tol.fat);
  return total;
}
