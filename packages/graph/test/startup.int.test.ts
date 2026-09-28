// Leaf 1.4.10 G2 (W-13, KG-3; ADR-1): a `dish` sync creates the catalogue nodes its edges need
// when they are missing, so it never depends on a catalogue sync having committed first.
// - On an empty graph, a dish sync alone succeeds; with the nightly recompute, the graph equals
//   the rebuild's.
// - With the catalogue present, the dish sync does not sync it again.
// - A node the catalogue itself lacks still fails the edge write (the guard hides no real error).
// - SPEC-Q-6: a household dish using the household's new private ingredient, synced before the
//   household catalogue (the order `syncRequests` queues them in), succeeds.
// - Two catalogue syncs and a dish sync started together, each in its own transaction, finish
//   with no deadlock, and the graph equals the rebuild's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuildGraph, recomputeLibrary, syncGraph } from "../src/sync/sync.js";
import type { KgSource } from "../src/sync/source.js";
import type { GraphSnapshot } from "../src/types/index.js";
import { createTestDatabase, dropAll, type TestDatabase } from "./support/db.js";
import { compareSnapshots, graphOn } from "./support/graph.js";
import {
  insertDish,
  insertHousehold,
  insertPrivateIngredient,
  loadCatalogue,
  seedDish,
  seedDishes,
  variantOf,
  type Catalogue,
} from "./support/relational.js";

const databases: TestDatabase[] = [];
afterAll(async () => {
  await dropAll(databases);
});

/** A database with the catalogue and `n` seed dishes in the relational tables, and no graph. */
async function world(n: number): Promise<{ db: TestDatabase; cat: Catalogue; dishIds: string[] }> {
  const db = await createTestDatabase();
  databases.push(db);
  const cat = await loadCatalogue(db.pool);
  const dishIds: string[] = [];
  for (const dish of seedDishes().slice(0, n))
    dishIds.push((await insertDish(db.pool, cat, dish, null)).dishId);
  return { db, cat, dishIds };
}

