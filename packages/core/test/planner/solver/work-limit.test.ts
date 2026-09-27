// R-51 (W-4, leaf-1.2.5 ADR-1): every HiGHS solve is bounded by a deterministic work limit (nodes
// for a MILP, simplex iterations for an LP relaxation), never by wall-clock time. These tests use
// real plate models from 1.2.2's fixture cases and check, on the installed highs build, that the
// limits are honoured and reported, that a limited solve never returns a point better than the
// optimum, that results repeat exactly, and that solvePlate passes the configured limits and no
// time limit.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadPortionSolver, solvePlate, solverConfig } from "../../../src/planner/solver/index.js";
import { solveMilp, type WorkLimit } from "../../../src/planner/solver/highs.js";
import {
  buildPlateModel,
  gridOf,
  type AdjusterTerm,
  type MainTerm,
} from "../../../src/planner/solver/milp.js";
import type { SolverCase } from "./fixtures/cases.js";
import { adjusterCases, feasibleCases } from "./fixtures/cases.js";

/** Every `model.options.set` call HiGHS receives, recorded through the package's own loader. */
const recorded = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock("highs", async (importOriginal) => {
  /** A method read through a proxy, bound to its real owner (the WASM objects need `this`). */
  const bound = (value: unknown, self: object): unknown =>
    typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(self) : value;
  const actual = await importOriginal<{ default: (o?: unknown) => Promise<object> }>();
  const load = async (o?: unknown) => {
    const highs = (await actual.default(o)) as {
      withModel: (data: unknown, fn: (model: object) => unknown) => unknown;
    };
    return new Proxy(highs, {
      get(target, key, receiver) {
        if (key !== "withModel") return Reflect.get(target, key, receiver) as unknown;
        return (data: unknown, fn: (model: object) => unknown) =>
          target.withModel(data, (model) =>
            fn(
              new Proxy(model, {
                get(m, k, r) {
                  const value = Reflect.get(m, k, r) as unknown;
                  if (k !== "options") return bound(value, m);
                  const options = value as { set: (o: Record<string, unknown>) => unknown };
                  return new Proxy(options, {
                    get(o, ok, or) {
                      if (ok !== "set") return bound(Reflect.get(o, ok, or), o);
                      return (set: Record<string, unknown>) => {
                        recorded.options.push({ ...set });
                        return options.set(set);
                      };
                    },
                  });
                },
              }),
            ),
          );
      },
    });
  };
  return { ...actual, default: load };
});

/** HiGHS's largest node and iteration limits: every plate model is solved to proven optimality. */
const UNLIMITED: WorkLimit = { mipNodes: 2_147_483_647, lpIterations: 2_147_483_647 };
const CONFIGURED: WorkLimit = {
  mipNodes: solverConfig.MIP_NODE_LIMIT_PER_COMBINATION,
  lpIterations: solverConfig.LP_ITERATION_LIMIT_PER_COMBINATION,
};

beforeAll(async () => {
  await loadPortionSolver();
});

/** The strict plate model of a case's default variants (as `cutoff.test.ts`), optionally relaxed. */
function modelOf(c: SolverCase, withAdjusters: boolean, relaxed = false) {
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
    relaxed,
  }).milp;
}

const models = () => [
  ...feasibleCases(40, "total", 7).map((c) => modelOf(c, false)),
  ...adjusterCases(10, "total", 11).map((c) => modelOf(c, true)),
];

describe("solveMilp work limit (R-51)", () => {
  it("stops a MILP at the node limit, reports it, and never returns a point better than the optimum", () => {
    let limitedSolved = 0;
    let limitedEmpty = 0;
    for (const milp of models()) {
      const full = solveMilp(milp, UNLIMITED);
      expect(full.limited).toBe(false);
      const cut = solveMilp(milp, { ...UNLIMITED, mipNodes: 1 });
      if (!cut.limited) {
        // Solved within one node: the same result as without a limit.
        expect(cut.status).toBe(full.status);
        continue;
      }
      if (cut.status === "solved") {
        limitedSolved++;
        expect(full.status).toBe("solved");
        if (full.status === "solved")
          expect(cut.objective).toBeGreaterThanOrEqual(full.objective - 1e-9);
      } else limitedEmpty++;
    }
    // The limit binds on real plate models (both outcomes occur), so the option is honoured.
    expect(limitedSolved + limitedEmpty).toBeGreaterThan(0);
  }, 120_000);

  it("stops an LP relaxation at the iteration limit and returns no bound from it", () => {
    let limitedCount = 0;
    let solvedCount = 0;
    for (const c of feasibleCases(40, "total", 7)) {
      const lp = modelOf(c, false, true);
      expect(lp.integrality.every((t) => t === 0)).toBe(true);
      const full = solveMilp(lp, UNLIMITED);
      expect(full.limited).toBe(false);
      // The default-variant combination's relaxation can be infeasible; only solved ones count.
      if (full.status !== "solved") continue;
      solvedCount++;
      const cut = solveMilp(lp, { ...UNLIMITED, lpIterations: 1 });
      if (cut.limited) {
        limitedCount++;
        expect(cut.status).toBe("no_solution");
      } else expect(cut.status).toBe("solved");
    }
    expect(solvedCount).toBeGreaterThan(10);
    expect(limitedCount).toBeGreaterThan(0);
  });

  it("gives identical results on repeated solves under the configured limit", () => {
    for (const milp of models()) {
      const a = solveMilp(milp, CONFIGURED);
      const b = solveMilp(milp, CONFIGURED);
      expect(b).toEqual(a);
    }
  }, 120_000);

  it("reaches the proven optimum on the fixture models: the configured limit does not bind there", () => {
    for (const milp of models()) {
      const configured = solveMilp(milp, CONFIGURED);
      expect(configured.limited).toBe(false);
      expect(configured).toEqual(solveMilp(milp, UNLIMITED));
    }
  }, 120_000);

  it("solvePlate passes the configured node and iteration limits and never a time limit", () => {
    recorded.options.length = 0;
    const c = adjusterCases(1, "total", 11)[0];
    if (c === undefined) throw new Error("no adjuster case");
    solvePlate(c);
    expect(recorded.options.length).toBeGreaterThan(0);
    let mip = 0;
    let lp = 0;
    for (const set of recorded.options) {
      expect(set).not.toHaveProperty("time_limit");
      if ("mip_max_nodes" in set) {
        mip++;
        expect(set.mip_max_nodes).toBe(solverConfig.MIP_NODE_LIMIT_PER_COMBINATION);
        expect(set).not.toHaveProperty("simplex_iteration_limit");
      } else {
        lp++;
        expect(set.simplex_iteration_limit).toBe(solverConfig.LP_ITERATION_LIMIT_PER_COMBINATION);
      }
    }
    expect(mip).toBeGreaterThan(0);
    expect(lp).toBeGreaterThan(0);
    expect(solverConfig).not.toHaveProperty("TIME_LIMIT_PER_COMBINATION_S");
  });
});
