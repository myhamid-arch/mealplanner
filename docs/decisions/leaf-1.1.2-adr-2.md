# leaf-1.1.2 ADR-2: migrations (drizzle-kit generate, drizzle-orm migrate)

Status: accepted (CP1 APPROVED with amendments; built for CP2)
Requirement: ARC-1 (Drizzle ORM + drizzle-kit, SQL-first migrations), ARC-11 (migrations on deploy), G1

## Decision

- **drizzle-kit 0.31.11** (already a devDependency of `packages/db`). Config at `packages/db/src/migrations/drizzle.config.ts`: `dialect: "postgresql"`, `schema: "./src/schema/index.ts"`, `out: "./src/migrations"`, `casing` unset (column names are spelled explicitly in the schema), `dbCredentials.url` from `DATABASE_URL`. Run from `packages/db`: `pnpm exec drizzle-kit generate --config src/migrations/drizzle.config.ts`.
- **Deviation D-1 from BLD-8 R-5's path.** A `.ts` file at `packages/db/drizzle.config.ts` is outside the package's TypeScript project (`include: ["src", "test"]`, owned by 1.1.1), and ESLint's typed rules then fail with a parsing error (`was not found by the project service`), which turns CI red. The config therefore lives inside `src/migrations/` (in this leaf's OWNS). It can move back once the architect adds it to the tsconfig `include` or to ESLint's `allowDefaultProject` (PR Requests).
- Migrations are **generated** SQL (`drizzle-kit generate`), committed with drizzle-kit's `meta/_journal.json` and snapshots. One hand-written custom migration (`drizzle-kit generate --custom`) comes first: `CREATE EXTENSION IF NOT EXISTS citext;` (02: `user.email` is citext). Generated SQL is not edited by hand after generation.
- **Applying.** `migrate(db, { migrationsFolder })` from `drizzle-orm/node-postgres/migrator` (signature verified in the installed 0.45.3 `migrator.d.ts`). It records applied hashes in `drizzle.__drizzle_migrations` and skips them on the next run, which is the "roll forward idempotently" property G1 tests. Exposed as `runMigrations(databaseUrl)` in `packages/db/src/migrations/run.ts` (subpath `@mealplanner/db/migrations`). The SQL folder is resolved relative to the compiled module (`dist/src/migrations/run.js` → `../../../src/migrations`), because `tsc` does not copy `.sql` files; the package ships its `src/migrations` folder.
- A drift check: `drizzle-kit generate` run against the committed snapshots must report no changes (G1 runs it in a scratch copy and fails if a new migration file appears). This proves the committed SQL matches the TypeScript schema.
- drizzle-kit 0.31.11 resolves the NodeNext `.js` specifiers of `src/schema/*.ts` directly (verified: `drizzle-kit generate` produced `0001_schema.sql` with 52 tables and later reports `No schema changes, nothing to migrate`).
- drizzle-kit 0.31.11 needs `out` relative to the working directory, and it exits 0 on some errors (an absolute `out` fails with ENOENT and exit 0, measured in this session). The G1 test therefore accepts a generate or push run only when drizzle-kit prints its explicit success line.
- **Edited migrations (BLD-8 R-9).** G1 builds one database from the committed migrations and one from the TypeScript schema (`drizzle-kit push`) and compares a fingerprint of columns, constraints, indexes and enums. An edited migration makes them differ (negative control: removing `household_user.blocked_reason` from the committed SQL is detected), and a schema edit without a migration makes `drizzle-kit generate` add a file (negative control).

## Rejected

- `drizzle-kit push` (no migration history; ARC-1 asks for SQL-first migrations).
- `drizzle-kit migrate` at runtime (it is a dev CLI; the worker/web apply migrations through the library call, ARC-11 "migrations run on deploy" is satisfied by `runMigrations`).
