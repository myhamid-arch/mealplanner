// G3 (KG-2): no household-scoped node or edge is visible to another household, through any read of
// the GraphStore or the PostgresKgSource (R-35).
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandPalette } from "../src/palette/index.js";
import type { PostgresGraphStore } from "../src/store/postgres.js";
import type { PostgresKgSource } from "../src/sync/postgres-source.js";
import { rebuildGraph } from "../src/sync/sync.js";
import { KG_EDGE_TYPES, type KgEdgeType, type KgNeighbour } from "../src/types/index.js";
import { createTestDatabase, dropAll, type TestDatabase } from "./support/db.js";
import { graphOn } from "./support/graph.js";
import {
  insertDish,
  insertExclusion,
  insertHousehold,
  insertMember,
  insertPreference,
  insertPrivateIngredient,
  loadCatalogue,
  seedDish,
  seedDishes,
  variantOf,
  type Catalogue,
} from "./support/relational.js";

let db: TestDatabase;
let cat: Catalogue;
let store: PostgresGraphStore;
let source: PostgresKgSource;
const hh: Record<"h1" | "h2", string> = { h1: "", h2: "" };
const seedIds: string[] = [];

const measure = (record: Record<string, unknown>) => {
  const file = process.env.KG_MEASURE_FILE;
  if (file !== undefined && file !== "") appendFileSync(file, `${JSON.stringify(record)}\n`);
};

/** One household's own data: a private ingredient, two dishes using it, members, preferences, exclusions. */
async function populate(name: "h1" | "h2", dishes: [string, string]) {
  const id = await insertHousehold(db.pool, name);
  hh[name] = id;
  const spice = await insertPrivateIngredient(
    db.pool,
    cat,
    id,
    "cumin",
    `${name}-spice`,
    `${name} spice`,
  );
  const own: string[] = [];
  for (const slug of dishes)
    own.push(
      (
        await insertDish(
          db.pool,
          cat,
          variantOf(seedDish(slug), `${name}-${slug}`, `${name} ${slug}`, [
            "cumin",
            `${name}-spice`,
          ]),
          id,
          { source: "admin" },
        )
      ).dishId,
    );
  const a = await insertMember(db.pool, id, `${name} adult`, true);
  const b = await insertMember(db.pool, id, `${name} child`, false);
  await insertPreference(db.pool, id, {
    memberId: a,
    entityType: "dish",
    entityKey: own[0] as string,
    score: 0.8,
  });
  await insertPreference(db.pool, id, {
    memberId: a,
    entityType: "dish",
    entityKey: seedIds[0] as string,
    score: -0.6,
  });
  await insertPreference(db.pool, id, {
    memberId: b,
    entityType: "ingredient",
    entityKey: spice,
    score: 0.5,
  });
  await insertPreference(db.pool, id, {
    memberId: b,
    entityType: "flavour_tag",
    entityKey: `${name}-only-tag`,
    score: 0.4,
  });
  await insertExclusion(db.pool, id, {
    memberId: b,
    kind: "ingredient",
    key: "tahini",
    reason: "allergy",
    hard: true,
  });
  return { spice, own };
}

beforeAll(async () => {
  db = await createTestDatabase();
  cat = await loadCatalogue(db.pool);
  for (const dish of seedDishes())
    seedIds.push((await insertDish(db.pool, cat, dish, null)).dishId);
  const one = await populate("h1", ["chicken-biryani", "chicken-tikka-masala"]);
  const two = await populate("h2", ["chicken-karahi-chapati", "aloo-keema-rice"]);
  ({ store, source } = graphOn(db.pool));
  await rebuildGraph(store, source);
  // A household-scoped AI substitute for each household (08 §2 SUBSTITUTES_FOR `source: ai`).
  const chicken = cat.ingredientId.get("chicken-breast") as string;
  for (const [name, spice] of [
    ["h1", one.spice],
    ["h2", two.spice],
  ] as const)
    await store.upsertEdges([
      {
        householdId: hh[name],
        type: "SUBSTITUTES_FOR",
        src: { householdId: null, type: "Ingredient", key: chicken },
        dst: { householdId: hh[name], type: "Ingredient", key: spice },
        weight: 0.99,
        props: {
          macroDelta: {
            kcal: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            satFat: 0,
            fibre: 0,
            solubleFibre: null,
            sugar: null,
            sodiumMg: null,
          },
        },
        source: "ai",
      },
    ]);
}, 300_000);

afterAll(async () => {
  await dropAll([db]);
});

interface Owned {
  nodeIds: Set<string>;
  nodeKeys: Set<string>;
  /** Nodes that touch an edge of the owner household (where a leak would appear). */
  frontier: Array<{ id: string; type: string; key: string }>;
  edgeTypes: Record<string, number>;
}

