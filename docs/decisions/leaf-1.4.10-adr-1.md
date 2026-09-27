# Leaf 1.4.10 ADR-1: the graph start-up fix relies on PostgreSQL upsert waits, not job order

Status: proposed at CP1.

## Context

W-13 (reproduced, `leaf-1.4.10-w13.md`): the seed-library `dish` sync writes edges to global
`Ingredient`, `Cuisine` and `Method` nodes that the concurrent `catalogue` sync has not committed.
The two fix directions in 11 §8 W-13 are (1) one start-up job doing the catalogue then the dishes,
or (2) a `dish` request that syncs the catalogue first when its nodes are missing.

Direction (1) fixes the start-up only. Any other `dish` sync that runs before the catalogue commits
(a household's recipe change at start-up on a cold deploy, or the household case in SPEC-Q-6) keeps
the race. G2 asks that the catalogue nodes exist before **any** `dish` sync writes edges to them,
"whatever the worker's concurrency".

## Decision

Direction (2), in `packages/graph/src/sync/sync.ts`:

1. Before `syncDishes` writes anything, it derives the dishes (as today) and looks up the catalogue
   nodes their edges point to (`nodesByKey`). If any is missing, it runs the catalogue sync of that
   scope **in its own transaction first**, then writes the dishes.
2. `apps/worker/src/main.ts` keeps enqueuing both start-up jobs; it needs no ordering.

Why this is safe when the two jobs overlap (PostgreSQL 16, READ COMMITTED, the store's
`INSERT … ON CONFLICT … DO UPDATE` upserts):

- An upsert of a row that a concurrent, uncommitted transaction inserted **waits** for that
  transaction, then updates the committed row (PostgreSQL docs, "INSERT … ON CONFLICT", and
  "Transaction Isolation: Read Committed"). So whichever sync reaches the first catalogue node
  first proceeds, and the other waits at its first node upsert, having written nothing yet. Both
  derive the same node list in the same order, so neither holds a lock the other needs: no
  deadlock.
- Both write the same nodes and the same `IN_CATEGORY` / `SUBSTITUTES_FOR` edges (the catalogue
  sync is idempotent, 1.3.4 G1), so the final graph does not depend on which one ran first.
- A node that truly does not exist in the catalogue (a dish naming a deleted ingredient) is still
  missing after the catalogue sync, and the edge write fails as before: the guard does not hide
  real errors.

## Verification (G2)

`apps/web/test/api/kg-startup.int.test.ts` runs `startWorker` at concurrency 2 on an empty graph
with the seed library, three ways: the natural interleaving, the catalogue job held back until the
dish job has run, and the catalogue job holding its transaction open (nodes written, not committed)
while the dish job runs. Each must finish with no `retrying` or `failed` event, and the graph must
equal the rebuild's (SPEC-Q-5). The same three runs with the pre-fix `syncDishes` (a verbatim
test-only copy of `f7b041a`'s) must fail: the negative control.

## Consequences

- A `dish` sync on an empty graph does the catalogue work too (about 0.1 s for the global
  catalogue in the reproduction). It happens only when nodes are missing.
- No new dependency, no schema change, no change to the job runner or the queue options.
