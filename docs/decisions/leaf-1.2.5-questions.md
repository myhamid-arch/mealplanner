# leaf-1.2.5 spec questions

Each question states the reading this leaf takes. Unless marked otherwise, it is the more conservative reading, and the build continues on it until the architect rules.

## SPEC-Q-1: "plan objective" (G3)

PlanResult has no single objective field. Reading: the plan objective is Σ over every planned meal of its PLN-9 score (`scoreBreakdown.total`), the quantity the beam search and the improvement pass maximise (1.2.3 `improve.ts` `weekTotal`). Higher is better.

## SPEC-Q-2: "median plan objective within 0.5 % of the baseline" (G3)

Reading (literal, two-sided): with `Mₙ` = median over seeds 1–10 of the work-limited objectives and `M_b` = the same median for the 0.25 s wall-clock baseline, `|Mₙ − M_b| ≤ 0.005 · |M_b|`. A plan that is better by more than 0.5 % also fails; that would mean the calibration changed the search, which is not what R-51 asks for. G3 also prints each seed's objective pair, the ratio, and whether the two plans are identical (plan hash).

## SPEC-Q-3: "SC-1 in-tolerance rate not lower" (G3)

Reading: pooled over seeds 1–10, the number of targeted member-meals (plates of targeted members) that are `in_tolerance`, divided by all targeted member-meals, as 1.2.3 G1 counts SC-1. The work-limited rate must be ≥ the baseline rate, exactly (no tolerance).

## SPEC-Q-4: the 0.25 s wall-clock baseline (G3)

The baseline must be measured by the verify script, not stored. Reading: the verify script compiles `@mealplanner/core` a second time into its own directory with `src/planner/solver/**` taken from commit `44ab091` (the integration branch at dispatch, the last solver with `TIME_LIMIT_PER_COMBINATION_S = 0.25`, via `git show`), and every other file from the working tree. So the baseline differs from the leaf only in the solver. The plans are then run with that build, one process at a time, and nothing else from the script running (idle). A clone without that commit fails G3 with a message naming it.

## SPEC-Q-5: "idle" and running gates concurrently (G2, G3 vs G1)

G1 saturates every CPU on purpose. G2's week wall time and G3's baseline must be measured idle. Reading: G2 and G3 check idleness from their own measurements (the ratio of wall time to main-thread CPU time of each timed plan must stay ≤ 1.15; about 1.0 when idle, ≈ 1.3 or more when a busy process shares the CPU) and fail with "machine not idle" rather than report a figure measured under load. Consequence: G2 and G3 pass only when they do not overlap G1 (or other heavy work). All gates remain *safe* to run concurrently: separate build directories under `packages/core/node_modules/.cache/leaf-1.2.5-<gate>-<pid>`, no ports, no shared temp files, and G1's load processes end with G1. Raised as an ARCHITECT QUESTION at CP1.

## SPEC-Q-6: G1 runs

Reading: an "idle run" is one fresh process that plans the F1 week for seeds 1, 2 and 3 in turn; the three idle runs go one at a time with no added load. The three "loaded runs" are three such processes running at the same time while `availableParallelism()` busy processes spin (one per CPU), so the planner processes compete with the busy processes and each other. G1 asserts the load was real: the busy processes' own CPU time covers at least half of every CPU for the loaded period, and the loaded plans' wall/CPU ratio is higher than the idle runs'. All 18 plans (6 runs × 3 seeds) must have the same full-plan hash per seed (1.2.3 G4's `stablePlanHash`: the whole `PlanResult` JSON except the run counters). Negative control: the comparison is re-run with one plan whose one meal's dish is replaced by another dish, and must report the difference.

## SPEC-Q-7: budgets (G2)

Reading, as 1.2.3 G4 (SPEC-Q-16 there): CPU is main-thread CPU (`process.threadCpuUsage`) of a fresh process; a day is one F1 date planned alone, seed 1, one process at a time; the week is the F1 week, seed 1. The 7 days are measured 3 times (21 runs) and the worst is compared with 4.0 s (R-38 asked for 5 consecutive passing runs on the builder's container; 3 keep G2 within its time). The week is measured once for wall time (≤ 30 s). Negative control: the day-budget assertion applied through the same harness to a known over-budget workload (the whole week measured as if it were a day, ≈ 10 s CPU) must fail.

## SPEC-Q-8: gate run times

Measured on the base (1.2.2 and 1.2.3 gates) and estimated for the rest on the builder's container: G1 ≈ 3 min, G2 ≈ 1.5 min, G3 ≈ 5 min, G4 ≈ 10 min. All exceed gate-check's default 120 s. Request: run the ledger with `--timeout 1200` (the CP2 PR states the measured times).