async function ownedBy(owner: string): Promise<Owned> {
  const nodes = (
    await db.pool.query(`SELECT id, key FROM kg_node WHERE household_id = $1`, [owner])
  ).rows as Array<{ id: string; key: string }>;
  const edges = (
    await db.pool.query(
      `SELECT type, count(*)::int AS n FROM kg_edge WHERE household_id = $1 GROUP BY type`,
      [owner],
    )
  ).rows as Array<{ type: string; n: number }>;
  const frontier = (
    await db.pool.query(
      `SELECT DISTINCT n.id, n.type, n.key FROM kg_node n
       WHERE n.household_id = $1
          OR EXISTS (SELECT 1 FROM kg_edge e WHERE e.household_id = $1 AND (e.src_id = n.id OR e.dst_id = n.id))`,
      [owner],
    )
  ).rows as Array<{ id: string; type: string; key: string }>;
  return {
    nodeIds: new Set(nodes.map((n) => n.id)),
    nodeKeys: new Set(nodes.map((n) => n.key)),
    frontier,
    edgeTypes: Object.fromEntries(edges.map((e) => [e.type, e.n])),
  };
}

/** Leak detector for neighbour-shaped results. */
function leaks(result: readonly KgNeighbour[], owner: string, owned: Owned): string[] {
  return result
    .filter(
      (n) => n.householdId === owner || n.edgeHouseholdId === owner || owned.nodeIds.has(n.nodeId),
    )
    .map((n) => `${n.type}:${n.key}`);
}

/** Every GraphStore read `viewer` can make near `owner`'s data; returns leaks and the read count. */
async function sweep(viewer: string | undefined, owner: string, owned: Owned) {
  const found: string[] = [];
  let reads = 0;
  let returned = 0;
  for (const node of owned.frontier)
    for (const type of KG_EDGE_TYPES) {
      const opts = viewer === undefined ? {} : { householdId: viewer };
      for (const result of [
        await store.neighbours(node.id, type, opts),
        await store.incoming(node.id, type, opts),
      ]) {
        reads += 1;
        returned += result.length;
        found.push(...leaks(result, owner, owned).map((l) => `${type} ${node.key} → ${l}`));
      }
    }
  if (viewer !== undefined) {
    const dishes = [
      ...seedIds,
      ...(await source.dishIds(owner)),
      ...(await source.dishIds(viewer)),
    ];
    for (const dishId of dishes) {
      reads += 1;
      const result = await store.similarDishes(dishId, viewer, 100);
      returned += result.length;
      found.push(
        ...result
          .filter((r) => owned.nodeKeys.has(r.dishId))
          .map((r) => `similarDishes ${dishId} → ${r.dishId}`),
      );
      if (owned.nodeKeys.has(dishId) && result.length > 0)
        found.push(`similarDishes from ${dishId} answered`);
    }
    const ingredients = [...cat.ingredientId.values()];
    for (const ingredientId of ingredients) {
      reads += 1;
      const result = await store.substitutes(ingredientId, viewer, 100);
      returned += result.length;
      found.push(
        ...result
          .filter((r) => owned.nodeKeys.has(r.ingredientId))
          .map((r) => `substitutes ${ingredientId} → ${r.ingredientId}`),
      );
    }
    reads += 1;
    const palette = await expandPalette(store, {
      householdId: viewer,
      ingredientIds: ingredients,
      cuisineKeys: ["indian", "pakistani"],
      limit: 1000,
    });
    returned += palette.length;
    found.push(
      ...palette
        .filter((p) => owned.nodeKeys.has(p.ingredientId))
        .map((p) => `palette → ${p.ingredientId}`),
    );
  }
  const frontierNodes = (
    await db.pool.query(`SELECT type, key FROM kg_node WHERE household_id = $1`, [owner])
  ).rows as Array<{ type: "Dish"; key: string }>;
  for (const n of frontierNodes) {
    reads += 1;
    const node = await store.findNode(n.type, n.key, viewer);
    if (node !== null && node.householdId === owner) found.push(`findNode ${n.type}:${n.key}`);
  }
  return { leaks: found, reads, returned };
}

