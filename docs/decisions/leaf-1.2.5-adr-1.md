# leaf-1.2.5 ADR-1: deterministic HiGHS work limit instead of the wall-clock limit (W-4, R-51)

Status: accepted (CP1 APPROVED, R-54); constants final at build

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
   - A limited MILP counts only if HiGHS has a feasible point (`primal_solution_status = 2`), exactly as the time-limited run did. The status that marks it limited is `solutionLimit` (node limit) instead of `timeLimit` / `interrupted`.
   - `MilpResult` reports `limited`. A limited **LP relaxation** is never `solved`: its point is not the relaxation's optimum, so its objective is not a lower bound, and using it could prune a combination that would have won. `runStage` keeps a combination whose relaxation was cut short with bound −∞ (solved, never pruned). The time-limited code accepted such a point as a bound. At idle on F1 no relaxation comes near the limit (at most 51 of 10,748 iterations), so this changes no plan; it only closes the case.
2. **No wall-clock guard.** R-51 allows one only as a failure cutoff. Node and iteration limits already bound the work of every solve, and a guard that fails a plan under load would make the _outcome_ (plan or error) load-dependent again. So none is kept.
3. The R-39 objective cutoff (`objective_bound`, leaf-1.2.3 ADR-2) is unchanged.
4. HiGHS itself: the plate options already switch off everything with its own budget (heuristics, restarts, symmetry, cuts at nodes); the WASM build runs single-threaded. The node count HiGHS processes is then a function of the model and options only. G1 checks this end to end under full CPU load.

## Calibration (same idle budget as today)

"Same budget" = the work one combination can do in 0.25 s on an idle machine.

- Measured in this session on the builder's container (4 CPUs), before any change: F1 week, seeds 1–10, AI off, one process at a time, every HiGHS call instrumented. 7,040 MILPs and 16,402 LP relaxations. **No solve reached the 0.25 s limit.** The largest MILP took 246 nodes; the slowest took 176 ms, the largest LP 51 iterations.
- Per-node cost over the 731 MILPs with ≥ 20 nodes: median 0.66 ms/node (p10 0.48, p90 1.11). 0.25 s at the median cost is ≈ **377 nodes**.
- Rule: `MIP_NODE_LIMIT_PER_COMBINATION` = ⌊0.25 s ÷ median idle ms-per-node⌋ over the MILPs with ≥ 20 nodes; `LP_ITERATION_LIMIT_PER_COMBINATION` = ⌊0.25 s ÷ median idle ms-per-iteration⌋ over the LP relaxations with ≥ 20 iterations.
- **Build measurement (the constants):** the same procedure, repeated at build time on the base solver: same 7,040 MILPs and 16,402 LPs, 0 limited, most nodes 246, most iterations 51, slowest MILP 116 ms. Median 0.437 ms/node over 731 MILPs → **572 nodes**; median 0.0233 ms/iteration over 477 LPs → **10,748 iterations**.
- The two measurements differ by a third (0.66 against 0.437 ms/node) on the same container. The host's speed varies between runs (the worst F1 day was 3.74 s CPU in the base 1.2.3 G4 run of this session and 2.64 s in this leaf's G2 a few hours later), which is exactly why the limit must not be a time. Either figure is well above the 246 nodes any F1 solve needs, so the choice between them changes no F1 plan; the later, cleaner one is used.
- Consequence: at idle, on F1, no limit binds, so the plans are the proven-optimum plans the 0.25 s solver also produces at idle; G3 measures that against the wall-clock baseline. Under load the work limit keeps giving the same plan, where the wall-clock limit cut solves short.
- G3 re-measures the per-node and per-iteration cost on the machine it runs on (an instrumented build, seeds 1–3) and prints what 0.25 s is worth there, next to the constants, so the architect can see the calibration on the CP3 container. The constants themselves are fixed: a machine-dependent limit would bring the W-4 problem back. First G3 run at build: 0.432 ms/node → 578 nodes, 0.0224 ms/iteration → 11,169 iterations.

## Evidence

- `work-limit.test.ts` (G1): on 1.2.2's fixture plate models, a node limit of 1 binds and is reported (`limited`), never returning a point better than the optimum; an iteration limit of 1 binds on LP relaxations and returns no bound; repeated solves are identical; under the configured limits the fixture models reach the proven optimum; `solvePlate` passes `mip_max_nodes` / `simplex_iteration_limit` with the configured values and never `time_limit`.
- G1: F1 week plans for seeds 1–3 identical across 3 idle runs and 3 runs under full CPU load. The seed 1 and 2 hashes equal those leaf-1.2.3 ADR-2 recorded at `869f6a3`.
- G3: seeds 1–10 identical to the 0.25 s wall-clock baseline measured idle.

## Alternatives rejected

- `mip_max_leaves`: counts only leaves; the processed-node count is the closer measure of work (each node is an LP solve). Not used.
- Keeping `time_limit` as a large failure guard (see decision 2).
- A work limit on total LP iterations inside the MILP: HiGHS 1.15.3 has no option for it (`simplex_iteration_limit` excludes MIP subproblems).
