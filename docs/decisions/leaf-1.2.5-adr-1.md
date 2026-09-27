# leaf-1.2.5 ADR-1: deterministic HiGHS work limit instead of the wall-clock limit (W-4, R-51)

Status: proposed (CP1)

## Context

PLN-5 gives every combination's HiGHS solve a wall-clock `time_limit` of 0.25 s (`TIME_LIMIT_PER_COMBINATION_S`, passed by `solve.ts` to `solveMilp` in `highs.ts`, for both the LP relaxation and the MILP). A solve that runs out of time returns HiGHS's incumbent, or no solution. Under CPU load more solves run out of time, so the chosen plate, and with it the plan, can depend on machine load. That breaks PLN-11 ("deterministic for a fixed seed"); W-4 is the observed case (1.2.3 G5's cook-sheet snapshot, `bread.fresh` vs `bread.toasted`, only while gates ran in parallel).

## What the installed `highs` build honours

Checked in the installed package, `highs@1.15.3` (`node_modules/.pnpm/highs@1.15.3/node_modules/highs/types.d.ts` and the option names compiled into `build/highs.wasm`), not from memory:

| option                    | meaning (types.d.ts)                                          | default    |
| ------------------------- | ------------------------------------------------------------- | ---------- |
| `mip_max_nodes`           | maximum number of processed branch-and-bound nodes            | 2147483647 |
| `mip_max_leaves`          | maximum number of MIP leaf nodes processed                    | 2147483647 |
| `simplex_iteration_limit` | simplex iteration limit when solving LPs, not MIP subproblems | 2147483647 |
| `time_limit`              | wall-clock limit                                              | Infinity   |

Probe run in this session on a 30-column integer model: `mip_max_nodes: 0` stops with model status 16 (`solutionLimit`) and `primal_solution_status` 0; without limits the same model is `optimal` (7). A node-limited run therefore reports `solutionLimit`, not `timeLimit`; the unit tests pin the status and the "feasible point" handling on real plate models (below).

## Decision

1. `solveMilp(milp, limit, cutoff?)` takes a work limit instead of seconds and never sets `time_limit`:
   - MILP (any integer or semi-integer column): `mip_max_nodes = MIP_NODE_LIMIT_PER_COMBINATION`.
   - LP relaxation (all columns continuous): `simplex_iteration_limit = LP_ITERATION_LIMIT_PER_COMBINATION`.
   - A limited run counts only if HiGHS has a feasible point (`primal_solution_status = 2`), exactly as the time-limited run did. The statuses accepted as "limited" become `solutionLimit` (node limit) and `iterationLimit` (LP iterations) instead of `timeLimit` / `interrupted`.
2. **No wall-clock guard.** R-51 allows one only as a failure cutoff. Node and iteration limits already bound the work of every solve, and a guard that fails a plan under load would make the _outcome_ (plan or error) load-dependent again. So none is kept.
3. The R-39 objective cutoff (`objective_bound`, leaf-1.2.3 ADR-2) is unchanged.
4. HiGHS itself: the plate options already switch off everything with its own budget (heuristics, restarts, symmetry, cuts at nodes); the WASM build runs single-threaded. The node count HiGHS processes is then a function of the model and options only. G1 checks this end to end under full CPU load.

## Calibration (same idle budget as today)

"Same budget" = the work one combination can do in 0.25 s on an idle machine.

- Measured in this session on the builder's container (4 CPUs), before any change: F1 week, seeds 1–10, AI off, one process at a time, every HiGHS call instrumented. 7,040 MILPs and 16,402 LP relaxations. **No solve reached the 0.25 s limit.** The largest MILP took 246 nodes; the slowest took 176 ms, the largest LP 51 iterations.
- Per-node cost over the 731 MILPs with ≥ 20 nodes: median 0.66 ms/node (p10 0.48, p90 1.11). 0.25 s at the median cost is ≈ **377 nodes**.
- Proposed constants (final values recomputed at build time by the same procedure and recorded here with the measurement):
  - `MIP_NODE_LIMIT_PER_COMBINATION` = ⌊0.25 s ÷ median idle ms-per-node⌋ (≈ 377).
  - `LP_ITERATION_LIMIT_PER_COMBINATION` = ⌊0.25 s ÷ median idle ms-per-iteration⌋ over the LP relaxations, measured the same way.
- Consequence: at idle, on F1, no limit binds, so the plans are the proven-optimum plans the 0.25 s solver also produces at idle; G3 measures that against the wall-clock baseline. Under load the work limit keeps giving the same plan, where the wall-clock limit cut solves short.
- G3 re-measures the per-node cost on the machine it runs on and prints what 0.25 s is worth there, next to the constant, so the architect can see the calibration on the CP3 container. The constant itself is fixed: a machine-dependent limit would bring the W-4 problem back.

## Alternatives rejected

- `mip_max_leaves`: counts only leaves; the processed-node count is the closer measure of work (each node is an LP solve). Not used.
- Keeping `time_limit` as a large failure guard (see decision 2).
- A work limit on total LP iterations inside the MILP: HiGHS 1.15.3 has no option for it (`simplex_iteration_limit` excludes MIP subproblems).
