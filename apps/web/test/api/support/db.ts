// One PostgreSQL database per test file (leaf-1.4.1 ADR-3): created on the server named by
// DATABASE_URL, migrated with the committed migrations, optionally loaded with the catalogue and
// seed library (R-17 loader), and dropped at the end. Gates can therefore run concurrently.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { runMigrations } from "@mealplanner/db/migrations";
import { migrateAndSeed } from "@mealplanner/db/seed";

export const SERVER_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

export interface TestDatabase {
  url: string;
  name: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: SERVER_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(opts: { seed?: boolean } = {}): Promise<TestDatabase> {
  const name = `api_${randomBytes(8).toString("hex")}`;
  await admin((c) => c.query(`CREATE DATABASE ${name}`));
  const url = withDatabase(SERVER_URL, name);
  if (opts.seed === false) await runMigrations(url);
  else await migrateAndSeed(url);
  return {
    url,
    name,
    async drop() {
      await admin(async (c) => {
        await c.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        );
        await c.query(`DROP DATABASE IF EXISTS ${name}`);
      });
    },
  };
}
