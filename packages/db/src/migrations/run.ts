// Applies the committed SQL migrations (leaf-1.1.2 ADR-2). Already-applied migrations are recorded
// in drizzle.__drizzle_migrations and skipped, so running this again is a no-op.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * The folder with the `.sql` files and `meta/_journal.json`. `tsc` does not copy `.sql`, so the
 * compiled module (dist/src/migrations/run.js) reads them from the package's src/migrations.
 */
export const MIGRATIONS_FOLDER = join(
  dirname(fileURLToPath(import.meta.url)),
  ...(import.meta.url.includes("/dist/") ? ["..", "..", "..", "src", "migrations"] : []),
);

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
