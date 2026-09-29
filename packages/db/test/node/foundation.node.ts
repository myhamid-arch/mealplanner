// node-1.1 N3, service path (R-69): migrations from 0000 on the empty database the verify script
// created, the catalogue, F1, then a change set across members, targets, exclusions and settings
// applied and undone through the changes service; every compared table must equal its pre-apply
// snapshot, row for row (SC-4 at foundation level). Negative control: the same undo with one
// before-image removed from the stored inverse fails the equality check.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { F1 } from "../../../core/dist/test/fixtures/index.js";
import { MIGRATIONS_FOLDER, runMigrations } from "../../src/migrations/index.js";
import { changeSet } from "../../src/schema/index.js";
import { DEFAULT_DATA_DIR, loadCatalogue } from "../../src/seed/index.js";
import { applyChangeSet, undoChangeSet } from "../../src/services/changes/index.js";
import { loadFixture, type LoadedFixture } from "../../src/services/config/index.js";
import { foundationOps } from "./foundation-ops.js";
import {
  changedTables,
  diffSnapshots,
  imageEntities,
  measure,
  NOT_COMPARED,
  openDatabase,
  requiredEnv,
  snapshot,
  type NodeDatabase,
} from "./support.js";

let database: NodeDatabase;
let f1: LoadedFixture;

beforeAll(() => {
  database = openDatabase(requiredEnv("NODE_DB_URL"));
});

afterAll(async () => {
  await database.close();
});

async function tableCount(schema: string): Promise<number> {
  const { rows } = await database.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1",
    [schema],
  );
  return rows[0]?.n ?? 0;
}

/** Applies the set, undoes it and returns what the equality check and the script need. */
async function applyAndUndo(tag: string, tamper?: (inverse: unknown[]) => unknown[]) {
  const ctx = f1.adminContext;
  const set = await foundationOps(database.db, ctx, tag);
  const before = await snapshot(database.pool);
  const applied = await applyChangeSet(database.db, ctx, {
    actor: "user",
    source: "ui",
    summary: set.summary,
    ops: set.ops,
  });
  const after = await snapshot(database.pool);
  const [row] = await database.db
    .select({ inverse: changeSet.inverse })
    .from(changeSet)
    .where(and(eq(changeSet.householdId, ctx.householdId), eq(changeSet.id, applied.changeSetId)));
  const entities = imageEntities(row?.inverse ?? []);
  let removed: string | null = null;
  if (tamper !== undefined) {
    const inverse = tamper(row?.inverse as unknown[]);
    removed = JSON.stringify(inverse) === JSON.stringify(row?.inverse) ? null : "one image";
    await database.pool.query("UPDATE change_set SET inverse = $1::jsonb WHERE id = $2", [
      JSON.stringify(inverse),
      applied.changeSetId,
    ]);
  }
  await undoChangeSet(database.db, ctx, applied.changeSetId, { actor: "user", source: "ui" });
  const restored = await snapshot(database.pool);
  return {
    set,
    entities,
    changed: changedTables(before, after),
    restoreDiff: diffSnapshots(before, restored),
    removed,
  };
}

/** Removes the first before-image of a `member` row (the member.update op's) from the inverse. */
function withoutOneMemberImage(inverse: unknown[]): unknown[] {
  const copy = structuredClone(inverse) as {
    kind: string;
    payload: { images: { entity: string; before: unknown }[] };
  }[];
  for (const op of copy) {
    const index = op.payload.images.findIndex((i) => i.entity === "member" && i.before !== null);
    if (index !== -1) {
      op.payload.images.splice(index, 1);
      return copy;
    }
  }
  return copy;
}

describe("node-1.1 N3 foundation (service)", () => {
  it("N3 migrations 0000 onward on an empty database", async () => {
    expect(await tableCount("public")).toBe(0);
    await runMigrations(database.url);
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string; when: number }[] };
    const files = readdirSync(MIGRATIONS_FOLDER)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    const { rows } = await database.pool.query<{ created_at: string }>(
      "SELECT created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    expect(journal.entries.map((e) => e.tag).sort()).toEqual(files);
    expect(files[0]).toMatch(/^0000_/);
    expect(rows.map((r) => Number(r.created_at))).toEqual(journal.entries.map((e) => e.when));
    const tables = await tableCount("public");
    expect(tables).toBeGreaterThan(20);
    measure({ check: "migrations", applied: rows.length, files: files.length, tables });
  });

  it("N3 the catalogue loads and F1 is seeded", async () => {
    const loaded = await loadCatalogue(database.db, { dataDir: DEFAULT_DATA_DIR });
    const { rows } = await database.pool.query<{ ingredients: number; dishes: number }>(
      "SELECT (SELECT count(*) FROM ingredient)::int AS ingredients, (SELECT count(*) FROM dish)::int AS dishes",
    );
    expect(rows[0]?.ingredients).toBeGreaterThan(0);
    expect(rows[0]?.dishes).toBeGreaterThan(0);
    expect(loaded.dishIds.length).toBe(rows[0]?.dishes);
    f1 = await loadFixture(database.db, F1);
    const members = await database.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM member WHERE household_id = ${f1.householdId}`,
    );
    expect(members.rows[0]?.n).toBe(Object.keys(f1.members).length);
    measure({
      check: "seed",
      ingredients: rows[0]?.ingredients,
      dishes: rows[0]?.dishes,
      members: members.rows[0]?.n,
      householdId: f1.householdId,
    });
  });

  it("N3 service: a change set across members, targets, exclusions and settings is undone exactly", async () => {
    const r = await applyAndUndo("service");
    expect(r.changed).toEqual(expect.arrayContaining(r.set.expectChanged));
    expect(r.entities.filter((e) => NOT_COMPARED.has(e))).toEqual([]);
    expect(r.restoreDiff).toEqual([]);
    measure({
      check: "service",
      ops: r.set.ops.map((o) => o.kind),
      changed: r.changed,
      entities: r.entities,
      restoreDiff: r.restoreDiff.length,
      notCompared: [...NOT_COMPARED],
    });
  });

  it("N3 negative control: an undo that skips one before-image fails the equality check", async () => {
    const r = await applyAndUndo("service-control", withoutOneMemberImage);
    expect(r.removed).not.toBeNull();
    expect(r.restoreDiff.length).toBeGreaterThan(0);
    expect(r.restoreDiff.every((line) => line.startsWith("member "))).toBe(true);
    measure({ check: "service-control", restoreDiff: r.restoreDiff.length });
  });
});
