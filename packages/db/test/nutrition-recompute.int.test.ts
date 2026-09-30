// Leaf 1.3.7 G2 (DM-4, R-82; SPEC-Q-3): a recipe change set that changes a variant's ingredient
// grams queues `nutrition.recompute`, and the worker's job rewrites that variant's
// `dish_nutrition_cache` row to the engine's new per-100 g values, with a later `computed_at`,
// leaving every other row as it was. The queueing (`followUpsOf`) and the job (`nutritionRecompute`)
// are the worker's own code, imported from its build by path; the test gives them a runtime with
// only what they read (the database, the catalogue file's energy factors, and an `enqueue` that
// writes the job row as the worker's does). The engine is the oracle: `variantNutritionPer100gCooked`
// on the variant's stored input after the change. Negative control: the stale row (before the job)
// fails the same comparison.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  variantNutritionPer100gCooked,
  ENGINE_VERSION,
  type AtwaterFactors,
} from "@mealplanner/core/nutrition";
import type { HouseholdContext, Json } from "@mealplanner/core/types";
import type { Executor } from "../src/repos/index.js";
import {
  changeSet,
  component,
  dish,
  dishNutritionCache,
  job,
  variant,
  variantIngredient,
} from "../src/schema/index.js";
import { newId } from "../src/schema/ids.js";
import { atwaterFactorsBySlug, migrateAndSeed, readCatalogueFiles } from "../src/seed/index.js";
import { DEFAULT_DATA_DIR } from "../src/seed/run.js";
import { applyChangeSet } from "../src/services/changes/index.js";
import { loadFixture } from "../src/services/config/index.js";
import { loadDbCatalog } from "../src/services/plans/catalog.js";
import { copyPayload, dishTree, freeSlug, withNewIds } from "../src/services/plans/dish-tree.js";
import { touchedEntityNames } from "../src/services/plans/followups.js";
import { createJob } from "../src/services/plans/jobs.js";
import { variantInputOf } from "../src/services/plans/nutrition.js";
import { createEmptyDatabase } from "./support/db.js";
import { F1 } from "./support/fixtures.js";

type CacheRow = typeof dishNutritionCache.$inferSelect;
type JobRow = typeof job.$inferSelect;

/** What the worker's handlers read of their runtime and job context (apps/worker runner.ts). */
interface WorkerRt {
  db: Executor;
  factorsBySlug: ReadonlyMap<string, AtwaterFactors>;
  enqueue: (
    kind: string,
    householdId: string,
    payload: Json,
    userId: string | null,
  ) => Promise<string>;
}
interface WorkerModule {
  nutritionRecompute: (ctx: {
    rt: WorkerRt;
    job: JobRow;
    household: () => HouseholdContext;
  }) => Promise<Json>;
  followUpsOf: (rt: WorkerRt, householdId: string, changeSetId: string | null) => Promise<string[]>;
}

const WORKER_HANDLERS = join(
  dirname(fileURLToPath(import.meta.url)),
  ...(import.meta.url.includes("/dist/") ? [".."] : []),
  "..",
  "..",
  "..",
  "apps",
  "worker",
  "dist",
  "src",
  "jobs",
  "handlers.js",
);

/** numeric(10, 3) columns: the stored value is the engine's value rounded to 3 decimals. */
const STORED_TOLERANCE = 0.0005 + 1e-9;
const NUTRIENT_COLUMNS = [
  ["kcal", "kcal"],
  ["protein", "protein"],
  ["carbs", "carbs"],
  ["fat", "fat"],
  ["satFat", "satFat"],
  ["fibre", "fibre"],
  ["solubleFibre", "solubleFibre"],
  ["sugar", "sugar"],
  ["sodium", "sodiumMg"],
] as const;

let pool: pg.Pool | undefined;
let db: Executor;
let drop: (() => Promise<void>) | undefined;
let ctx: HouseholdContext;
let worker: WorkerModule;
let rt: WorkerRt;

