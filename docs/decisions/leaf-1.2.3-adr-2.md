# leaf-1.2.3 ADR-2: MILP objective cutoff in the portion solver (R-38)

Status: proposed (CP3 finding 1 follow-up, R-38)

## Context

CP3 finding 1: the PLN-11 day budget failed on the architect's container. Almost all of a day's time is spent in HiGHS: on F1 Monday, 3,975 of 4,081 ms at `869f6a3`. Profiled inside `solvePlate` (1.2.2) on that day:

| work                          | count | total    | each    |
| ----------------------------- | ----- | -------- | ------- |
| strict-stage LP relaxations   | 498   | 439 ms   | 0.9 ms  |
| strict-stage MILPs            | 270   | 2,843 ms | 10.5 ms |
| adjuster-stage LP relaxations | 12    | 14 ms    | 1.2 ms  |
| adjuster-stage MILPs          | 12    | 823 ms   | 68.6 ms |

`runStage` solves combinations in order of their LP bound. It solves a MILP for every combination whose bound does not exceed the best objective found so far. Most of those MILPs cannot beat the best plate, but HiGHS still searched each one to optimality. R-38 put `planner/solver/**` in this leaf's OWNS for performance changes that change no result.

## Decision

- `solveMilp(milp, timeLimit, cutoff?)` passes `cutoff` to HiGHS as `objective_bound`, so HiGHS prunes every branch-and-bound node whose bound exceeds it.
- Once `runStage` has a best candidate, every further MILP gets this cutoff:

  `best.objective + λ_appeal · (the combination's best variant appeal, at least 0) + 1e-4`

  - A combination can win only if its TypeScript objective, which is the MILP objective minus λ_appeal times the combination's mean served appeal, is within 1e-9 of the best.
  - The mean served appeal is at most that bound. So a winning combination's MILP optimum is at most `best.objective + λ_appeal·bound + 1e-9`, which is below the cutoff.
  - The 1e-4 slack also covers the float noise between HiGHS's objective and the TypeScript re-evaluation.

- The cutoff only affects combinations above it:
  - A combination whose optimum is at or below the cutoff is solved to the same proven optimum.
  - One above it ends early. It returns no solution, or a feasible point whose objective is above its own optimum, so above the cutoff. `evaluate` then rejects that point exactly as it would have rejected the true optimum.
- Model, options, stage order and tie rule are unchanged.

## Time limit

The argument above holds when every MILP is solved to proven optimality. PLN-5 gives each combination 0.25 s (`TIME_LIMIT_PER_COMBINATION_S`). A model that runs out of time returns HiGHS's incumbent, which depends on machine speed with or without a cutoff. The cutoff prunes nodes, so such a model can reach its proven optimum in time where it did not before, and the plate can then differ.

- Measured (CP3 round 2) on 300 seed-dish plates with random non-zero appeal, run with and without the cutoff under the 0.25 s limit, on the builder's container:
  - 6 plates had a MILP time out without the cutoff; 2 did with it.
  - 2 plates differed (`chicken-machboos`, `sheri-daqoos-rice`). Both are adjuster-stage plates where the run without the cutoff timed out on the winning combination. The cutoff returned the better plate: objective 9.294 against 9.449, and 9.303 against 9.442.
  - 0 differences among plates where no MILP timed out. No plate was worse with the cutoff.
- On F1 (zero appeal) no plate differs: see the 1,040-plate equivalence and the unchanged plan hashes below.

## Evidence

- `test/planner/solver/cutoff.test.ts` builds plate models from 1.2.2's feasible cases and adjuster cases:
  - with a cutoff at or above the optimum, the integer columns are identical;
  - with a cutoff below the optimum, HiGHS returns no solution (28 of 31 models) or a point no better than the optimum (3 of 31).
- `test/planner/solver/cutoff-appeal.test.ts` (in G4) runs `solvePlate` with and without the cutoff, with the per-MILP time limit lifted in both runs so the comparison does not depend on machine speed:
  - a constructed dish whose winning combination has the higher MILP optimum and wins only through λ_appeal · appeal;
  - 200 seed-dish plates (seed 38), with random appeal in [−1, 1] for every variant and adjuster, strict and flexible, and the adjuster stage reached on some plates.

  Setting `cutoff = best.objective` (dropping the appeal term) fails both tests; `cutoff.test.ts` still passes under it, and the architect found that every gate does too. That is the CP3 round 2 mutation M4.

- **Exhaustive equivalence:** every distinct F1 target of the week against every suitable seed dish with the seed adjusters, strict and flexible. That is 1,040 `solvePlate` calls, compared as whole `PlateSolution` JSON against the unchanged solver. 0 differences.
- **F1 week plan hashes** (G4's `stablePlanHash`) are unchanged against `869f6a3`:
  - seed 1: `514085e89d548355a6a43bcb6802db2135f87bad8d95129b90718ffbb5841c25`
  - seed 2: `c43980f9b7368d5605712e2ff6254929a6269739669cffc3460bdc192d72f033`
- 1.2.2 G1–G4 and 1.2.4 G4 and G6 pass.
- **Effect, F1 Monday in fresh processes on the builder's container:** main-thread CPU was 4.17, 4.11 and 4.10 s before, and 2.83, 2.93 and 2.74 s after. The same 215 solves.

## Alternatives

- Reusing one HiGHS model across combinations (changing coefficients, warm-starting): rejected. A warm start can return a different optimum among ties, which would change plates. It is out of scope under R-38.
- Enumerating adjuster subsets instead of the binary adjuster model: 150 or more small MILPs per combination, which is slower.
- Skipping the LP relaxation for single-combination dishes: only about 1 ms each. Not worth the change.
