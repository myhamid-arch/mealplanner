// G2 (DM-1): cross-household access through every repository throws.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { HouseholdContext } from "@mealplanner/core/types";
import {
  CrossHouseholdError,
  GlobalRowReadOnlyError,
  REPOSITORY_NAMES,
  ScopedTable,
  TABLES,
  columnsOf,
  createRepos,
  type Executor,
  type TableName,
} from "../src/repos/index.js";
import type { Row } from "../src/repos/scoped.js";
import { newId } from "../src/schema/ids.js";
import { applyChangeSet, undoChangeSet } from "../src/services/changes/index.js";
import { loadHouseholdConfig } from "../src/services/config/index.js";
import {
  catalogDatabase,
  F1,
  F3,
  fixtureHousehold,
  type FixtureHousehold,
} from "./support/fixtures.js";
import type { TestDatabase } from "./support/db.js";
import { must } from "./support/must.js";

/** The repository surface under test; the real one and a deliberately leaky one implement it. */
interface RepoLike {
  get(key: Row): Promise<Row | null>;
  list(where?: Row): Promise<Row[]>;
  insert(row: Row): Promise<Row>;
  update(key: Row, patch: Row): Promise<Row>;
  remove(key: Row): Promise<void>;
}
type RepoFactory = (ctx: HouseholdContext, name: TableName) => RepoLike;

let database: TestDatabase;
let a: FixtureHousehold;
let b: FixtureHousehold;

beforeAll(async () => {
  database = await catalogDatabase();
  a = await fixtureHousehold(database, F3);
  b = await fixtureHousehold(database, F1);
}, 120_000);

afterAll(async () => {
  await database.drop();
});

const realRepo =
  (db: Executor): RepoFactory =>
  (ctx, name) =>
    new ScopedTable(db, ctx, name);

/** A repository without household filtering: the negative control. */
const leakyRepo =
  (db: Executor): RepoFactory =>
  (_ctx, name) => {
    const spec = TABLES[name];
    const cols = columnsOf(spec);
    const where = (key: Row) => and(...spec.key.map((k) => eq(must(cols[k]), key[k])));
    return {
      get: async (key) =>
        (await db.select().from(spec.table).where(where(key)).limit(1))[0] ?? null,
      list: async () => db.select().from(spec.table),
      insert: (row) => Promise.resolve(row),
      update: (_key, patch) => Promise.resolve(patch),
      remove: () => Promise.resolve(),
    };
  };

function keyOf(name: TableName, row: Row): Row {
  return Object.fromEntries(TABLES[name].key.map((k) => [k, row[k]]));
}

/** A row of household A's own in this table (not a global row). */
async function ownRow(ctx: HouseholdContext, name: TableName): Promise<Row | undefined> {
  const rows = (await createRepos(database.db, ctx)[name].list()) as Row[];
  const householdKey = TABLES[name].householdKey ?? "householdId";
  return rows.find((row) => row[householdKey] === ctx.householdId);
}

async function throwsScopeError(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return false;
  } catch (error) {
    return error instanceof CrossHouseholdError || error instanceof GlobalRowReadOnlyError;
  }
}

/**
 * Every way household B could reach household A's row through the repository. Returns the list of
 * accesses that did not throw (empty = isolated).
 */
async function isolationFailures(
  factory: RepoFactory,
  name: TableName,
  rowA: Row,
  ctxA: HouseholdContext,
  ctxB: HouseholdContext,
  readOnly = false,
): Promise<string[]> {
  const failures: string[] = [];
  const spec = TABLES[name];
  const repoB = factory(ctxB, name);
  const key = keyOf(name, rowA);
  if (!(await throwsScopeError(() => repoB.get(key)))) failures.push(`${name}.get`);
  const listed = await repoB.list().catch(() => [] as Row[]);
  if (listed.some((row) => JSON.stringify(keyOf(name, row)) === JSON.stringify(key)))
    failures.push(`${name}.list`);
  if (readOnly) return failures;

  const patchColumn = Object.keys(columnsOf(spec)).find(
    (c) => !(spec.key as readonly string[]).includes(c) && c !== spec.householdKey,
  );
  if (
    patchColumn !== undefined &&
    !(await throwsScopeError(() => repoB.update(key, { [patchColumn]: rowA[patchColumn] })))
  )
    failures.push(`${name}.update`);
  if (!(await throwsScopeError(() => repoB.remove(key)))) failures.push(`${name}.remove`);
  // Writing a row that claims household A while acting as B.
  const copy: Row = { ...rowA };
  if (spec.key.length === 1 && spec.key[0] === "id") copy.id = newId();
  if (!(await throwsScopeError(() => repoB.insert(copy))))
    failures.push(`${name}.insert(household A)`);
  // Writing a row of household B that references one of A's rows.
  if (spec.householdKey !== undefined && spec.scope !== "self") {
    const refsToA: string[] = [];
    for (const [column, entity] of Object.entries({ ...spec.refs, ...(spec.arrayRefs ?? {}) })) {
      const values = Array.isArray(copy[column]) ? (copy[column] as unknown[]) : [copy[column]];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const target = TABLES[entity as TableName];
        if (target.scope === "global") continue;
        const targetRow = await new ScopedTable(database.db, ctxA, entity as TableName)
          .get({ id: value })
          .catch(() => null);
        if (
          targetRow !== null &&
          targetRow[target.householdKey ?? "householdId"] === ctxA.householdId
        )
          refsToA.push(column);
      }
    }
    if (refsToA.length > 0) {
      const crossRef: Row = { ...copy, [spec.householdKey]: ctxB.householdId };
      if (!(await throwsScopeError(() => repoB.insert(crossRef))))
        failures.push(`${name}.insert(ref to A via ${refsToA.join(",")})`);
    }
  }
  return failures;
}

