# leaf-1.2.3 ADR-1: plan search design (PLN-9, PLN-11, R-28)

Status: proposed (CP1)

## Context

PLN-11 asks for a beam search over the slots of a day (pre-score, top K = 12, solve, beam B = 6), a week built day by day with an improvement pass, deterministic output for a fixed seed, and budgets of 5 s per day and 30 s per week on F1. R-28 moves the kcal tolerance to the member-day: the resolver splits the daily ±`tolerance.kcal` band across attended slots, and the plan search re-targets later slots with the kcal already consumed, then asserts every member-day total.

The measured cost of one targeted strict solve on the seed library is about 25–30 ms on average (1.2.4 G6: 520 targeted plates in about 15 s, including adjuster retries). A beam whose states each needed their own solves (B × K per targeted member-slot) would cost roughly 700 solves per F1 day, about 20 s, well over the 5 s budget.

No new library is used. The search uses only the 1.2.1 engine, the 1.2.2 resolver and solver, and the 1.3.2 preference model (`evaluateAppeal`, `coreIngredients`).

## Decision

1. **State-independent candidate solves, cached.** During the beam and the improvement pass, a candidate's plates are solved against the resolver's slot targets (`resolveSlotTargets`, with its per-slot kcal band). This does not depend on the beam state, so each result is cached per plan run under the key (dish, member, slot, target values, tolerance, mode, the adjusters offered). Days of the same day kind reuse the same targets, so most of a week's solves come from the cache. The cache is a pure memo, so it does not change results.
2. **Kcal re-targeting pass (R-28).** After a day's dishes are fixed (after the beam, and again for every day the improvement pass changes), each targeted member's plates are re-solved in time order. For the member's i-th attended slot, with `D` = the kcal deviation of the plates before it and `Bᵢ` = the sum of the resolver's kcal bands for slots 1…i:
   - kcal target = the resolver's kcal target − `D`;
   - kcal tolerance = `Bᵢ`. P/C/F targets and tolerances are unchanged (per meal).

   An in-tolerance plate at slot i therefore keeps the running deviation within ±`Bᵢ`, so a member-day whose plates are all in tolerance ends within ±`Bₙ` = ±`tolerance.kcal`. The window always contains the resolver's own window, so a plate that was in tolerance in the beam stays feasible. If the re-solve returns a worse status than the beam plate and the beam plate fits the re-targeted window, the beam plate is kept. The plan asserts the member-day total and reports it per member-day (`memberDays`).

3. **Beam.** Slots are processed in time order. Shared meals come first, then individual meals (per-member slots, R2-MEAL individual slots, split members) per member in time order (PLN-11). A state is a partial day. For each meal, a state expands with each of the meal's K solved candidates, which are scored (PLN-9) in that state's context: economy from ingredients already in the window and in the state, variety from the state's previous meals. The top B states by summed score are kept.
4. **Pre-score context.** The top-K pre-score (appeal + economy, no solve) of a meal uses the day's entry context: the plan so far, without this day's beam states. It is one list per meal, not one per state, which keeps solves at K per targeted attendee. If none of the top K is eligible in strict mode (every targeted attendee `in_tolerance`, adjusters allowed), the next K by pre-score are solved, until the filtered pool is used up. Then the least-bad dish is used: smallest Σ over targeted attendees of Σ|dev|/tol. Its plates keep status `infeasible` and carry the solver's reason and smallest deviation (PLN-8, SC-1).
5. **Week.** Days are planned in date order, each with the plan so far as context. Then up to 2 improvement passes run: for each unlocked meal, the top 5 alternatives (by pre-score, then solved and scored) are tried, and a swap is kept if the week's total score improves strictly. The total score is recomputed over every meal, because a swap changes other meals' economy and variety. The re-targeting pass then runs for each changed day.
6. **Seed.** A mulberry32 stream seeded by `opts.seed` adds a jitter in [0, 0.01) to each pre-score, and it breaks exact ties in the beam and in the improvement pass. The same seed gives an identical plan. Different seeds explore different near-ties, which G3's 50 plans rely on. The jitter is below every weighted score difference that the spec's components express with a coefficient of 0.05 or more.
7. **Input shape.** `planDays` takes `PlanDish` records: a `DishForSolve` plus the fields that scoring and the cook sheet need (name, cuisine key, slot keys, status, per-variant method key, label, core ingredient ids, `VariantInput`, needs-review flag, component name and unit label). `DishForSolve` alone has no cuisine or slot keys (SPEC-Q-1).

## Alternatives

- Solving per beam state with the re-targeted kcal (exact R-28 inside the beam): about 20 s per day on F1. Rejected on the PLN-11 budget.
- Re-targeting in planning order (shared meals first) instead of time order: this ties the kcal correction to an implementation order that the admin never sees. Rejected; time order matches "later slots".
- No re-targeting: the resolver's split bands already bound the day to ±50 when every plate is in tolerance. Rejected, because R-28 requires re-targeting, and the wider cumulative window recovers plates the narrow per-slot band makes infeasible.

## Consequences

- The beam scores a candidate's MacroFit on its resolver-target plate. After re-targeting, the stored plates, fits and score breakdowns are recomputed from the final plates.
- Solve counts, cache hits, infeasible counts and timings are returned in `PlanResult.stats` (the 10 §9 planner metrics).
