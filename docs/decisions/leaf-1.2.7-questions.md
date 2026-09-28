# Leaf 1.2.7 spec questions

Each question records the reading this leaf builds on (BLD-7 rule 6: the more conservative one) until
the architect rules. CP1 rulings: SPEC-Q-1, 2, 4 and 5 accepted; SPEC-Q-3 not accepted (below).
CP1 amendment 3: G1's negative control runs the pre-fix planner under both a reversed-order remap
and an order-preserving one (the salted-prefix case).

## SPEC-Q-1: the member's natural key

The plan search keys members by their position in `cfg.members`, archived members included, as the
architect's fix direction says. `loadHouseholdConfig` returns members in primary-key order, which is
creation order (UUIDv7 ids made in one process are strictly increasing, `schema/ids.ts`), so two
households set up the same way order their members the same way. Display names are not used: they
can change and need not be unique. A member missing from the configuration (a stale meal handed to
core directly; members are never deleted in the database) keeps its id, the only key it has.

## SPEC-Q-2: a household dish with a library dish's slug

`dish.slug` is unique per scope (`dish_household_id_slug_key`, nulls not distinct), so a household
dish may reuse a library slug. `PlanDish` gains only `slug` (R-73). Where two pool dishes share a
slug the planner's slug comparisons tie, and its stable sorts keep the input order, which the loader
fixes from natural keys: library dish first, then the household's. The seeded jitter of the two is
equal. No further field is added.

## SPEC-Q-3: "job path" in G2

G2's test lives in `packages/db/test/plans/` (OWNS), which cannot import `apps/worker` (ARC-3). It
runs `generatePlan`, the service the `plan.generate` handler calls, with the handler's arguments
(F1 week, seed 1, system actor). The handler adds progress events, logging and, in `auto` mode,
`requestDishes`; without a credential that requests nothing, and the plan and its rows are the ones
`generatePlan` persists. If the architect wants the worker's own handler run (`runJob` with
`planGenerate` on a worker runtime per database), the verify script can do it inside OWNS.

**Ruling (CP1): not accepted.** The verify script runs the worker's own handler (`runJob` with
`HANDLERS["plan.generate"]`, one worker runtime per database, no model) on two databases of its
own, and compares the persisted rows; the db int test stays as the lower-level check.

## SPEC-Q-4: what G1 compares

"Mapped back, identical dish per meal, plate grams, flags and reasons": the whole `PlanResult` is
compared after mapping every fresh id back, not only those fields, with the run counters that
depend on the process's memo state (`ms`, `solves`, `cacheHits`) zeroed as `support.ts` `stable`
already does. This is stricter than the listed fields and includes them.

## SPEC-Q-5: the pre-fix code for G1's negative control and G3's figures

"Today's id-keyed jitter" is the plan search at 9fb7109, the integration branch when this leaf was
dispatched. The verify script compiles `packages/core` from that commit (read with `git show`, into
a directory of its own) and runs the same comparison on it, which must fail; G3's pre-fix SC-1,
frequency-relaxed and SC-2 figures come from the same build. The commit is pinned, not taken as a
merge base, so the gate keeps its meaning after this leaf merges.