/** The source with its `catalogue()` calls counted, and optionally one ingredient left out. */
function counted(source: KgSource, omitIngredientId?: string) {
  const calls = { catalogue: 0 };
  const catalogue: KgSource["catalogue"] = async () => {
    calls.catalogue += 1;
    const input = await source.catalogue();
    return omitIngredientId === undefined
      ? input
      : { ...input, ingredients: input.ingredients.filter((i) => i.id !== omitIngredientId) };
  };
  const wrapped = new Proxy(source, {
    get: (target, prop) => {
      if (prop === "catalogue") return catalogue;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { source: wrapped, calls };
}

async function rebuilt(db: TestDatabase): Promise<GraphSnapshot> {
  const { store, source } = graphOn(db.pool);
  return rebuildGraph(store, source);
}

const count = async (db: TestDatabase, sql: string) =>
  Number(((await db.pool.query(sql)).rows[0] as { n: string }).n);

describe("W-13: a dish sync with the catalogue missing", () => {
  let w: Awaited<ReturnType<typeof world>>;
  beforeAll(async () => {
    w = await world(6);
  }, 120_000);

  it("creates the global catalogue first; with the nightly recompute the graph equals the rebuild's", async () => {
    expect(await count(w.db, "SELECT count(*) AS n FROM kg_node")).toBe(0);
    const { store, source } = graphOn(w.db.pool);
    const spy = counted(source);
    await syncGraph(store, spy.source, { kind: "dish", householdId: null, dishIds: w.dishIds });
    expect(spy.calls.catalogue).toBe(1);
    await recomputeLibrary(store, source);
    const synced = await store.snapshot();
    const diff = compareSnapshots(synced, await rebuilt(w.db));
    expect({ onlyLeft: diff.onlyLeft.slice(0, 5), onlyRight: diff.onlyRight.slice(0, 5) }).toEqual({
      onlyLeft: [],
      onlyRight: [],
    });
    expect(diff.equal).toBe(true);
  });

  it("with the catalogue present, the dish sync does not sync it again", async () => {
    const { store, source } = graphOn(w.db.pool);
    const spy = counted(source);
    await syncGraph(store, spy.source, { kind: "dish", householdId: null, dishIds: w.dishIds });
    expect(spy.calls.catalogue).toBe(0);
  });
});

describe("W-13: the guard hides no real error", () => {
  it("a dish naming an ingredient the catalogue does not have still fails the edge write", async () => {
    const w = await world(1);
    const dish = seedDish(seedDishes()[0]?.slug ?? "");
    const slug = dish.components[0]?.variants[0]?.ingredients[0]?.ingredient_slug ?? "";
    const missing = w.cat.ingredientId.get(slug);
    if (missing === undefined) throw new Error(`no id for ${slug}`);
    const { store, source } = graphOn(w.db.pool);
    const spy = counted(source, missing);
    await expect(
      syncGraph(store, spy.source, { kind: "dish", householdId: null, dishIds: w.dishIds }),
    ).rejects.toThrow(/name a node that does not exist: .*Ingredient:/);
    // The failed sync wrote nothing (one transaction).
    expect(await count(w.db, "SELECT count(*) AS n FROM kg_node")).toBe(0);
  }, 120_000);
});

describe("SPEC-Q-6: a household dish using the household's new private ingredient", () => {
  it("synced before the household catalogue (syncRequests' order), it succeeds", async () => {
    const w = await world(0);
    const { store, source } = graphOn(w.db.pool);
    await syncGraph(store, source, { kind: "catalogue" });
    const hh = await insertHousehold(w.db.pool, "Household with a spice mix");
    const spiceId = await insertPrivateIngredient(
      w.db.pool,
      w.cat,
      hh,
      "cumin",
      "hh-house-spice",
      "House spice mix",
    );
    const own = await insertDish(
      w.db.pool,
      w.cat,
      variantOf(seedDish("chicken-biryani"), "hh-biryani", "Our biryani", [
        "cumin",
        "hh-house-spice",
      ]),
      hh,
    );
    const spy = counted(source);
    // The change set's requests, in the order the worker runs them.
    await syncGraph(store, spy.source, { kind: "dish", householdId: hh, dishIds: [own.dishId] });
    await syncGraph(store, spy.source, { kind: "catalogue", householdId: hh });
    expect(spy.calls.catalogue).toBe(0); // the global catalogue was already there
    const node = await w.db.pool.query(
      "SELECT 1 FROM kg_node WHERE household_id = $1 AND type = 'Ingredient' AND key = $2",
      [hh, spiceId],
    );
    expect(node.rowCount).toBe(1);
    const edge = await w.db.pool.query(
      `SELECT 1 FROM kg_edge e JOIN kg_node d ON d.id = e.dst_id
       WHERE e.type = 'CONTAINS' AND d.household_id = $1 AND d.key = $2`,
      [hh, spiceId],
    );
    expect(edge.rowCount).toBeGreaterThan(0);
    await recomputeLibrary(store, source);
    expect(compareSnapshots(await store.snapshot(), await rebuilt(w.db)).equal).toBe(true);
  }, 120_000);
});

describe("W-13 (ADR-1 amendment): concurrent syncs of the same catalogue nodes", () => {
  it("two catalogue syncs and a dish sync started together: no deadlock, graph equals the rebuild's", async () => {
    const w = await world(12);
    for (let round = 0; round < 5; round += 1) {
      await w.db.pool.query("DELETE FROM kg_edge");
      await w.db.pool.query("DELETE FROM kg_node");
      const errors: unknown[] = [];
      // Each call opens its own transaction on its own pooled connection.
      await Promise.all(
        [
          { kind: "catalogue" as const },
          { kind: "dish" as const, householdId: null, dishIds: w.dishIds },
          { kind: "catalogue" as const },
        ].map((request) => {
          const { store, source } = graphOn(w.db.pool);
          return syncGraph(store, source, request).catch((e: unknown) => {
            errors.push(e);
          });
        }),
      );
      expect(errors.map((e) => String(e))).toEqual([]);
      const { store, source } = graphOn(w.db.pool);
      await recomputeLibrary(store, source);
      expect(compareSnapshots(await store.snapshot(), await rebuilt(w.db)).equal).toBe(true);
    }
  }, 300_000);
});
