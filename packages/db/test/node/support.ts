// Shared by the node-gate tests (R-69): the database the verify script created, measurements for
// the script to re-check, and the state comparison used for "undo restores the prior state".
import { appendFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Executor } from "../../src/repos/index.js";
import { diffSnapshots, snapshotDatabase, type Snapshot } from "../support/snapshot.js";

export { diffSnapshots, type Snapshot };

/**
 * Tables left out of the "every touched table equals its pre-apply snapshot" comparison
 * (SPEC-Q-4): the change log itself, follow-up jobs the request path queues, and the auth tables the
 * request path writes. `assertUntouched` proves a change set's own before-images name none of them.
 */
export const NOT_COMPARED: ReadonlySet<string> = new Set([
  "change_set",
  "job",
  "session",
  "account",
  "verification",
  "user",
]);

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is not set: run this test through its node verify script`);
  return value;
}

export interface NodeDatabase {
  url: string;
  pool: pg.Pool;
  db: Executor;
  close(): Promise<void>;
}

export function openDatabase(url: string): NodeDatabase {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return { url, pool, db: drizzle(pool), close: () => pool.end() };
}

/** Every public table except NOT_COMPARED, as Postgres renders the rows (exact comparison). */
export function snapshot(pool: pg.Pool): Promise<Snapshot> {
  return snapshotDatabase(pool, NOT_COMPARED);
}

/** Tables whose rows differ between two snapshots. */
export function changedTables(before: Snapshot, after: Snapshot): string[] {
  return [...new Set(diffSnapshots(before, after).map((line) => line.split(" ")[0] ?? ""))].sort();
}

/** The entities a stored change set's before-images name (its inverse `rows.restore` payloads). */
export function imageEntities(inverse: unknown): string[] {
  const entities = new Set<string>();
  for (const op of inverse as { payload?: { images?: { entity: string }[] } }[])
    for (const image of op.payload?.images ?? []) entities.add(image.entity);
  return [...entities].sort();
}

/** Appends one measurement for the verify script (NODE_MEASURE_FILE, JSON lines). */
export function measure(record: Record<string, unknown>): void {
  const file = process.env.NODE_MEASURE_FILE;
  if (file !== undefined && file !== "") appendFileSync(file, `${JSON.stringify(record)}\n`);
}
