// G1 (KG-3): a full rebuild equals the incremental sync (SPEC-Q-12, R-35).
// One relational state is built step by step in database INC, with one `kg.sync` request per write
// (creates, edits, deletes) and the nightly recompute. INC is then copied byte for byte (TEMPLATE) to
// REB, whose graph is rebuilt from scratch. The canonical snapshots (natural keys, labels, props,
// weights, sources; no ids or timestamps) must be equal.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuildGraph, recomputeLibrary, syncGraph, type KgSyncRequest } from "../src/sync/sync.js";
import type { GraphSnapshot } from "../src/types/index.js";
import { KG_EDGE_TYPES, KG_NODE_TYPES } from "../src/types/index.js";
import {
  cloneDatabase,
  createTestDatabase,
  dropAll,
  reopen,
  type TestDatabase,
} from "./support/db.js";
import { compareSnapshots, countsByType, graphOn } from "./support/graph.js";
import {
  deleteComponent,
  deleteDish,
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
  type InsertedDish,
} from "./support/relational.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const databases: TestDatabase[] = [];
let inc: TestDatabase;

afterAll(async () => {
  await dropAll(databases);
});

/** One sync request against INC, as the worker would run it after a write. */
async function sync(request: KgSyncRequest) {
  const { store, source } = graphOn(inc.pool);
  await syncGraph(store, source, request);
}

async function nightly() {
  const { store, source } = graphOn(inc.pool);
  await recomputeLibrary(store, source);
}

async function snapshotOf(db: TestDatabase): Promise<GraphSnapshot> {
  return graphOn(db.pool).store.snapshot();
}

/** Copies INC's current state to a new database and rebuilds that copy's graph from scratch. */
async function rebuiltCopy(): Promise<{
  snapshot: GraphSnapshot;
  idsBefore: Set<string>;
  idsAfter: Set<string>;
}> {
  const copy = await cloneDatabase(inc);
  databases.push(copy);
  inc = reopen(inc);
  databases.push(inc);
  const ids = async () =>
    new Set(
      ((await copy.pool.query("SELECT id FROM kg_node")).rows as Array<{ id: string }>).map(
        (r) => r.id,
      ),
    );
  const idsBefore = await ids();
  const { store, source } = graphOn(copy.pool);
  const snapshot = await rebuildGraph(store, source);
  const idsAfter = await ids();
  await copy.close();
  return { snapshot, idsBefore, idsAfter };
}

const measure = (record: Record<string, unknown>) => {
  const file = process.env.KG_MEASURE_FILE;
  if (file !== undefined && file !== "") appendFileSync(file, `${JSON.stringify(record)}\n`);
};

