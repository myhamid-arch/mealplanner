// W-13 (leaf 1.4.10 G2, KG-3; ADR-1): the worker's start-up graph sync on an empty graph with the
// seed library. `startWorker` queues the global catalogue sync and the seed-library dish sync
// together (`syncCatalogueGraph`). Whatever the interleaving, no attempt may fail with "edge(s) name
// a node that does not exist". The resulting graph must equal `pnpm kg:rebuild`'s (1.4.10
// SPEC-Q-5): without the library edges right after start-up, and exactly once the nightly
// recompute has also run.
//
// Runs (each on a fresh database, the real worker runtime, and the real `kg.sync` handler):
//   natural     WORKER_CONCURRENCY 2, no interference
//   held        the catalogue job waits until the dish job's first attempt has ended
//   open-tx     the catalogue job writes its nodes and holds its transaction open (not committed)
//               while the dish job runs
//   three       two catalogue syncs and the dish sync start together (concurrency 3): no
//               `deadlock detected`, no retries (ADR-1 amendment)
// Negative control: `held` and `open-tx` with the pre-fix `syncDishes` (verbatim from f7b041a)
// fail. The natural pre-fix run is reported, not asserted: it failed 6/6 when reproduced
// (docs/decisions/leaf-1.4.10-w13.md), but a race is not a deterministic check.
// SPEC-Q-6: a household change set with a new private ingredient and a dish using it, synced by
// the real `kg.sync` handler through `syncRequests`, succeeds; with the pre-fix `syncDishes` it
// fails on every attempt.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { Json } from "@mealplanner/core/types";
import { ingredient, newId } from "@mealplanner/db/schema";
import { applyChangeSet } from "@mealplanner/db/services/changes";
import { createHousehold } from "@mealplanner/db/services/config";
import { copyPayload, dishTree } from "@mealplanner/db/services/plans";
import { DISH_EDGE_TYPES, deriveDish, isSyncedDish, ref } from "@mealplanner/graph/derive";
import {
  rebuildGraph,
  recomputeLibrary,
  syncGraph,
  type KgSource,
  type KgSyncRequest,
} from "@mealplanner/graph/sync";
import type { GraphSnapshot, GraphSyncStore } from "@mealplanner/graph/types";
import { HANDLERS } from "../../../worker/src/jobs/handlers";
import { startWorker } from "../../../worker/src/main";
import type { JobHandler } from "../../../worker/src/runner";
import { createWorkerRuntime, type WorkerRuntime } from "../../../worker/src/runtime";
import { createTestDatabase, type TestDatabase } from "./support/db";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const REAL_KG_SYNC = HANDLERS["kg.sync"] as JobHandler;
const LIBRARY_EDGES = new Set(["PAIRS_WITH", "TYPICAL_IN"]);
const opened: Array<{ db: TestDatabase; rt: WorkerRuntime }> = [];

afterAll(async () => {
  HANDLERS["kg.sync"] = REAL_KG_SYNC;
  active = REAL_KG_SYNC;
  for (const { rt, db } of opened) {
    await rt.close().catch(() => undefined);
    await db.drop();
  }
});

// ------------------------------------------------------------------------------------------------
// The pre-fix dish sync: `syncDishes` of packages/graph/src/sync/sync.ts at f7b041a, verbatim.
// ------------------------------------------------------------------------------------------------

const ON_DEMAND = ["FlavourTag", "SlotType"] as const;

async function preFixSyncDishes(
  tx: GraphSyncStore,
  source: KgSource,
  householdId: string | null,
  dishIds: readonly string[],
) {
  const bundles = new Map(
    (await source.dishes(householdId, dishIds)).map((b) => [b.dish.id, b] as const),
  );
  for (const dishId of new Set(dishIds)) {
    const dishRef = ref("Dish", dishId, householdId);
    const before = await tx.partsOf(dishRef);
    const bundle = bundles.get(dishId);
    if (!isSyncedDish(bundle)) {
      await tx.deleteNodes([...before, dishRef]);
      continue;
    }
    const derived = deriveDish(bundle);
    await tx.upsertNodes(derived.nodes);
    await tx.replaceEdges({ types: DISH_EDGE_TYPES, srcs: derived.owned }, derived.edges);
    const owned = new Set(derived.owned.map((r) => `${r.type}\u0000${r.key}`));
    await tx.deleteNodes(before.filter((n) => !owned.has(`${n.type}\u0000${n.key}`)));
  }
  await tx.deleteOrphans(ON_DEMAND);
}