beforeAll(async () => {
  worker = (await import(pathToFileURL(WORKER_HANDLERS).href)) as WorkerModule;
  const empty = await createEmptyDatabase("mp_137_dm4");
  drop = empty.drop;
  await migrateAndSeed(empty.url);
  pool = new pg.Pool({ connectionString: empty.url, max: 4 });
  db = drizzle(pool);
  ctx = (await loadFixture(db, F1)).adminContext;
  rt = {
    db,
    factorsBySlug: atwaterFactorsBySlug(readCatalogueFiles(DEFAULT_DATA_DIR).ingredients),
    enqueue: async (kind, householdId, payload, userId) =>
      (
        await createJob(db, {
          kind: kind as Parameters<typeof createJob>[1]["kind"],
          householdId,
          payload,
          createdByUserId: userId,
        })
      ).id,
  };
}, 300_000);

afterAll(async () => {
  await pool?.end();
  await drop?.();
});

/** Runs the queued jobs of a change set the worker's way; returns their kinds. */
async function queueAndRunRecompute(changeSetId: string): Promise<string[]> {
  const ids = await worker.followUpsOf(rt, ctx.householdId, changeSetId);
  const rows = ids.length === 0 ? [] : await db.select().from(job).where(inArray(job.id, ids));
  for (const row of rows.filter((r) => r.kind === "nutrition.recompute"))
    await worker.nutritionRecompute({ rt, job: row, household: () => ctx });
  return rows.map((r) => r.kind).sort();
}

async function householdCache(): Promise<Map<string, CacheRow>> {
  const rows = await db
    .select()
    .from(dishNutritionCache)
    .where(eq(dishNutritionCache.householdId, ctx.householdId));
  return new Map(rows.map((r) => [r.variantId, r]));
}

/**
 * The G2 comparison: every nutrient column, the cooked yield and the engine version of `row` equal
 * the engine's output on the variant's stored input. Returns the mismatches (empty = equal).
 */
async function engineMismatches(row: CacheRow): Promise<string[]> {
  const [v] = await db.select().from(variant).where(eq(variant.id, row.variantId));
  if (v === undefined) return [`variant ${row.variantId} is gone`];
  const catalog = await loadDbCatalog(db, ctx.householdId);
  const method = catalog.methodKeyById.get(v.methodId);
  if (method === undefined) return [`method ${v.methodId} is unknown`];
  const lines = (
    await db.select().from(variantIngredient).where(eq(variantIngredient.variantId, v.id))
  ).sort((a, b) => a.id.localeCompare(b.id));
  const { per100g, batchCookedG } = variantNutritionPer100gCooked(
    variantInputOf(method, lines),
    catalog.context,
  );
  const out: string[] = [];
  const check = (name: string, stored: number | null, engine: number | null) => {
    if (stored === null || engine === null) {
      if (stored !== engine)
        out.push(`${name}: stored ${String(stored)}, engine ${String(engine)}`);
    } else if (Math.abs(stored - engine) > STORED_TOLERANCE)
      out.push(`${name}: stored ${String(stored)}, engine ${String(engine)}`);
  };
  for (const [column, key] of NUTRIENT_COLUMNS) check(column, row[column], per100g[key] ?? null);
  check("cookedYieldGPerBatch", row.cookedYieldGPerBatch, batchCookedG);
  if (row.engineVersion !== ENGINE_VERSION)
    out.push(`engineVersion: stored ${row.engineVersion}, engine ${ENGINE_VERSION}`);
  return out;
}

