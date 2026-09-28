# Leaf 1.4.10: W-13 reproduction (graph start-up order)

Status: **reproduced** at CP1, on the integration head `f7b041a` (before any change in this leaf).

## What was run

`apps/web/test/api/kg-startup.int.test.ts` (this leaf), against PostgreSQL 16 on localhost:5432:

1. A fresh database, migrated and loaded with the catalogue and the seed library (`migrateAndSeed`,
   the R-17 loader). The graph is empty (`kg_node` has 0 rows).
2. A real worker runtime (`createWorkerRuntime`) with `concurrency: 2`, the default of
   `WORKER_CONCURRENCY` (`apps/worker/src/env.ts`).
3. `startWorker(rt)` from `apps/worker/src/main.ts`, unchanged. It creates the queues with
   `localConcurrency: 2` and calls `syncCatalogueGraph`, which enqueues the global `catalogue`
   `kg.sync` job and the seed-library `dish` `kg.sync` job together.
4. Wait until neither `kg.sync` job is `queued` or `running`, then read their `job_event` rows.

The assertion: no `kg.sync` job has a `retrying` or `failed` event.

## Result

| Run | `WORKER_CONCURRENCY` | Outcome |
|---|---|---|
| 1–6 | 2 | **fails every time**: the `dish` job's first attempt throws, then its retry (2 s later) succeeds |
| 7–9 | 1 | passes every time (the queue runs the catalogue job, then the dish job) |

The failing attempt's `retrying` event, verbatim (ingredient ids differ per database):

```
40 edge(s) name a node that does not exist: Cuisine:tex_mex@global, Cuisine:mexican@global,
Method:roasted@global, Ingredient:01a0e3a3-b7ec-7323-bf0a-8223691e7c22@global,
Ingredient:01a0e3a3-b7ec-733e-84e0-79eb78f96f6d@global
```

This is the message of W-13. Event order in run 1: catalogue `started`, dish `started`, dish
`retrying` (attempt 1), catalogue `done` (109 ms), dish `done` (2674 ms, after the 2 s retry delay).

## Cause (confirmed)

Both start-up jobs run at once on the `kg.sync` queue. The dish job's transaction writes its edges
(`CONTAINS`, `OF_CUISINE`, `PREPARED_BY`) with an `INSERT … SELECT … JOIN kg_node`
(`packages/graph/src/store/postgres.ts` `#writeEdges`). The catalogue job's nodes are not yet
committed, so they are invisible to that statement; the join drops those edges and the store throws.
The runner's retry (`RETRY_DELAYS_MS` 2 s, 8 s) then succeeds because by then the catalogue job has
committed. If the catalogue job were slower than both retries, the seed library would be left out
of the graph.

## Negative control kept for G2

The pre-fix start-up (the `syncDishes` of `f7b041a`) is kept as a test-only copy so G2 can show
that the same test fails on it, deterministically (see ADR-1 for the forced interleavings).
