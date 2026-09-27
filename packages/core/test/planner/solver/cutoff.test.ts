// R-38 (leaf-1.2.3 ADR-2): the MILP objective cutoff is exact. A cutoff at or above a model's
// optimum returns the same integer solution; below it, no solution or a point no better than the
// optimum.
import { beforeAll, describe, expect, it } from "vitest";
import { loadPortionSolver } from "../../../src/planner/solver/index.js";
import { solveMilp, type WorkLimit } from "../../../src/planner/solver/highs.js";
import {
  buildPlateModel,
  gridOf,
  type AdjusterTerm,
  type MainTerm,
} from "../../../src/planner/solver/milp.js";
import type { SolverCase } from "./fixtures/cases.js";
import { adjusterCases, feasibleCases } from "./fixtures/cases.js";

/** HiGHS's largest node and iteration limits: every model is solved to proven optimality. */
const UNLIMITED: WorkLimit = { mipNodes: 2_147_483_647, lpIterations: 2_147_483_647 };

beforeAll(async () => {
  await loadPortionSolver();
});

/** The strict plate model of a case's default variants, with its adjusters offered. */
function modelOf(c: SolverCase, withAdjusters: boolean) {
  const gRef = c.dish.components.reduce((s, x) => s + x.defaultServingG, 0);
  const main: MainTerm[] = c.dish.components.map((comp) => ({
    grid: gridOf(comp),
    per100g: (comp.variants.find((v) => v.isDefault) ?? comp.variants[0])?.per100g ?? null,
    rho: comp.defaultServingG / gRef,
  }));
  const adjusters: AdjusterTerm[] = [];
  if (withAdjusters)
    c.adjusters.forEach((a, i) => {
      const comp = a.components[0];
      const variant = comp?.variants[0];
      if (comp !== undefined && variant !== undefined)
        adjusters.push({ grid: gridOf(comp), per100g: variant.per100g, dishIndex: i });
    });
  return buildPlateModel({
    main,
    adjusters,
    target: {
      kcal: c.target.kcal,
      protein: c.target.protein,
      carbs: c.target.carbs,
      fat: c.target.fat,
    },
    tol: c.target.tol,
    basis: c.target.carbBasis,
    satFatMax: c.target.satFatMax,
    fibreGoal: c.target.fibreGoal,
    solubleFibreGoal: c.target.solubleFibreGoal,
    gRef,
    hard: true,
  }).milp;
}

describe("solveMilp cutoff", () => {
  it("keeps the solution at or above the optimum and cuts below it", () => {
    const cases = [
      ...feasibleCases(40, "total", 7).map((c) => ({ c, adj: false })),
      ...adjusterCases(10, "total", 11).map((c) => ({ c, adj: true })),
    ];
    let solved = 0;
    let cut = 0;
    let notCut = 0;
    for (const { c, adj } of cases) {
      const milp = modelOf(c, adj);
      const plain = solveMilp(milp, UNLIMITED);
      if (plain.status !== "solved") continue;
      solved++;
      // solvePlate reads only the rounded integer columns and recomputes the rest in TypeScript;
      // continuous deviation columns may differ in the last bits of float noise.
      const ints = (x: readonly number[]) =>
        x.flatMap((v, i) => (milp.integrality[i] === 0 ? [] : [Math.round(v) + 0]));
      for (const cutoff of [plain.objective + 1e-4, plain.objective + 10]) {
        const cut = solveMilp(milp, UNLIMITED, cutoff);
        expect(cut.status).toBe("solved");
        if (cut.status !== "solved") continue;
        expect(ints(cut.x)).toEqual(ints(plain.x));
        expect(cut.objective).toBeCloseTo(plain.objective, 9);
      }
      // Below the optimum, HiGHS stops early: no solution, or a feasible point that is never
      // better than the optimum (so it can never win the comparison in runStage).
      if (plain.objective > 0.05) {
        const below = solveMilp(milp, UNLIMITED, plain.objective - 0.05);
        if (below.status === "solved") {
          expect(below.objective).toBeGreaterThanOrEqual(plain.objective - 1e-9);
          notCut++;
        } else cut++;
      }
    }
    expect(solved).toBeGreaterThan(20);
    expect(cut).toBeGreaterThan(notCut);
  }, 120_000);
});
