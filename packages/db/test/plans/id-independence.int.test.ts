// Leaf 1.2.7 G2 (W-17, R-73, PLN-11), service level: two databases, each created empty, migrated,
// seeded and loaded with F1 on its own (never a copy of one template), so every catalogue,
// household and fixture id differs between them. `generatePlan` (the service `plan.generate` runs)
// plans the F1 week at seed 1 on each. Under natural keys (dish slug, component and variant names,
// slot key, member name, ingredient slug) the planner inputs the loader builds are equal, and so
// are the persisted rows: date, slot key, member, dish slug, plate grams, flags, reasons and the
// cook batches in their stored order. Negative control: the row comparison reports a one-dish
// change as exactly one difference. The verify script also runs the worker's own handler.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanInput } from "@mealplanner/core/planner";
import type { HouseholdContext } from "@mealplanner/core/types";
import { F1_WEEK } from "../../../core/dist/test/planner/targets/config.js";
import type { Executor } from "../../src/repos/index.js";
import { migrateAndSeed } from "../../src/seed/index.js";
import { loadFixture } from "../../src/services/config/index.js";
import { generatePlan } from "../../src/services/plans/generate.js";
import { loadPlanInput } from "../../src/services/plans/load-input.js";
import { createEmptyDatabase } from "../support/db.js";
import { F1 } from "../support/fixtures.js";

const SEED = 1;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

interface World {
  name: string;
  pool: pg.Pool;
  db: Executor;
  drop: () => Promise<void>;
  householdId: string;
  input: PlanInput;
  /** Surrogate id → natural key. */
  natural: Map<string, string>;
}