describe("G3 household isolation (KG-2)", () => {
  it("G3 no household-scoped node or edge of one household is visible to the other through any GraphStore read", async () => {
    const expectedTypes: KgEdgeType[] = [
      "CONTAINS",
      "PREPARED_BY",
      "PART_OF",
      "OF_CUISINE",
      "HAS_FLAVOUR",
      "SUITS_SLOT",
      "IN_CATEGORY",
      "PAIRS_WITH",
      "TYPICAL_IN",
      "LIKES",
      "DISLIKES",
      "SUBSTITUTES_FOR",
    ];
    for (const [viewerName, ownerName] of [
      ["h2", "h1"],
      ["h1", "h2"],
    ] as const) {
      const owner = hh[ownerName];
      const owned = await ownedBy(owner);
      // Not vacuous: the owner has household-scoped edges of every household-derivable type.
      for (const type of expectedTypes)
        expect(owned.edgeTypes[type] ?? 0, `${ownerName} ${type}`).toBeGreaterThan(0);

      // Positive control: the owner itself does see its own scoped data through the same reads.
      const self = await sweep(owner, owner, owned);
      expect(self.leaks.length).toBeGreaterThan(0);

      for (const viewer of [hh[viewerName], undefined]) {
        const result = await sweep(viewer, owner, owned);
        expect(result.leaks, `viewer ${viewer ?? "none (global)"}`).toEqual([]);
        expect(result.reads).toBeGreaterThan(owned.frontier.length);
        measure({
          gate: "G3",
          check: "store",
          viewer: viewer === undefined ? "global" : viewerName,
          owner: ownerName,
          reads: result.reads,
          returned: result.returned,
          leaks: result.leaks.length,
          ownerSees: self.leaks.length,
        });
      }
    }
  }, 300_000);

  it("G3 PostgresKgSource household-scoped reads never return another household's rows (R-35)", async () => {
    for (const [viewerName, ownerName] of [
      ["h2", "h1"],
      ["h1", "h2"],
    ] as const) {
      const viewer = hh[viewerName];
      const owner = hh[ownerName];
      const ownerDishIds = await source.dishIds(owner);
      expect(ownerDishIds.length).toBe(2);
      const allDishIds = [...seedIds, ...ownerDishIds, ...(await source.dishIds(viewer))];
      const rows = {
        members: await source.members(viewer),
        membersById: await source.members(
          viewer,
          (await source.members(owner)).map((m) => m.id),
        ),
        preferences: await source.preferences(viewer),
        preferencesById: await source.preferences(
          viewer,
          (await source.members(owner)).map((m) => m.id),
        ),
        exclusions: await source.exclusions(viewer),
        ingredients: await source.householdIngredients(viewer),
        dishIds: (await source.dishIds(viewer)).map((id) => ({ id })),
        dishes: (await source.dishes(viewer, allDishIds)).map((b) => b.dish),
        globalDishes: (await source.dishes(null, ownerDishIds)).map((b) => b.dish),
        library: await source.library(viewer),
      };
      const found: string[] = [];
      for (const [what, list] of Object.entries(rows))
        for (const row of list as Array<Record<string, unknown>>)
          if (
            row.householdId === owner ||
            row.createdByHouseholdId === owner ||
            ownerDishIds.includes(String(row.id ?? row.dishId))
          )
            found.push(`${what}: ${JSON.stringify(row).slice(0, 80)}`);
      expect(found).toEqual([]);
      // Positive control: the viewer's own rows are there.
      expect(rows.members.length).toBe(2);
      expect(rows.preferences.length).toBe(4);
      expect(rows.exclusions.length).toBe(1);
      expect(rows.ingredients.length).toBe(1);
      expect(rows.dishes.length).toBe(2);
      expect(rows.library.filter((d) => d.householdId === viewer).length).toBe(2);
      expect(rows.membersById).toEqual([]);
      expect(rows.globalDishes).toEqual([]);
      measure({
        gate: "G3",
        check: "source",
        viewer: viewerName,
        rows: Object.values(rows).reduce((n, l) => n + l.length, 0),
        leaks: found.length,
      });
    }
  });

  it("G3 negative control: the leak detectors flag unfiltered reads", async () => {
    const owner = hh.h1;
    const owned = await ownedBy(owner);
    // Unfiltered neighbours: every edge of the owner, read without the KG-2 predicate.
    const raw = (
      await db.pool.query(
        `SELECT n.id, n.household_id, n.type, n.key, n.label, n.props, e.weight, e.household_id AS edge_household_id, e.props AS edge_props, e.source
         FROM kg_edge e JOIN kg_node n ON n.id = e.dst_id WHERE e.household_id = $1`,
        [owner],
      )
    ).rows as Array<Record<string, unknown>>;
    const unfiltered: KgNeighbour[] = raw.map((r) => ({
      nodeId: r.id as string,
      householdId: r.household_id as string | null,
      type: r.type as KgNeighbour["type"],
      key: r.key as string,
      label: r.label as string,
      props: {},
      weight: Number(r.weight),
      edgeHouseholdId: r.edge_household_id as string | null,
      edgeProps: {},
      source: "derived",
    }));
    expect(unfiltered.length).toBeGreaterThan(0);
    expect(leaks(unfiltered, owner, owned).length).toBe(unfiltered.length);
    // Unfiltered source read: every member row.
    const members = (await db.pool.query(`SELECT household_id AS "householdId" FROM member`))
      .rows as Array<{ householdId: string }>;
    expect(members.filter((m) => m.householdId === owner).length).toBeGreaterThan(0);
    measure({ gate: "G3", check: "negative", flaggedEdges: unfiltered.length });
  });
});