describe(
  "G2 cross-household access through every repository throws (DM-1)",
  { timeout: 120_000 },
  () => {
    it("every household-owned table has a repository and a row of household A to attack", async () => {
      const missing: string[] = [];
      for (const name of REPOSITORY_NAMES)
        if ((await ownRow(a.loaded.adminContext, name)) === undefined) missing.push(name);
      expect(missing).toEqual([]);
      expect(REPOSITORY_NAMES.length).toBeGreaterThanOrEqual(40);
      // Every table with a household column in the schema is covered by a repository.
      const { rows } = await database.pool.query<{ table_name: string }>(
        "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('household_id', 'created_by_household_id')",
      );
      const withHouseholdColumn = rows
        .map((r) => r.table_name)
        .concat("household")
        .sort();
      expect([...REPOSITORY_NAMES].sort()).toEqual(withHouseholdColumn);
    });

    it.each([...REPOSITORY_NAMES])(
      "repository %s: get, list, update, remove and insert across households throw",
      async (name) => {
        const ctxA = a.loaded.adminContext;
        const ctxB = b.loaded.adminContext;
        const rowA = await ownRow(ctxA, name);
        expect(rowA).toBeDefined();
        // Positive control: household A itself can read the row.
        const repoA = realRepo(database.db)(ctxA, name);
        expect(await repoA.get(keyOf(name, must(rowA)))).not.toBeNull();
        expect(
          await isolationFailures(realRepo(database.db), name, must(rowA), ctxA, ctxB),
        ).toEqual([]);
        // And the reverse direction.
        const rowB = await ownRow(ctxB, name);
        expect(
          await isolationFailures(realRepo(database.db), name, must(rowB), ctxB, ctxA),
        ).toEqual([]);
      },
    );

    it("global catalogue rows are readable by both households and writable by neither", async () => {
      for (const ctx of [a.loaded.adminContext, b.loaded.adminContext]) {
        const repos = createRepos(database.db, ctx);
        const globalIngredient = (await repos.ingredient.list({ createdByHouseholdId: null }))[0];
        expect(globalIngredient).toBeDefined();
        const table = new ScopedTable(database.db, ctx, "ingredient");
        await expect(
          table.update({ id: must(globalIngredient).id }, { name: "changed" }),
        ).rejects.toBeInstanceOf(GlobalRowReadOnlyError);
        await expect(table.remove({ id: must(globalIngredient).id })).rejects.toBeInstanceOf(
          GlobalRowReadOnlyError,
        );
        await expect(
          new ScopedTable(database.db, ctx, "cuisine").insert({
            id: newId(),
            key: "x",
            label: "x",
            flagEmoji: null,
            parentKey: null,
          }),
        ).rejects.toBeInstanceOf(GlobalRowReadOnlyError);
      }
    });

    it("the change-set service and config reads are scoped too", async () => {
      const ctxB = b.loaded.adminContext;
      const memberA = must(Object.values(a.loaded.members)[0]);
      await expect(
        applyChangeSet(database.db, ctxB, {
          actor: "user",
          source: "ui",
          summary: "attack",
          ops: [{ kind: "member.update", payload: { memberId: memberA, displayName: "x" } }],
        }),
      ).rejects.toBeInstanceOf(CrossHouseholdError);
      await expect(
        undoChangeSet(database.db, ctxB, must(a.loaded.changeSetIds[1]), {
          actor: "user",
          source: "ui",
        }),
      ).rejects.toBeInstanceOf(CrossHouseholdError);
      const configB = await loadHouseholdConfig(database.db, ctxB);
      const idsA = new Set(Object.values(a.loaded.members));
      expect(configB.members.some((m) => idsA.has(m.id))).toBe(false);
      expect(configB.members.length).toBe(Object.keys(b.loaded.members).length);
    });

    it("negative control: the same checks fail against a repository without household filtering", async () => {
      const ctxA = a.loaded.adminContext;
      const ctxB = b.loaded.adminContext;
      const leaked: string[] = [];
      for (const name of REPOSITORY_NAMES) {
        const rowA = await ownRow(ctxA, name);
        leaked.push(
          ...(await isolationFailures(leakyRepo(database.db), name, must(rowA), ctxA, ctxB, true)),
        );
      }
      // Every table's get leaks, so the check is not vacuous for any repository.
      for (const name of REPOSITORY_NAMES) expect(leaked).toContain(`${name}.get`);
    });
  },
);
