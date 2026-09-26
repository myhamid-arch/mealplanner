// drizzle-kit configuration (BLD-8 R-5, leaf-1.1.2 ADR-2). Run from packages/db:
//   pnpm exec drizzle-kit generate --config src/migrations/drizzle.config.ts
// It lives here rather than at packages/db/drizzle.config.ts because only src/ and test/ are in the
// package's TypeScript project, and ESLint's typed rules reject a .ts file outside it (see ADR-2).
// `drizzle-kit generate` writes SQL migrations into src/migrations; they are applied at runtime by
// runMigrations() in src/migrations/run.ts.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mealplanner",
  },
  strict: true,
  verbose: true,
});
