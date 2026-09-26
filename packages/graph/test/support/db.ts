// One fresh, migrated database per test file on the server named by DATABASE_URL (leaf-1.3.4 ADR-1).
// Migrations are the committed SQL of packages/db, applied with drizzle's migrator by folder path
// (not a module import: ARC-3, R-2).
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { newId } from "../../src/store/uuid.js";

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../db/src/migrations", import.meta.url),
);

export function serverUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "")
    throw new Error("DATABASE_URL is not set (integration tests need PostgreSQL 16)");
  return url;
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  name: string;
  url: string;
  pool: pg.Pool;
  /** Closes the pool (the database stays). */
  close(): Promise<void>;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

function open(name: string): TestDatabase {
  const url = withDatabase(serverUrl(), name);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // An idle client of a dropped database reports the termination here; the test is over by then.
  pool.on("error", () => undefined);
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await pool.end();
    }
  };
  return {
    name,
    url,
    pool,
    close,
    drop: async () => {
      await close();
      await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

const freshName = () => `kg_test_${newId().replaceAll("-", "")}`;

/** A new database with every committed migration applied. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = freshName();
  await admin(`CREATE DATABASE "${name}"`);
  const client = new pg.Client({ connectionString: withDatabase(serverUrl(), name) });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
  return open(name);
}

/** A byte-for-byte copy of `source` (its pool must be closed first). */
export async function cloneDatabase(source: TestDatabase): Promise<TestDatabase> {
  await source.close();
  const name = freshName();
  await admin(`CREATE DATABASE "${name}" TEMPLATE "${source.name}"`);
  return open(name);
}

/** Reopens a database whose pool was closed (for example by `cloneDatabase`). */
export function reopen(db: TestDatabase): TestDatabase {
  return open(db.name);
}

/** Closes every pool, then drops each database once. */
export async function dropAll(dbs: readonly TestDatabase[]): Promise<void> {
  for (const db of dbs) await db.close();
  for (const name of new Set(dbs.map((db) => db.name)))
    await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}
