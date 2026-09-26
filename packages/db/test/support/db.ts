// A fresh, migrated database per test file on the server named by DATABASE_URL (ADR-5).
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { runMigrations } from "../../src/migrations/index.js";
import { newId } from "../../src/schema/ids.js";
import type { Executor } from "../../src/repos/index.js";

export interface TestDatabase {
  url: string;
  name: string;
  db: Executor;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export function serverUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "")
    throw new Error("DATABASE_URL is not set (integration tests need PostgreSQL 16)");
  return url;
}

export function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: serverUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Creates an empty database (no migrations). */
export async function createEmptyDatabase(
  prefix = "mp_test",
): Promise<{ url: string; name: string; drop: () => Promise<void> }> {
  const name = `${prefix}_${newId().replaceAll("-", "")}`;
  await admin((c) => c.query(`CREATE DATABASE "${name}"`));
  return {
    url: withDatabase(serverUrl(), name),
    name,
    drop: () =>
      admin((c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).then(() => undefined),
  };
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const empty = await createEmptyDatabase();
  await runMigrations(empty.url);
  const pool = new pg.Pool({ connectionString: empty.url, max: 4 });
  return {
    url: empty.url,
    name: empty.name,
    db: drizzle(pool),
    pool,
    drop: async () => {
      await pool.end();
      await empty.drop();
    },
  };
}