describe("DM-4: a change to a variant's grams is recomputed by the worker's job", () => {
  let dishId: string;
  let changedVariant: string;
  let before: Map<string, CacheRow>;
  let after: Map<string, CacheRow>;
  let kinds: string[];
  let editId: string;

  beforeAll(async () => {
    // A household copy of the seed dish with the most variants (REC-7 copy-on-write), so the change
    // set can edit it and the dish has several variants whose rows must stay as they were.
    if (pool === undefined) throw new Error("no database");
    const counts = await pool.query<{ id: string; n: number }>(
      `SELECT d.id, count(v.id)::int AS n FROM dish d JOIN component c ON c.dish_id = d.id
         JOIN variant v ON v.component_id = c.id
        WHERE d.household_id IS NULL AND d.status = 'active'
        GROUP BY d.id ORDER BY n DESC, d.slug LIMIT 1`,
    );
    const seedDish = counts.rows[0];
    if (seedDish === undefined || seedDish.n < 3) throw new Error("no seed dish with 3+ variants");
    const tree = await dishTree(db, seedDish.id);
    dishId = newId();
    const created = await applyChangeSet(db, ctx, {
      actor: "user",
      source: "ui",
      summary: "Copy a recipe",
      ops: [
        {
          kind: "dish.create",
          payload: copyPayload(tree, {
            id: dishId,
            name: `${tree.dish.name} (ours)`,
            slug: await freeSlug(db, ctx.householdId, tree.dish.slug),
            components: withNewIds(tree.components).components,
          }),
        },
      ],
    });
    // The copy's own follow-up fills the cache (the state an edit starts from).
    await queueAndRunRecompute(created.changeSetId);
    before = await householdCache();

    // Change the grams of the heaviest line of the first variant with ≥ 2 lines, by half again.
    const copy = await dishTree(db, dishId);
    const target = copy.components
      .flatMap((c) => c.variants)
      .find((v) => v.ingredients.length >= 2);
    if (target === undefined) throw new Error("no variant with 2+ lines");
    changedVariant = target.id;
    const heaviest = target.ingredients.reduce((a, b) => (b.rawGPerBatch > a.rawGPerBatch ? b : a));
    const edited = copy.components.map((c) => ({
      ...c,
      variants: c.variants.map((v) =>
        v.id !== target.id
          ? v
          : {
              ...v,
              ingredients: v.ingredients.map((l) =>
                l === heaviest
                  ? { ...l, rawGPerBatch: Math.round(l.rawGPerBatch * 1.5 * 10) / 10 }
                  : l,
              ),
            },
      ),
    }));
    await new Promise((r) => setTimeout(r, 20)); // computed_at must be able to move forward
    const edit = await applyChangeSet(db, ctx, {
      actor: "user",
      source: "ui",
      summary: "More of the main ingredient",
      ops: [{ kind: "dish.update", payload: { dishId, components: edited } }],
    });
    editId = edit.changeSetId;
    kinds = await queueAndRunRecompute(edit.changeSetId);
    after = await householdCache();
  }, 300_000);

  it("G2 the change set queues nutrition.recompute (with kg.sync and plates.resolve)", () => {
    expect(kinds).toEqual(["kg.sync", "nutrition.recompute", "plates.resolve"]);
  });

  it("G2 the changed variant's row equals the engine's new per-100 g values, with a later computed_at", async () => {
    const row = after.get(changedVariant);
    const old = before.get(changedVariant);
    if (row === undefined || old === undefined) throw new Error("no cache row for the variant");
    expect(await engineMismatches(row)).toEqual([]);
    expect(row.computedAt.getTime()).toBeGreaterThan(old.computedAt.getTime());
  });

  it("G2 negative control: the stale row fails the same comparison", async () => {
    const stale = before.get(changedVariant);
    if (stale === undefined) throw new Error("no stale row");
    expect((await engineMismatches(stale)).length).toBeGreaterThan(0);
  });

  it("G2 every other variant's row is unchanged, computed_at included", async () => {
    const others = [...before.keys()].filter((id) => id !== changedVariant);
    const dishVariants = (
      await db
        .select({ id: variant.id })
        .from(variant)
        .innerJoin(component, eq(component.id, variant.componentId))
        .where(eq(component.dishId, dishId))
    ).map((r) => r.id);
    // The copy's other variants are among them.
    expect(dishVariants.filter((id) => id !== changedVariant).length).toBeGreaterThanOrEqual(2);
    for (const id of dishVariants) expect(before.has(id)).toBe(true);
    for (const id of others) expect(after.get(id)).toEqual(before.get(id));
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it("G2 the change set is a recipe change: it touched the variant's ingredient lines", async () => {
    const [row] = await db.select().from(changeSet).where(eq(changeSet.id, editId));
    if (row === undefined) throw new Error("no change set");
    expect([...touchedEntityNames(row)]).toContain("variant_ingredient");
    const [d] = await db.select().from(dish).where(eq(dish.id, dishId));
    expect(d?.version).toBe(2);
  });
});