type Sync = (store: GraphSyncStore, source: KgSource, request: KgSyncRequest) => Promise<void>;
const FIXED: Sync = syncGraph;
const PRE_FIX: Sync = async (store, source, request) => {
  if (request.kind !== "dish") return syncGraph(store, source, request);
  return store.transaction((tx) =>
    preFixSyncDishes(tx, source, request.householdId, request.dishIds),
  );
};

// ------------------------------------------------------------------------------------------------
// Harness
// ------------------------------------------------------------------------------------------------

type Event = { jobId: string; kind: string; type: string; payload: Json };
type Hook = (rt: WorkerRuntime, request: KgSyncRequest, run: () => Promise<void>) => Promise<void>;

/**
 * `startWorker` binds each queue to `HANDLERS[kind]` once, so the worker is given one dispatching
 * handler and the tests switch what it runs through `active`.
 */
let active: JobHandler = REAL_KG_SYNC;
const DISPATCH: JobHandler = (ctx) => active(ctx);

/** The `kg.sync` handler with `sync` in place of the graph package's, and an optional hook. */
function handlerWith(sync: Sync, hook?: Hook): JobHandler {
  return async (ctx) => {
    const p = ctx.job.payload as { changeSetId?: string; request?: KgSyncRequest };
    // A change set's requests (syncRequests) go to the real handler.
    if (p.request === undefined) return REAL_KG_SYNC(ctx);
    const request = p.request;
    const run = () => sync(ctx.rt.graph, ctx.rt.kgSource, request);
    if (hook === undefined) await run();
    else await hook(ctx.rt, request, run);
    return { requests: [request] as unknown as Json };
  };
}

async function world(concurrency: number): Promise<{ db: TestDatabase; rt: WorkerRuntime }> {
  const db = await createTestDatabase();
  const rt = await createWorkerRuntime({
    databaseUrl: db.url,
    dataDir: join(ROOT, "data"),
    aiRecipeDailyLimit: 0,
    concurrency,
  });
  opened.push({ db, rt });
  const empty = await rt.db.execute(sql`SELECT count(*)::int AS n FROM kg_node`);
  expect((empty.rows[0] as { n: number }).n).toBe(0);
  return { db, rt };
}

async function events(rt: WorkerRuntime): Promise<Event[]> {
  const rows = await rt.db.execute(
    sql`SELECT e.job_id AS "jobId", coalesce(j.payload->'request'->>'kind', 'change_set') AS kind,
               e.type, e.payload
        FROM job_event e JOIN job j ON j.id = e.job_id
        WHERE j.kind = 'kg.sync' ORDER BY e.created_at, e.seq`,
  );
  return rows.rows as Event[];
}

