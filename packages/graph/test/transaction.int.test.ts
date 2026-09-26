// Transaction semantics of PostgresGraphStore (KG-3: each sync request is one transaction): a pool
// gets its own BEGIN … COMMIT; a client inside the caller's transaction joins it by savepoint.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGraphStore } from "../src/store/postgres.js";
import { PostgresKgSource } from "../src/sync/postgres-source.js";
import { syncGraph } from "../src/sync/sync.js";
import { createTestDatabase, dropAll, type TestDatabase } from "./support/db.js";
import { SUBSTITUTES_CSV, loadCatalogue } from "./support/relational.js";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await loadCatalogue(db.pool);
}, 120_000);

afterAll(async () => {
  await dropAll([db]);
});

const nodeCount = async () =>
  ((await db.pool.query("SELECT count(*)::int AS n FROM kg_node")).rows[0] as { n: number }).n;

async function withClient<T>(work: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

const graph = (conn: import("pg").ClientBase | import("pg").Pool) => {
  const source = new PostgresKgSource(db.pool, { substitutes: SUBSTITUTES_CSV });
  return {
    source,
    store: new PostgresGraphStore(conn, { exclusions: (hh) => source.exclusions(hh) }),
  };
};

describe("store transactions", () => {
  it("a sync inside the caller's transaction is undone by the caller's ROLLBACK", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      const { store, source } = graph(client);
      await syncGraph(store, source, { kind: "catalogue" });
      const inside = (await client.query("SELECT count(*)::int AS n FROM kg_node")).rows[0] as {
        n: number;
      };
      expect(inside.n).toBeGreaterThan(0);
      await client.query("ROLLBACK");
    });
    expect(await nodeCount()).toBe(0);
  });

  it("a failed sync inside the caller's transaction rolls back to its savepoint only", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      await client.query(`INSERT INTO kg_node (id, household_id, type, key, label, props)
        VALUES ('01900000-0000-7000-8000-000000000001', NULL, 'FlavourTag', 'caller', 'caller', '{}')`);
      const { store } = graph(client);
      await expect(
        store.transaction(async (tx) => {
          await tx.upsertNodes([
            { householdId: null, type: "FlavourTag", key: "inside", label: "inside", props: {} },
          ]);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await client.query("COMMIT");
    });
    const keys = (
      (await db.pool.query("SELECT key FROM kg_node ORDER BY key")).rows as Array<{ key: string }>
    ).map((r) => r.key);
    expect(keys).toEqual(["caller"]);
    await db.pool.query("DELETE FROM kg_node");
  });

  it("a client outside a transaction, and a pool, each commit their own transaction", async () => {
    await withClient(async (client) => {
      const { store, source } = graph(client);
      await syncGraph(store, source, { kind: "catalogue" });
    });
    const afterClient = await nodeCount();
    expect(afterClient).toBeGreaterThan(0);
    await db.pool.query("DELETE FROM kg_edge");
    await db.pool.query("DELETE FROM kg_node");
    const { store, source } = graph(db.pool);
    await syncGraph(store, source, { kind: "catalogue" });
    expect(await nodeCount()).toBe(afterClient);
  });

  it("a request that fails after writing leaves nothing behind (pool)", async () => {
    await db.pool.query("DELETE FROM kg_edge");
    await db.pool.query("DELETE FROM kg_node");
    const { store } = graph(db.pool);
    await expect(
      store.transaction(async (tx) => {
        await tx.upsertNodes([
          { householdId: null, type: "FlavourTag", key: "written", label: "written", props: {} },
        ]);
        await tx.upsertEdges([
          {
            householdId: null,
            type: "HAS_FLAVOUR",
            src: { householdId: null, type: "Dish", key: "missing" },
            dst: { householdId: null, type: "FlavourTag", key: "written" },
            weight: 1,
            props: {},
            source: "derived",
          },
        ]);
      }),
    ).rejects.toThrow(/name a node that does not exist: Dish:missing@global/);
    expect(await nodeCount()).toBe(0);
  });
});
