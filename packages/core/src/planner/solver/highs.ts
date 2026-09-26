// HiGHS (WebAssembly) through the `highs` package: load once, then synchronous solves
// (leaf-1.2.2 ADR-1).
import * as highsModule from "highs";
import type { Highs, InitOptions, ModelData } from "highs";
import { SolverError } from "./errors.js";

// The package ships one declaration file for a `"type": "commonjs"` package, so TypeScript types
// both the default import and the namespace's `default` as the module object. At run time Node
// resolves the ESM entry (`build/highs.mjs`), whose `default` export is the loader.
const loadHighs = (highsModule as unknown as { default: (o?: InitOptions) => Promise<Highs> })
  .default;

let runtime: Highs | undefined;
let loading: Promise<void> | undefined;

/** Loads the solver runtime. Idempotent; await it once before the first `solvePlate`. */
export function loadPortionSolver(): Promise<void> {
  loading ??= loadHighs()
    .then((highs) => {
      runtime = highs;
    })
    .catch((error: unknown) => {
      loading = undefined;
      throw new SolverError("engine_error", "the HiGHS runtime failed to load", { cause: error });
    });
  return loading;
}

export function highsRuntime(): Highs {
  if (runtime === undefined)
    throw new SolverError("not_loaded", "call and await loadPortionSolver() before solvePlate()");
  return runtime;
}

/** A MILP in row form: `rowLower ≤ A·x ≤ rowUpper`, `colLower ≤ x ≤ colUpper`, minimise `c·x`. */
export type Milp = {
  colCost: number[];
  colLower: number[];
  colUpper: number[];
  /** 0 continuous, 1 integer, 3 semi-integer (0 or within its bounds). */
  integrality: (0 | 1 | 3)[];
  rows: Array<{ lower: number; upper: number; entries: Map<number, number> }>;
};

export type MilpResult =
  { status: "solved"; x: number[]; objective: number } | { status: "no_solution" };

/**
 * Plate models are tiny (≤ ~40 columns). HiGHS's primal heuristics, restarts, symmetry detection
 * and cut separation below the root cost more than they save on them (measured: about 33 ms
 * against 6 ms per model, same optimum), so they are switched off. Optimality is still proven
 * (`mip_rel_gap` 0).
 */
const PLATE_OPTIONS = {
  output_flag: false,
  mip_rel_gap: 0,
  mip_feasibility_tolerance: 1e-9,
  primal_feasibility_tolerance: 1e-9,
  mip_heuristic_effort: 0,
  mip_heuristic_run_feasibility_jump: false,
  mip_heuristic_run_rins: false,
  mip_heuristic_run_rens: false,
  mip_heuristic_run_root_reduced_cost: false,
  mip_heuristic_run_zi_round: false,
  mip_heuristic_run_shifting: false,
  mip_allow_restart: false,
  mip_detect_symmetry: false,
  mip_allow_cut_separation_at_nodes: false,
} as const;

/** Solves one MILP with a time limit; a time-limited run counts only if it has a feasible point. */
export function solveMilp(milp: Milp, timeLimitS: number): MilpResult {
  const highs = highsRuntime();
  const starts: number[] = [0];
  const indices: number[] = [];
  const values: number[] = [];
  for (const row of milp.rows) {
    for (const [col, value] of [...row.entries].sort((a, b) => a[0] - b[0])) {
      if (value === 0) continue;
      indices.push(col);
      values.push(value);
    }
    starts.push(indices.length);
  }
  const data: ModelData = {
    numCols: milp.colCost.length,
    numRows: milp.rows.length,
    colCost: milp.colCost,
    colLower: milp.colLower,
    colUpper: milp.colUpper,
    rowLower: milp.rows.map((r) => r.lower),
    rowUpper: milp.rows.map((r) => r.upper),
    matrix: {
      format: "csr",
      numRows: milp.rows.length,
      numCols: milp.colCost.length,
      starts,
      indices,
      values,
    },
    integrality: milp.integrality,
  };
  const status = highs.constants.modelStatus;
  try {
    return highs.withModel(data, (model) => {
      model.options.set({ ...PLATE_OPTIONS, time_limit: timeLimitS });
      model.run();
      const code = model.getModelStatus();
      const hasPoint =
        code === status.optimal ||
        ((code === status.timeLimit || code === status.interrupted) &&
          model.info.get("primal_solution_status") === 2);
      if (!hasPoint) return { status: "no_solution" } as const;
      return {
        status: "solved",
        x: Array.from(model.getSolution().colValue),
        objective: model.getObjectiveValue(),
      } as const;
    });
  } catch (error) {
    throw new SolverError("engine_error", "HiGHS failed on a plate model", { cause: error });
  }
}