async function settled(rt: WorkerRuntime, timeoutMs = 60_000): Promise<Event[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await rt.db.execute(
      sql`SELECT count(*)::int AS n FROM job WHERE kind = 'kg.sync' AND status IN ('queued', 'running')`,
    );
    if ((open.rows[0] as { n: number }).n === 0) return events(rt);
    if (Date.now() > deadline) throw new Error("kg.sync jobs did not settle");
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** True once the dish job's first attempt has ended (a retry, done or failed event). */
async function dishAttemptEnded(rt: WorkerRuntime): Promise<boolean> {
  return (await events(rt)).some(
    (e) => e.kind === "dish" && ["retrying", "done", "failed"].includes(e.type),
  );
}
async function dishStarted(rt: WorkerRuntime): Promise<boolean> {
  return (await events(rt)).some((e) => e.kind === "dish" && e.type === "started");
}

const failures = (evs: Event[]) =>
  evs
    .filter((e) => e.type === "retrying" || e.type === "failed")
    .map((e) => `${e.kind} ${e.type}: ${JSON.stringify(e.payload)}`);

const canonical = (s: GraphSnapshot, dropLibrary: boolean) => ({
  nodes: [...s.nodes].sort(),
  edges: [...s.edges]
    .filter((e) => !dropLibrary || ![...LIBRARY_EDGES].some((t) => e.includes(t)))
    .sort(),
});

/**
 * SPEC-Q-5: the start-up graph equals the rebuild's without the library edges; with the nightly
 * recompute it equals the rebuild's exactly. The rebuild runs last, on the same relational state.
 */
async function expectRebuildEqual(rt: WorkerRuntime): Promise<void> {
  const startUp = await rt.graph.snapshot();
  expect(startUp.nodes.length).toBeGreaterThan(0);
  await recomputeLibrary(rt.graph, rt.kgSource);
  const nightly = await rt.graph.snapshot();
  const rebuilt = await rebuildGraph(rt.graph, rt.kgSource);
  expect(canonical(startUp, true)).toEqual(canonical(rebuilt, true));
  expect(canonical(nightly, false)).toEqual(canonical(rebuilt, false));
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** held: the catalogue job starts only once the dish job's first attempt has ended. */
const HELD: Hook = async (rt, request, run) => {
  if (request.kind === "catalogue") await waitFor(() => dishAttemptEnded(rt), 30_000);
  await run();
};

/**
 * open-tx: the catalogue job writes its nodes inside a transaction that it keeps open until the
 * dish job's first attempt has ended, or for 2 s after the dish job started, whichever is first.
 * Meanwhile it records whether another backend of this database waited on a row lock (the fixed
 * dish sync waits on the uncommitted catalogue nodes; the pre-fix one fails at once).
 */
function openTx(seen: { lockWait: boolean }): Hook {
  // W-18: the dish job starts only once the catalogue nodes are written and not yet committed.
  // Unhooked, it could finish before they were written, and no backend ever waited on a lock.
  let written = false;
  return async (rt, request, run) => {
    if (request.kind !== "catalogue") {
      await waitFor(() => Promise.resolve(written), 30_000);
      return run();
    }
    await rt.graph.transaction(async (tx) => {
      await syncGraph(tx, rt.kgSource, request);
      written = true;
      await waitFor(() => dishStarted(rt), 30_000);
      const until = Date.now() + 2_000;
      while (Date.now() < until && !(await dishAttemptEnded(rt))) {
        const waiting = await rt.db.execute(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if ((waiting.rows[0] as { n: number }).n > 0) seen.lockWait = true;
        await new Promise((r) => setTimeout(r, 50));
      }
    });
  };
}

/** three: every sync waits until all three jobs have entered the handler, then they go together. */
function together(n: number): Hook {
  let entered = 0;
  return async (_rt, _request, run) => {
    entered += 1;
    const deadline = Date.now() + 30_000;
    while (entered < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await run();
  };
}

async function startUp(
  concurrency: number,
  sync: Sync,
  hook?: Hook,
  extraCatalogue = false,
): Promise<{ rt: WorkerRuntime; evs: Event[] }> {
  const { rt } = await world(concurrency);
  active = handlerWith(sync, hook);
  HANDLERS["kg.sync"] = DISPATCH;
  try {
    await startWorker(rt);
    // The third start-up sync (run "three"); the `together` hook holds the others until it runs.
    if (extraCatalogue) await rt.enqueue("kg.sync", null, { request: { kind: "catalogue" } });
    return { rt, evs: await settled(rt) };
  } finally {
    HANDLERS["kg.sync"] = REAL_KG_SYNC;
  }
}

const done = (evs: Event[]) =>
  evs
    .filter((e) => e.type === "done")
    .map((e) => e.kind)
    .sort();

// ------------------------------------------------------------------------------------------------

describe("W-13 start-up graph sync (fixed)", () => {
  it("natural, at concurrency 2: no attempt fails; the graph equals the rebuild's", async () => {
    const { rt, evs } = await startUp(2, FIXED);
    expect(failures(evs)).toEqual([]);
    expect(done(evs)).toEqual(["catalogue", "dish"]);
    await expectRebuildEqual(rt);
  }, 120_000);

  it("held (the dish job runs before the catalogue job): no attempt fails; the graph equals the rebuild's", async () => {
    const { rt, evs } = await startUp(2, FIXED, HELD);
    expect(failures(evs)).toEqual([]);
    expect(done(evs)).toEqual(["catalogue", "dish"]);
    await expectRebuildEqual(rt);
  }, 120_000);

  it("open-tx (catalogue nodes written, not committed): the dish sync waits, no attempt fails; the graph equals the rebuild's", async () => {
    const seen = { lockWait: false };
    const { rt, evs } = await startUp(2, FIXED, openTx(seen));
    expect(failures(evs)).toEqual([]);
    expect(done(evs)).toEqual(["catalogue", "dish"]);
    expect(seen.lockWait).toBe(true);
    await expectRebuildEqual(rt);
  }, 120_000);

  it("three (two catalogue syncs and the dish sync together, concurrency 3): no deadlock, no retry; the graph equals the rebuild's", async () => {
    const { rt, evs } = await startUp(3, FIXED, together(3), true);
    expect(failures(evs)).toEqual([]);
    expect(evs.some((e) => JSON.stringify(e.payload).includes("deadlock"))).toBe(false);
    expect(done(evs)).toEqual(["catalogue", "catalogue", "dish"]);
    await expectRebuildEqual(rt);
  }, 120_000);
});

describe("W-13 negative control: the pre-fix syncDishes (f7b041a)", () => {
  it("held: the dish job's attempt fails with edges to missing catalogue nodes", async () => {
    const { evs } = await startUp(2, PRE_FIX, HELD);
    const f = failures(evs);
    expect(f.length).toBeGreaterThan(0);
    expect(
      f.some((x) => x.startsWith("dish") && x.includes("name a node that does not exist")),
    ).toBe(true);
  }, 120_000);

  it("open-tx: the dish job's attempt fails with edges to missing catalogue nodes", async () => {
    const seen = { lockWait: false };
    const { evs } = await startUp(2, PRE_FIX, openTx(seen));
    const f = failures(evs);
    expect(
      f.some((x) => x.startsWith("dish") && x.includes("name a node that does not exist")),
    ).toBe(true);
  }, 120_000);

  it("natural (reported, not asserted): the race as reproduced at CP1", async () => {
    const { evs } = await startUp(2, PRE_FIX);
    process.stdout.write(
      `W-13 natural pre-fix run: ${failures(evs).length === 0 ? "no failed attempt this time" : `failed attempts: ${String(failures(evs).length)}`}\n`,
    );
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
// SPEC-Q-6: a household change set with a new private ingredient and a dish using it
// ------------------------------------------------------------------------------------------------

/** The household, its change set (ingredient.create + dish.create using it), and its sync job. */
async function householdChangeSet(
  rt: WorkerRuntime,
): Promise<{ householdId: string; ingredientId: string }> {
  const adminUserId = newId();
  await rt.db.execute(
    sql`INSERT INTO "user" (id, email, name, created_at, updated_at)
        VALUES (${adminUserId}, ${`spice-${adminUserId}@example.test`}, 'Spice admin', now(), now())`,
  );
  const { householdId } = await createHousehold(rt.db, { name: "Spice household", adminUserId });
  const [seed] = (
    await rt.db.execute(
      sql`SELECT id FROM dish WHERE household_id IS NULL AND slug = 'chicken-biryani'`,
    )
  ).rows as Array<{ id: string }>;
  if (seed === undefined) throw new Error("seed dish chicken-biryani missing");
  const tree = await dishTree(rt.db, seed.id);
  const [cumin] = await rt.db.select().from(ingredient).where(eq(ingredient.slug, "cumin"));
  if (cumin === undefined) throw new Error("cumin missing");
  const ingredientId = newId();
  const components = tree.components.map((c) => ({
    ...c,
    id: newId(),
    variants: c.variants.map((v) => ({
      ...v,
      id: newId(),
      ingredients: v.ingredients.map((l) =>
        l.ingredientId === cumin.id ? { ...l, ingredientId } : l,
      ),
    })),
  }));
  expect(
    components.some((c) =>
      c.variants.some((v) => v.ingredients.some((l) => l.ingredientId === ingredientId)),
    ),
  ).toBe(true);
  const applied = await applyChangeSet(
    rt.db,
    { householdId, userId: adminUserId, role: "admin" },
    {
      actor: "user",
      source: "ui",
      summary: "Add a house spice mix and our biryani",
      ops: [
        {
          kind: "ingredient.create",
          payload: {
            id: ingredientId,
            slug: "house_spice_mix",
            name: "House spice mix",
            category: cumin.category,
            kcal: cumin.kcal,
            proteinG: cumin.proteinG,
            carbsG: cumin.carbsG,
            fatG: cumin.fatG,
            satFatG: cumin.satFatG,
            fibreG: cumin.fibreG,
            solubleFibreG: cumin.solubleFibreG,
            sugarG: cumin.sugarG,
            sodiumMg: cumin.sodiumMg,
            nutritionSource: "manual",
            nutritionConfidence: "medium",
          },
        },
        {
          kind: "dish.create",
          payload: copyPayload(tree, {
            id: newId(),
            name: "Our biryani",
            slug: "our-biryani",
            components,
          }),
        },
      ],
    },
  );
  await rt.enqueue("kg.sync", householdId, { changeSetId: applied.changeSetId });
  return { householdId, ingredientId };
}

/** The pre-fix handler for a change set's requests: syncRequests' order, pre-fix dish sync. */
function preFixChangeSetHandler(): JobHandler {
  return async (ctx) => {
    const p = ctx.job.payload as { changeSetId?: string; request?: KgSyncRequest };
    if (p.request !== undefined) {
      await PRE_FIX(ctx.rt.graph, ctx.rt.kgSource, p.request);
      return { requests: [p.request] as unknown as Json };
    }
    // The real handler computes the requests (in rolled-back transactions); they are replayed
    // with the pre-fix dish sync.
    const result = (await REAL_KG_SYNC({
      ...ctx,
      rt: { ...ctx.rt, graph: dryRunStore(ctx.rt.graph) },
    })) as { requests: KgSyncRequest[] };
    const requests = result.requests;
    for (const r of requests) await PRE_FIX(ctx.rt.graph, ctx.rt.kgSource, r);
    return { requests: requests as unknown as Json };
  };
}

/** A store whose transactions are rolled back: lets the real handler compute its requests only. */
function dryRunStore(graph: WorkerRuntime["graph"]): WorkerRuntime["graph"] {
  const ROLLBACK = new Error("dry run");
  return new Proxy(graph, {
    get: (target, prop) => {
      if (prop === "transaction")
        return async <T>(work: (s: GraphSyncStore) => Promise<T>) =>
          target
            .transaction(async (tx) => {
              await work(tx);
              throw ROLLBACK;
            })
            .catch((e: unknown) => {
              if (e !== ROLLBACK) throw e;
            });
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

describe("SPEC-Q-6: a change set adding a private ingredient and a dish using it", () => {
  it("the real kg.sync handler (syncRequests: dish request first) succeeds, no retry", async () => {
    const { rt, evs } = await startUp(2, FIXED);
    expect(failures(evs)).toEqual([]);
    active = REAL_KG_SYNC;
    const { householdId, ingredientId } = await householdChangeSet(rt);
    const after = await settled(rt);
    expect(failures(after)).toEqual([]);
    expect(after.filter((e) => e.kind === "change_set" && e.type === "done")).toHaveLength(1);
    const node = await rt.db.execute(
      sql`SELECT 1 FROM kg_node WHERE household_id = ${householdId} AND type = 'Ingredient' AND key = ${ingredientId}`,
    );
    expect(node.rows).toHaveLength(1);
  }, 120_000);

  it("negative control: with the pre-fix syncDishes it fails on every attempt", async () => {
    const { rt, evs } = await startUp(2, FIXED);
    expect(failures(evs)).toEqual([]);
    active = preFixChangeSetHandler();
    await householdChangeSet(rt);
    const after = await settled(rt, 60_000);
    const f = failures(after).filter((x) => x.startsWith("change_set"));
    expect(f.filter((x) => x.includes("retrying"))).toHaveLength(2);
    expect(
      f.some((x) => x.includes("failed") && x.includes("name a node that does not exist")),
    ).toBe(true);
  }, 120_000);
});
