# leaf-1.2.2 ADR-1: HiGHS API for the portion solver

Status: proposed (CP1)

## Context
PLN-5 names HiGHS through the `highs` npm package (declared by 1.1.1 in `packages/core`, version 1.15.3, HiGHS 1.15). The package offers:
1. `highs.solve(lpText, options)`: one-shot, CPLEX LP text in, result keyed by variable name.
2. `highs.createModel(modelData)` / `highs.withModel(modelData, fn)`: persistent model built from sparse arrays (CSC/CSR), with options, `run()`, `getModelStatus()`, `getSolution()`.
3. `highs.raw`: C-API style calls with numeric statuses.

The runtime loads asynchronously (`await loadHighs()`); every solve after that is synchronous.

## Decision
- Load once through `loadPortionSolver()` (module-level promise, idempotent). `solvePlate` stays synchronous as in 04 §11.
- Build each variant-combination MILP as `ModelData` with a CSR matrix and pass it to `highs.withModel(data, model => …)`, which disposes the native model when the callback returns. No LP text: coefficients go in as doubles, so there is no text formatting or rounding of coefficients, and no variable-name escaping.
- Options per solve: `output_flag: false`, `time_limit: 0.25` (PLN-5: 250 ms per combination), `mip_rel_gap: 0`, `mip_feasibility_tolerance: 1e-9`.
- Read `getModelStatus()` against `highs.constants.modelStatus` (`optimal`; `infeasible`; `timeLimit` with a solution counts as a solution, otherwise as no solution).
- Every returned plate is re-checked in TypeScript: grams are recomputed as integer multiples of the step, nutrients are recomputed with `plateNutrients` (1.2.1), and the tolerance status is decided from those figures, not from the MILP's.

## Alternatives
- LP text through `highs.solve`: simplest, but coefficients pass through decimal text and the result is keyed by names. Rejected for numerics and robustness.
- `javascript-lp-solver` fallback (PLN-5 allows it only if HiGHS cannot run): not needed in Node 22 or the browser; not added.

## Consequences
- Callers (1.2.3 `planDays`, 1.3.1 feasibility check) must `await loadPortionSolver()` before solving.
- A prototype MILP of this size (3 integer components, 8 deviation variables) solved in about 1 ms at p95 on the build container, so the 150 ms per-plate budget (G5) leaves room for 24 combinations plus the adjuster retry.
