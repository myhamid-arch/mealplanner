# leaf-1.3.4 ADR-1: PostgreSQL access from `@mealplanner/graph`

Status: accepted (CP1 APPROVED, BLD-8 R-35)
Requirements: KG-1, KG-2, KG-3, ARC-3 (BLD-8 R-2: `graph` does not import `db`)

## Context
`PostgresGraphStore` reads and writes `kg_node` / `kg_edge`, whose schema and migrations belong to `@mealplanner/db` (1.1.2). R-2 forbids `graph → db` imports, so the Drizzle table objects in `packages/db/src/schema/graph.ts` cannot be used. `packages/graph/package.json` already declares `pg 8.23.0`, `drizzle-orm 0.45.3` and `@types/pg 8.23.1`.

## Decision
- **`pg` 8.23.0, parameterised SQL.** The store and the relational source take a structural `Queryable` (`{ query(text, values) }`), satisfied by `pg.Pool`, `pg.PoolClient` and `pg.Client`. Writes that must be atomic (one sync request, one rebuild) run in one transaction, rolled back on any error:
  - given a pool (recognised by `connect()` **and** `idleCount`; `pg.Client` also has a `connect()` that connects itself), the store checks out a client and runs `BEGIN … COMMIT`;
  - given a single client already inside the caller's transaction, it joins that transaction through `SAVEPOINT kg_graph_store` (released on success, rolled back to on failure), so the caller's `COMMIT` or `ROLLBACK` decides;
  - given a single client outside a transaction (`SAVEPOINT` fails with SQLSTATE 25P01), it runs its own `BEGIN … COMMIT`.
  `test/transaction.int.test.ts` covers the three cases.
- **Bulk statements through `unnest`.** Node and edge upserts send one statement per batch, with column arrays (`unnest($1::uuid[], $2::text[], …)`) and `ON CONFLICT … DO UPDATE` on the existing unique keys (`kg_node_household_type_key_key`, `kg_edge_household_src_dst_type_key`, both `NULLS NOT DISTINCT`). Edge endpoints are resolved from natural keys `(household_id, type, key)` in the same statement by joining `kg_node`.
- **No duplicate Drizzle table definitions** in `graph`. The SQL names only the columns of 02 §8. The integration tests run against the real migrated schema, so a column rename in `db` fails them.
- **Node ids** are UUIDv7 generated in the app (02 preamble), created on first insert and kept on every later upsert. `graph` carries its own 25-line UUIDv7 helper because `db`'s `newId` cannot be imported.
- **Numeric columns**: `weight` is `numeric(10,3)`; `pg` returns `numeric` as a string, parsed with `Number()` in one row mapper. Derived weights are rounded to 3 decimals before writing, so a rebuild and an incremental sync compare equal.
- **Tests and migrations.** Integration tests (`*.int.test.ts`) create one database per test file on the server in `DATABASE_URL` (`CREATE DATABASE kg_test_<uuid>`), apply the committed migrations with `drizzle-orm/node-postgres/migrator` pointed at the path `packages/db/src/migrations` (a folder path, not a module import, so ARC-3 holds), and drop the database afterwards. Gates therefore never share a database.

## Alternatives
- Import `@mealplanner/db` tables and repositories: forbidden by R-2.
- A Drizzle `pgTable` copy of `kg_node`/`kg_edge` inside `graph`: a second schema definition that can drift silently; the SQL is just as checked by the integration tests. Rejected.
- `gen_random_uuid()` in SQL: UUIDv4, contrary to 02's UUIDv7 rule. Rejected.

## Consequences
- No new dependency. `drizzle-orm` is used only by the test support (migrator).
- The relational reads of `PostgresKgSource` go through the connection it was given, outside the store's transaction; they read committed rows.
- The recursive-CTE path (08 §5 "with recursive CTEs where needed") is used by `similarDishes` to walk Dish → Component → Variant → Ingredient in one query.
