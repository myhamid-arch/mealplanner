// Exact database state as Postgres renders it (row_to_json text), for "restores the exact prior
// state" assertions. Rows are compared as text, so no JS type conversion can hide a difference.
import type pg from "pg";

/** Tables excluded from state comparison: the change log itself and the migrator's bookkeeping. */
export const LOG_TABLES = new Set(["change_set"]);

export type Snapshot = Map<string, string[]>;

export async function snapshotDatabase(
  pool: pg.Pool,
  exclude: ReadonlySet<string> = LOG_TABLES,
): Promise<Snapshot> {
  const { rows: tables } = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const snapshot: Snapshot = new Map();
  for (const { table_name: table } of tables) {
    if (exclude.has(table)) continue;
    const { rows } = await pool.query<{ r: string }>(
      `SELECT row_to_json(t)::text AS r FROM "${table}" t`,
    );
    snapshot.set(table, rows.map((row) => row.r).sort());
  }
  return snapshot;
}

/** Differences between two snapshots, as readable lines (empty = identical). */
export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const lines: string[] = [];
  for (const table of new Set([...before.keys(), ...after.keys()])) {
    const a = new Set(before.get(table) ?? []);
    const b = new Set(after.get(table) ?? []);
    for (const row of a) if (!b.has(row)) lines.push(`${table} - ${row}`);
    for (const row of b) if (!a.has(row)) lines.push(`${table} + ${row}`);
  }
  return lines;
}