/** Surrogate ids of the catalogue, the seed library and the household, as natural keys. */
async function naturalKeys(pool: pg.Pool, householdId: string): Promise<Map<string, string>> {
  const q = async <R extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    (await pool.query<R>(sql, params)).rows;
  const out = new Map<string, string>([[householdId, "household"]]);
  for (const r of await q<{ id: string; slug: string }>(`SELECT id, slug FROM ingredient`))
    out.set(r.id, `ingredient:${r.slug}`);
  for (const r of await q<{ id: string; slug: string; global: boolean }>(
    `SELECT id, slug, household_id IS NULL AS global FROM dish WHERE household_id IS NULL OR household_id = $1`,
    [householdId],
  ))
    out.set(r.id, `dish:${r.slug}${r.global ? "" : "@household"}`);
  for (const r of await q<{ id: string; dish_id: string; sort_order: number; name: string }>(
    `SELECT id, dish_id, sort_order, name FROM component`,
  )) {
    const dish = out.get(r.dish_id);
    if (dish !== undefined) out.set(r.id, `${dish}/${String(r.sort_order)}:${r.name}`);
  }
  for (const r of await q<{ id: string; component_id: string; label: string; method: string }>(
    `SELECT v.id, v.component_id, v.label, m.key AS method FROM variant v JOIN preparation_method m ON m.id = v.method_id`,
  )) {
    const component = out.get(r.component_id);
    if (component !== undefined) out.set(r.id, `${component}/${r.label}:${r.method}`);
  }
  for (const r of await q<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM member WHERE household_id = $1`,
    [householdId],
  ))
    out.set(r.id, `member:${r.display_name}`);
  for (const r of await q<{ id: string; key: string }>(
    `SELECT id, key FROM slot_type WHERE household_id = $1`,
    [householdId],
  ))
    out.set(r.id, `slot:${r.key}`);
  return out;
}

/**
 * `value` with every surrogate id (in strings and object keys) replaced by its natural key and
 * every timestamp dropped (fixture rows carry the time they were loaded). An id with no natural
 * key stays as it is, so it shows as a difference, unless `rowIds` is set: then it reads
 * "(row id)" (a configuration row's own id, such as a target profile's, which nothing orders by).
 */
function canonical(value: unknown, natural: ReadonlyMap<string, string>, rowIds = false): unknown {
  const text = (s: string) => s.replace(UUID, (u) => natural.get(u) ?? (rowIds ? "(row id)" : u));
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (v instanceof Date) return "(time)";
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walk(x)]));
  };
  return walk(value);
}

/** One persisted plate, as G2 compares it. */
interface PlateRow {
  date: string;
  slot: string;
  scope: string;
  member: string;
  dish: string;
  grams: string[];
  fitStatus: string;
  flag: string | null;
  frequencyRelaxed: string | null;
  reasons: string[];
}

/** The persisted plates of the household, canonical and in a fixed order. */
async function persistedPlates(w: World): Promise<PlateRow[]> {
  const { rows } = await w.pool.query<{
    date: string;
    slot_type_id: string;
    member_scope: string;
    member_id: string;
    dish_id: string;
    fit_status: string;
    deviation: { flag?: string | null };
    score_breakdown: { reasons?: string[]; meal?: { frequencyRelaxed?: string | null } };
    items: Array<{ componentId: string; variantId: string; cookedG: number }>;
  }>(
    `SELECT d.date::text AS date, m.slot_type_id, m.member_scope, p.member_id, m.dish_id,
            p.fit_status, p.deviation, m.score_breakdown,
            COALESCE((SELECT json_agg(json_build_object('componentId', i.component_id,
                        'variantId', i.variant_id, 'cookedG', i.cooked_g) ORDER BY i.id)
                      FROM plate_item i WHERE i.plate_id = p.id), '[]') AS items
       FROM plan_day d JOIN plan_meal m ON m.plan_day_id = d.id JOIN plate p ON p.plan_meal_id = m.id
      WHERE d.household_id = $1`,
    [w.householdId],
  );
  const n = (id: string) => w.natural.get(id) ?? id;
  const out = rows.map((r) => ({
    date: r.date,
    slot: n(r.slot_type_id),
    scope: r.member_scope === "shared" ? "shared" : n(r.member_scope),
    member: n(r.member_id),
    dish: n(r.dish_id),
    grams: r.items.map((i) => `${n(i.variantId)}=${String(i.cookedG)}`),
    fitStatus: r.fit_status,
    flag: r.deviation.flag ?? null,
    frequencyRelaxed: r.score_breakdown.meal?.frequencyRelaxed ?? null,
    reasons: r.score_breakdown.reasons ?? [],
  }));
  return (canonical(out, w.natural) as PlateRow[]).sort((a, b) => {
    const ka = `${a.date}|${a.slot}|${a.scope}|${a.member}`;
    const kb = `${b.date}|${b.slot}|${b.scope}|${b.member}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** The persisted cook batches per meal, in their stored order (ids are made in insertion order). */
async function persistedBatches(w: World): Promise<string[]> {
  const { rows } = await w.pool.query<{
    date: string;
    slot_type_id: string;
    member_scope: string;
    batches: Array<{ variantId: string; total: number; servings: number; raw: object }>;
  }>(
    `SELECT d.date::text AS date, m.slot_type_id, m.member_scope,
            COALESCE((SELECT json_agg(json_build_object('variantId', b.variant_id,
                        'total', b.total_cooked_g, 'servings', b.servings, 'raw', b.raw_ingredients)
                        ORDER BY b.id)
                      FROM cook_batch b WHERE b.plan_meal_id = m.id), '[]') AS batches
       FROM plan_day d JOIN plan_meal m ON m.plan_day_id = d.id WHERE d.household_id = $1`,
    [w.householdId],
  );
  return rows
    .map((r) =>
      JSON.stringify(canonical([r.date, r.slot_type_id, r.member_scope, r.batches], w.natural)),
    )
    .sort();
}

/** The differences between two plate lists, one line each (empty when equal). */
function plateDifferences(a: readonly PlateRow[], b: readonly PlateRow[]): string[] {
  const key = (r: PlateRow) => `${r.date} ${r.slot} ${r.scope} ${r.member}`;
  const byKey = new Map(b.map((r) => [key(r), r]));
  const out: string[] = [];
  for (const r of a) {
    const other = byKey.get(key(r));
    if (other === undefined) out.push(`${key(r)}: only in the first database`);
    else if (JSON.stringify(r) !== JSON.stringify(other))
      out.push(
        `${key(r)}: ${r.dish} [${r.grams.join(", ")}] ${r.fitStatus} | ${other.dish} [${other.grams.join(", ")}] ${other.fitStatus}`,
      );
    byKey.delete(key(r));
  }
  for (const k of byKey.keys()) out.push(`${k}: only in the second database`);
  return out;
}

async function world(label: string): Promise<World> {
  const empty = await createEmptyDatabase(`mp_w17_${label}`);
  await migrateAndSeed(empty.url);
  const pool = new pg.Pool({ connectionString: empty.url, max: 4 });
  const db = drizzle(pool);
  const loaded = await loadFixture(db, F1);
  const ctx: HouseholdContext = { householdId: loaded.householdId, userId: null, role: "system" };
  const { input } = await loadPlanInput(db, ctx, { dates: F1_WEEK });
  // What the `plan.generate` handler passes for a system job at seed 1 (no credential).
  await generatePlan(db, ctx, {
    dates: F1_WEEK,
    seed: SEED,
    by: { actor: "system", source: "learning" },
  });
  return {
    name: empty.name,
    pool,
    db,
    drop: async () => {
      await pool.end();
      await empty.drop();
    },
    householdId: loaded.householdId,
    input,
    natural: await naturalKeys(pool, loaded.householdId),
  };
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await world("a");
  b = await world("b");
}, 1_200_000);

afterAll(async () => {
  await a.drop();
  await b.drop();
});

describe("plan.generate on two separately seeded databases (W-17)", () => {
  it("each database was migrated, seeded and loaded from zero: different databases and ids", async () => {
    expect(a.name).not.toBe(b.name);
    expect(a.householdId).not.toBe(b.householdId);
    const ids = async (w: World, table: string) =>
      new Set(
        (await w.pool.query<{ id: string }>(`SELECT id FROM ${table}`)).rows.map((r) => r.id),
      );
    for (const table of ["member", "slot_type", "ingredient"]) {
      const x = await ids(a, table);
      const y = await ids(b, table);
      expect(x.size).toBeGreaterThan(0);
      expect([...x].filter((id) => y.has(id))).toEqual([]);
    }
  });

  it("the loader's planner input is the same under natural keys (every order included)", () => {
    expect(canonical(b.input, b.natural, true)).toEqual(canonical(a.input, a.natural, true));
  });

  it("persists identical (date, slot key, member, dish slug, plate grams, flags, reasons) rows", async () => {
    const x = await persistedPlates(a);
    const y = await persistedPlates(b);
    const meals = new Set(x.map((r) => `${r.date} ${r.slot} ${r.scope}`)).size;
    console.log(
      `W-17 G2: ${String(x.length)} plates in ${String(meals)} meals persisted on each database; ${String(x.filter((r) => r.flag !== null).length)} flagged, ${String(x.filter((r) => r.frequencyRelaxed !== null).length)} frequency-relaxed`,
    );
    expect(x.length).toBeGreaterThan(0);
    expect(plateDifferences(x, y)).toEqual([]);
    expect(y).toEqual(x);
  });

  it("persists identical cook batches in the same order (R-1)", async () => {
    const x = await persistedBatches(a);
    expect(x.length).toBeGreaterThan(0);
    expect(await persistedBatches(b)).toEqual(x);
  });

  it("negative control: a one-dish change is reported as exactly one difference", async () => {
    const x = await persistedPlates(a);
    const changed = structuredClone(x);
    const first = changed[0];
    if (first === undefined) throw new Error("no plates");
    const other = x.find((r) => r.dish !== first.dish)?.dish ?? "dish:other";
    first.dish = other;
    const diff = plateDifferences(x, changed);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain(other);
  });
});
