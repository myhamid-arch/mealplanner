# leaf-1.1.2 ADR-2: migrations (drizzle-kit generate, drizzle-orm migrate)

Status: proposed (CP1)
Requirement: ARC-1 (Drizzle ORM + drizzle-kit, SQL-first migrations), ARC-11 (migrations on deploy), G1

## Decision
- **drizzle-kit 0.31.11** (already a devDependency of `packages/db`). Config `packages/db/drizzle.config.ts` (BLD-8 R-5): `dialect: "postgresql"`, `schema: "./src/schema/index.ts"`, `out: "./src/migrations"`, `casing` unset (column names are spelled explicitly in the schema), `dbCredentials.url` from `DATABASE_URL`.
- Migrations are **generated** SQL (`drizzle-kit generate`), committed with drizzle-kit's `meta/_journal.json` and snapshots. One hand-written custom migration (`drizzle-kit generate --custom`) comes first: `CREATE EXTENSION IF NOT EXISTS citext;` (02: `user.email` is citext). Generated SQL is not edited by hand after generation.
- **Applying.** `migrate(db, { migrationsFolder })` from `drizzle-orm/node-postgres/migrator` (signature verified in the installed 0.45.3 `migrator.d.ts`). It records applied hashes in `drizzle.__drizzle_migrations` and skips them on the next run, which is the "roll forward idempotently" property G1 tests. Exposed as `runMigrations(databaseUrl)` in `packages/db/src/migrations/run.ts` (subpath `@mealplanner/db/migrations`). The SQL folder is resolved relative to the compiled module (`dist/src/migrations/run.js` → `../../../src/migrations`), because `tsc` does not copy `.sql` files; the package ships its `src/migrations` folder.
- A drift check: `drizzle-kit generate` run against the committed snapshots must report no changes (G1 runs it in a scratch copy and fails if a new migration file appears). This proves the committed SQL matches the TypeScript schema.
- If drizzle-kit's loader cannot resolve the NodeNext `.js` specifiers inside `src/schema/*.ts`, the config points at the compiled `dist/src/schema/index.js` instead, and `pnpm --filter @mealplanner/db build` runs first. Whichever works is recorded here at CP2 with the command output.

## Rejected
- `drizzle-kit push` (no migration history; ARC-1 asks for SQL-first migrations).
- `drizzle-kit migrate` at runtime (it is a dev CLI; the worker/web apply migrations through the library call, ARC-11 "migrations run on deploy" is satisfied by `runMigrations`).