describe("G1 rebuild = incremental sync (KG-3)", () => {
  const seed = new Map<string, InsertedDish>();
  const ids: Record<string, string> = {};
  let incremental: GraphSnapshot;

  beforeAll(async () => {
    inc = await createTestDatabase();
    databases.push(inc);
    const db = inc.pool;

    // Catalogue, then the seed library one dish at a time.
    const cat = await loadCatalogue(db);
    await sync({ kind: "catalogue" });
    for (const dish of seedDishes()) {
      const inserted = await insertDish(db, cat, dish, null);
      seed.set(dish.slug, inserted);
      await sync({ kind: "dish", householdId: null, dishIds: [inserted.dishId] });
    }

    // Two households with members.
    const h1 = await insertHousehold(db, "Household one");
    const h2 = await insertHousehold(db, "Household two");
    Object.assign(ids, { h1, h2 });
    for (const [key, name, targeted] of [
      ["a", "Adult A", true],
      ["b", "Adult B", true],
      ["c1", "C1", false],
      ["c2", "C2", false],
      ["c3", "C3", false],
    ] as const) {
      ids[key] = await insertMember(db, h1, name, targeted);
    }
    ids.x = await insertMember(db, h2, "Adult X", true);
    ids.y = await insertMember(db, h2, "Adult Y", false);
    await sync({
      kind: "member",
      householdId: h1,
      memberIds: [ids.a, ids.b, ids.c1, ids.c2, ids.c3] as string[],
    });
    await sync({ kind: "member", householdId: h2, memberIds: [ids.x, ids.y] as string[] });

    // H1's private ingredient and two own dishes using it; one H2 dish.
    ids.spice = await insertPrivateIngredient(
      db,
      cat,
      h1,
      "cumin",
      "h1-house-spice",
      "House spice mix",
    );
    await sync({ kind: "catalogue", householdId: h1 });
    const h1a = await insertDish(
      db,
      cat,
      variantOf(seedDish("chicken-biryani"), "h1-biryani", "Our biryani", [
        "cumin",
        "h1-house-spice",
      ]),
      h1,
    );
    const h1b = await insertDish(
      db,
      cat,
      variantOf(seedDish("chicken-tikka-masala"), "h1-tikka", "Our tikka", [
        "cumin",
        "h1-house-spice",
      ]),
      h1,
    );
    const h2a = await insertDish(
      db,
      cat,
      variantOf(seedDish("shakshuka"), "h2-shakshuka", "Our shakshuka"),
      h2,
    );
    ids.h1a = h1a.dishId;
    ids.h1b = h1b.dishId;
    ids.h2a = h2a.dishId;
    await sync({ kind: "dish", householdId: h1, dishIds: [h1a.dishId, h1b.dishId] });
    await sync({ kind: "dish", householdId: h2, dishIds: [h2a.dishId] });

    // Preferences of every entity type, with precedence conflicts and rows that are not mirrored.
    const biryani = seed.get("chicken-biryani") as InsertedDish;
    const chickenThigh = cat.ingredientId.get("chicken-thigh") as string;
    const a = ids.a as string;
    const b = ids.b as string;
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "dish",
      entityKey: biryani.dishId,
      score: 0.7,
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "dish",
      entityKey: biryani.dishId,
      score: -0.2,
      source: "learned",
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "dish",
      entityKey: `${biryani.dishId}#${biryani.variants.get("chicken/dum") as string}`,
      score: 0.4,
      source: "learned",
    });
    ids.prefIngredient = await insertPreference(db, h1, {
      memberId: a,
      entityType: "ingredient",
      entityKey: chickenThigh,
      score: 0.5,
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "ingredient",
      entityKey: ids.spice,
      score: 0.6,
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "cuisine",
      entityKey: "levantine",
      score: 0.8,
      locked: true,
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "method",
      entityKey: "grilled",
      score: 0.3,
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "flavour_tag",
      entityKey: "smoky",
      score: 0.2,
    });
    ids.prefTag = await insertPreference(db, h1, {
      memberId: a,
      entityType: "flavour_tag",
      entityKey: "umami-rich",
      score: 0.9,
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "component_role",
      entityKey: "vegetable",
      score: 0.5,
    });
    await insertPreference(db, h1, {
      memberId: a,
      entityType: "dish",
      entityKey: ids.h1a,
      score: 1,
    });
    await insertPreference(db, h1, {
      memberId: null,
      entityType: "cuisine",
      entityKey: "italian",
      score: 0.5,
    });
    ids.prefB = await insertPreference(db, h1, {
      memberId: b,
      entityType: "dish",
      entityKey: (seed.get("fish-and-chips") as InsertedDish).dishId,
      score: -0.9,
    });
    await insertPreference(db, h2, {
      memberId: ids.x,
      entityType: "dish",
      entityKey: ids.h2a,
      score: 0.6,
    });
    await sync({ kind: "preferences", householdId: h1, memberIds: [a, b] });
    await sync({ kind: "preferences", householdId: h2, memberIds: [ids.x] });
    await insertExclusion(db, h1, {
      memberId: ids.c3 as string,
      kind: "dietary_flag",
      key: "contains_sesame",
      reason: "allergy",
      hard: true,
    });
    await nightly();

    // Edits, each followed by its sync request.
    // (a) a seed variant loses an ingredient
    await db.query(`DELETE FROM variant_ingredient WHERE variant_id = $1 AND ingredient_id = $2`, [
      biryani.variants.get("salad/lemon"),
      cat.ingredientId.get("parsley"),
    ]);
    await sync({ kind: "dish", householdId: null, dishIds: [biryani.dishId] });
    // (b) an amount changes in an H1 dish
    await db.query(
      `UPDATE variant_ingredient SET raw_g_per_batch = raw_g_per_batch * 2 WHERE variant_id = $1 AND ingredient_id = $2`,
      [h1a.variants.get("chicken/dum"), chickenThigh],
    );
    await sync({ kind: "dish", householdId: h1, dishIds: [h1a.dishId] });
    // (c) a component is removed from H1's second dish
    await deleteComponent(db, [...h1b.components.values()].at(-1) as string);
    await sync({ kind: "dish", householdId: h1, dishIds: [h1b.dishId] });
    // (d) a seed dish is retired
    const retired = seed.get("chicken-cacciatore") as InsertedDish;
    await db.query(`UPDATE dish SET status = 'retired' WHERE id = $1`, [retired.dishId]);
    await sync({ kind: "dish", householdId: null, dishIds: [retired.dishId] });
    // (e) H2's dish is deleted (its preference row stays; the graph has nothing to point at)
    await deleteDish(db, h2a.dishId);
    await sync({ kind: "dish", householdId: h2, dishIds: [h2a.dishId] });
    // (f) a draft dish is created
    const draft = await insertDish(
      db,
      cat,
      variantOf(seedDish("tuna-pasta-salad"), "h1-draft", "Draft salad"),
      h1,
      { status: "draft" },
    );
    await sync({ kind: "dish", householdId: h1, dishIds: [draft.dishId] });
    // (g) a dish's only-once flavour tag is replaced by a new one
    const teriyaki = seed.get("chicken-teriyaki-bowl") as InsertedDish;
    await db.query(
      `UPDATE dish SET flavour_tags = array_replace(flavour_tags, 'glazed', 'sticky') WHERE id = $1`,
      [teriyaki.dishId],
    );
    await sync({ kind: "dish", householdId: null, dishIds: [teriyaki.dishId] });
    // (h) a like flips to a dislike; (i) a preference is deleted; (m) the only reference to a tag goes
    await db.query(`UPDATE preference SET score = -0.5 WHERE id = $1`, [ids.prefIngredient]);
    await db.query(`DELETE FROM preference WHERE id = ANY($1::uuid[])`, [[ids.prefB, ids.prefTag]]);
    await sync({ kind: "preferences", householdId: h1, memberIds: [a, b] });
    // (j) a member is archived; (k) a member is deleted
    await db.query(`UPDATE member SET archived_at = now() WHERE id = $1`, [ids.c1]);
    await db.query(`DELETE FROM member WHERE id = $1`, [ids.c2]);
    await sync({
      kind: "member",
      householdId: h1,
      memberIds: [ids.c1 as string, ids.c2 as string],
    });
    await sync({ kind: "preferences", householdId: h1, memberIds: [ids.c2 as string] });
    // (l) catalogue nutrients change (substitute macro deltas follow)
    await db.query(
      `UPDATE ingredient SET protein_g = protein_g + 1.5, kcal = kcal + 6 WHERE slug = 'chicken-breast'`,
    );
    await sync({ kind: "catalogue" });
    await nightly();

    incremental = await snapshotOf(inc);
  }, 300_000);

  it("G1 every sync request is idempotent: re-running all of them changes nothing", async () => {
    const nodeIds = async () =>
      (
        (await inc.pool.query("SELECT id FROM kg_node ORDER BY id")).rows as Array<{ id: string }>
      ).map((r) => r.id);
    const before = await nodeIds();
    const { source } = graphOn(inc.pool);
    await sync({ kind: "catalogue" });
    for (const hh of await source.households()) {
      await sync({ kind: "catalogue", householdId: hh });
      const members = (await source.members(hh)).map((m) => m.id);
      await sync({ kind: "member", householdId: hh, memberIds: members });
      await sync({ kind: "preferences", householdId: hh, memberIds: members });
      await sync({ kind: "dish", householdId: hh, dishIds: await source.dishIds(hh) });
    }
    await sync({ kind: "dish", householdId: null, dishIds: await source.dishIds(null) });
    await nightly();
    const again = await snapshotOf(inc);
    const diff = compareSnapshots(incremental, again);
    expect(diff.onlyLeft).toEqual([]);
    expect(diff.onlyRight).toEqual([]);
    expect(diff.equal).toBe(true);
    expect(await nodeIds()).toEqual(before);
    measure({ gate: "G1", check: "idempotent", equal: diff.equal, nodeIdsKept: true });
  }, 120_000);

  it("G1 rebuild equals the incremental sync after creates, edits, deletes and the nightly recompute", async () => {
    const { snapshot, idsBefore, idsAfter } = await rebuiltCopy();
    // The copy started with INC's graph; the rebuild must have replaced every node.
    expect(idsBefore.size).toBe(incremental.nodes.length);
    expect([...idsAfter].filter((id) => idsBefore.has(id))).toEqual([]);
    const diff = compareSnapshots(incremental, snapshot);
    expect(diff.onlyLeft).toEqual([]);
    expect(diff.onlyRight).toEqual([]);
    expect(diff.equal).toBe(true);

    const counts = countsByType(snapshot);
    for (const type of KG_NODE_TYPES)
      expect(counts.nodes[type] ?? 0, `nodes ${type}`).toBeGreaterThan(0);
    for (const type of KG_EDGE_TYPES)
      expect(counts.edges[type] ?? 0, `edges ${type}`).toBeGreaterThan(0);
    // The edits are visible in the rebuilt graph.
    expect(snapshot.nodes.some((n) => n.includes("|FlavourTag|glazed|"))).toBe(false);
    expect(snapshot.nodes.some((n) => n.includes("|FlavourTag|sticky|"))).toBe(true);
    expect(snapshot.nodes.some((n) => n.includes("|FlavourTag|umami-rich|"))).toBe(false);
    expect(snapshot.nodes.some((n) => n.includes(`|Dish|${ids.h2a as string}|`))).toBe(false);
    expect(snapshot.nodes.some((n) => n.includes(`|Member|${ids.c2 as string}|`))).toBe(false);
    expect(
      snapshot.nodes.some(
        (n) => n.includes(`|Member|${ids.c1 as string}|`) && n.includes('"archived":true'),
      ),
    ).toBe(true);
    expect(snapshot.edges.some((e) => e.startsWith(`${ids.h1 as string}|PAIRS_WITH|`))).toBe(true);
    measure({
      gate: "G1",
      check: "rebuild",
      equal: diff.equal,
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
      nodeTypes: counts.nodes,
      edgeTypes: counts.edges,
      replacedAllNodeIds: [...idsAfter].every((id) => !idsBefore.has(id)),
    });
  }, 120_000);

  it("G1 negative control: an incremental graph that skipped one sync differs from the rebuild", async () => {
    const shakshuka = seed.get("shakshuka") as InsertedDish;
    await inc.pool.query(
      `UPDATE variant_ingredient SET raw_g_per_batch = raw_g_per_batch + 100
       WHERE id = (SELECT vi.id FROM variant_ingredient vi JOIN variant v ON v.id = vi.variant_id
                   JOIN component c ON c.id = v.component_id WHERE c.dish_id = $1 ORDER BY vi.id LIMIT 1)`,
      [shakshuka.dishId],
    );
    const skipped = await snapshotOf(inc);
    const rebuilt = await rebuiltCopy();
    const diff = compareSnapshots(skipped, rebuilt.snapshot);
    expect(diff.equal).toBe(false);
    expect([...diff.onlyLeft, ...diff.onlyRight].some((line) => line.includes("|CONTAINS|"))).toBe(
      true,
    );
    // Running the skipped request (and the nightly job it feeds) restores equality.
    await sync({ kind: "dish", householdId: null, dishIds: [shakshuka.dishId] });
    await nightly();
    expect(compareSnapshots(await snapshotOf(inc), rebuilt.snapshot).equal).toBe(true);
    measure({
      gate: "G1",
      check: "negative-skipped-sync",
      equal: diff.equal,
      differing: diff.onlyLeft.length + diff.onlyRight.length,
    });
  }, 120_000);

  it("G1 scripts/kg-rebuild.ts rebuilds a copy of the database to the incremental graph", async () => {
    const expected = await snapshotOf(inc);
    const copy = await cloneDatabase(inc);
    databases.push(copy);
    inc = reopen(inc);
    databases.push(inc);
    const run = spawnSync(process.execPath, [join(ROOT, "scripts/kg-rebuild.ts")], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: copy.url },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(
      new RegExp(
        `kg:rebuild: ${String(expected.nodes.length)} nodes, ${String(expected.edges.length)} edges`,
      ),
    );
    const diff = compareSnapshots(expected, await snapshotOf(copy));
    expect(diff.onlyLeft).toEqual([]);
    expect(diff.onlyRight).toEqual([]);
    expect(diff.equal).toBe(true);
    measure({ gate: "G1", check: "kg-rebuild-script", equal: diff.equal });
  }, 120_000);

  it("G1 negative control: one perturbed edge weight makes the snapshots differ", async () => {
    const reference = await snapshotOf(inc);
    await inc.pool.query(
      `UPDATE kg_edge SET weight = weight + 0.001 WHERE id = (SELECT id FROM kg_edge WHERE type = 'PAIRS_WITH' ORDER BY id LIMIT 1)`,
    );
    const perturbed = await snapshotOf(inc);
    const diff = compareSnapshots(reference, perturbed);
    expect(diff.equal).toBe(false);
    expect(diff.onlyLeft).toHaveLength(1);
    expect(diff.onlyRight).toHaveLength(1);
    // The same comparison on an edited copy of a snapshot also fails.
    const edited = { ...reference, edges: reference.edges.slice(1) };
    expect(compareSnapshots(reference, edited).equal).toBe(false);
    measure({ gate: "G1", check: "negative-perturbed-weight", equal: diff.equal });
  }, 60_000);
});
