// A targeted solve before loadPortionSolver() fails with a typed error (SPEC-Q-1). Vitest gives
// each test file its own module graph, so the solver runtime is not loaded here.
import { describe, expect, it } from "vitest";
import { SolverError, loadPortionSolver, solvePlate } from "../../../src/planner/solver/index.js";
import { testDishes } from "./fixtures/build.js";
import { memberCtx, slotTarget } from "./fixtures/cases.js";

describe("loadPortionSolver", () => {
  it("is required before a targeted solve, and idempotent", async () => {
    const dish = testDishes().dishes[0];
    if (dish === undefined) throw new Error("no dish");
    const input = {
      dish,
      target: slotTarget({ kcal: 600, protein: 50, carbs: 60, fat: 15 }, "total"),
      member: memberCtx(),
      adjusters: [],
    };
    try {
      solvePlate(input);
      throw new Error("expected not_loaded");
    } catch (e) {
      expect(e).toBeInstanceOf(SolverError);
      expect((e as SolverError).code).toBe("not_loaded");
    }
    // Untargeted plates need no MILP.
    expect(solvePlate({ ...input, target: null }).status).toBe("untargeted");
    await Promise.all([loadPortionSolver(), loadPortionSolver()]);
    expect(solvePlate(input).status).toBe("in_tolerance");
  });
});
