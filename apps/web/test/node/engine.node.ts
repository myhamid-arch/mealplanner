// node-1.2 N3 (R-69, R-70): the engine through the worker's `plan.generate` job, never the planner
// in memory. The gate's fresh database is migrated from zero with the catalogue and F1 (set-up
// test); it is then the template of one database per run (SPEC-Q-5), where the API route
// (`POST /change-sets` for the weights, `POST /plans/generate` for the week and seed) queues the
// job and the real worker process (apps/worker/dist) runs it. Everything measured is read back
// from what the worker persisted.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as c from "@mealplanner/api-contract/contract";
import type { HouseholdContext } from "@mealplanner/core/types";
import { migrateAndSeed } from "@mealplanner/db/seed";
import { loadFixture } from "@mealplanner/db/services/config";
import { F1 } from "../../../../packages/core/dist/test/fixtures/index.js";
import { F1_WEEK } from "../../../../packages/core/dist/test/planner/targets/config.js";
import { measure } from "../../../../packages/db/test/node/support";
import { callJson, startTestApp } from "../api/support/app";
import {
  checkCookSheet,
  checkRepeatGaps,
  coreIngredients,
  evaluateSc1,
  householdConfig,
  readPlan,
  sc2Aggregate,
  variantNutrients,
  type Flag,
  type StoredMeal,
} from "./engine-measure";
import { requiredEnv, signInInProcess, startWorker } from "./support";

const F1_ADMIN = "adult.a@f1.example";
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const ECONOMY = 0.4;
/** Plan runs at once (each with its own database and worker). */
const WIDTH = Math.max(1, Number(process.env.NODE_PLAN_WIDTH ?? "2") || 2);
/** Cook sheet vs plate raw equivalents: plate grams are stored to 0.001 g, so sums may differ. */
const RAW_TOLERANCE_G = 0.05;

const serverUrl = requiredEnv("NODE_SERVER_URL");
const templateUrl = requiredEnv("NODE_DB_URL");
const templateName = new URL(templateUrl).pathname.slice(1);

async function admin<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    return (await client.query(sql, values)).rows as T[];
  } finally {
    await client.end();
  }
}

interface Run {
  seed: number;
  economy: number;
  name: string;
  url: string;
  householdId: string;
  flags: Flag[];
  seconds: number;
  drop(): Promise<void>;
}

let inProcess: Promise<unknown> = Promise.resolve();
/** The in-process API installs one global runtime, so its calls are serialised. */
function serially<T>(fn: () => Promise<T>): Promise<T> {
  const next = inProcess.then(fn, fn);
  inProcess = next.catch(() => undefined);
  return next;
}

async function jobOutcome(pool: pg.Pool, jobId: string, ms = 900_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const { rows } = await pool.query<{ status: string; error: unknown }>(
      "SELECT status::text, error FROM job WHERE id = $1",
      [jobId],
    );
    const status = rows[0]?.status;
    if (status === "succeeded") {
      // The `done` event's payload is the job's result (apps/worker/src/runner.ts).
      const { rows: done } = await pool.query<{ payload: { flags?: unknown } }>(
        "SELECT payload FROM job_event WHERE job_id = $1 AND type = 'done' ORDER BY seq DESC LIMIT 1",
        [jobId],
      );
      const flags = done[0]?.payload.flags;
      if (!Array.isArray(flags)) throw new Error(`job ${jobId}: its result carries no flags list`);
      return { flags: flags as Flag[] };
    }
    if (status === "failed" || status === "cancelled")
      throw new Error(`job ${jobId} ${status}: ${JSON.stringify(rows[0]?.error)}`);
    if (Date.now() > deadline) throw new Error(`job ${jobId} still ${String(status)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** One plan of F1's week in a fresh copy of the seeded database, through the API and the worker. */
async function planRun(seed: number, economy: number): Promise<Run> {
  const started = Date.now();
  const name = `${templateName.slice(0, 40)}_r${String(seed)}_${String(economy * 10)}_${randomBytes(3).toString("hex")}`;
  await admin(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  const u = new URL(serverUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const drop = async () => {
    await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  };
  try {
    const queued = await serially(async () => {
      const app = startTestApp(url);
      try {
        const login = await signInInProcess(app.rt, F1_ADMIN);
        const caller = { token: login.token, householdId: login.householdId };
        const weights = await callJson(
          c.changeSetsApply,
          {
            body: {
              summary: `node-1.2 N3 weights (economy ${String(economy)})`,
              ops: [
                {
                  kind: "weights.set",
                  payload: { ingredientEconomy: economy, aiGeneration: "off" },
                },
              ],
            },
          },
          caller,
        );
        if (weights.status !== 201) throw new Error(`weights.set: ${weights.text}`);
        const generate = await callJson(
          c.plansGenerate,
          { body: { dates: F1_WEEK, seed } },
          caller,
        );
        if (generate.status !== 202) throw new Error(`plans/generate: ${generate.text}`);
        return {
          jobId: (generate.json as { jobId: string }).jobId,
          householdId: login.householdId,
        };
      } finally {
        await app.close();
      }
    });
    const worker = await startWorker(url);
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      const result = await jobOutcome(pool, queued.jobId);
      return {
        seed,
        economy,
        name,
        url,
        householdId: queued.householdId,
        flags: result.flags,
        seconds: Math.round((Date.now() - started) / 1000),
        drop,
      };
    } catch (error) {
      throw new Error(`${String(error)}\nworker output:\n${worker.output()}`, { cause: error });
    } finally {
      await pool.end();
      await worker.stop();
    }
  } catch (error) {
    await drop();
    throw error;
  }
}

async function pooled<T, R>(items: readonly T[], width: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        const item = items[i];
        if (item !== undefined) out[i] = await fn(item);
      }
    }),
  );
  return out;
}

let main: Run | undefined;
let mainPool: pg.Pool | undefined;
let ctx: HouseholdContext;
const runs: Run[] = [];

/** The seed-1, economy-0.4 run the SC-1, gap and cook-sheet checks read. */
function kept(): { main: Run; pool: pg.Pool } {
  if (main === undefined || mainPool === undefined)
    throw new Error("the seed-1 plan run did not complete");
  return { main, pool: mainPool };
}

afterAll(async () => {
  if (mainPool !== undefined) await mainPool.end();
  for (const r of runs) await r.drop().catch(() => undefined);
});

describe("node-1.2 N3 engine (worker plan.generate)", () => {
  it("N3 set-up: a fresh database migrated from zero, the catalogue loaded and F1 seeded", async () => {
    const pool = new pg.Pool({ connectionString: templateUrl, max: 2 });
    try {
      const { rows: before } = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
      );
      expect(before[0]?.n).toBe(0);
      await migrateAndSeed(templateUrl);
      const f1 = await loadFixture(drizzle(pool), F1);
      const { rows } = await pool.query<{ ingredients: number; dishes: number; members: number }>(
        `SELECT (SELECT count(*) FROM ingredient)::int AS ingredients,
                (SELECT count(*) FROM dish)::int AS dishes,
                (SELECT count(*) FROM member WHERE household_id = $1)::int AS members`,
        [f1.householdId],
      );
      expect(rows[0]?.ingredients).toBeGreaterThan(0);
      expect(rows[0]?.dishes).toBeGreaterThan(0);
      expect(rows[0]?.members).toBe(5);
      const { rows: rules } = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM frequency_rule",
      );
      // No household frequency rule: every repeat gap is the OQ-8 default.
      expect(rules[0]?.n).toBe(0);
      measure({ check: "setup", ...rows[0] });
    } finally {
      await pool.end();
    }
  });

  it("N3 plan.generate through the worker persists F1's 7-day plan and SC-2's runs (seeds 1–10, economy 0.4 and 0)", async () => {
    const plan = SEEDS.flatMap((seed) => [ECONOMY, 0].map((economy) => ({ seed, economy })));
    const done = await pooled(plan, WIDTH, (p) => planRun(p.seed, p.economy));
    runs.push(...done);
    expect(runs.length).toBe(20);
    main = runs.find((r) => r.seed === 1 && r.economy === ECONOMY);
    expect(main).toBeDefined();
    if (main === undefined) return;
    mainPool = new pg.Pool({ connectionString: main.url, max: 4 });
    const k = kept();
    ctx = { householdId: k.main.householdId, userId: null, role: "system" };
    const { rows } = await k.pool.query<{ days: number; meals: number; plates: number }>(
      `SELECT (SELECT count(*) FROM plan_day WHERE household_id = $1)::int AS days,
              (SELECT count(*) FROM plan_meal WHERE household_id = $1)::int AS meals,
              (SELECT count(*) FROM plate WHERE household_id = $1)::int AS plates`,
      [k.main.householdId],
    );
    expect(rows[0]?.days).toBe(7);
    measure({
      check: "runs",
      runs: runs.length,
      days: rows[0]?.days,
      meals: rows[0]?.meals,
      plates: rows[0]?.plates,
      seconds: runs.map((r) => r.seconds),
      flags: k.main.flags.length,
      flagKinds: [...new Set(k.main.flags.map((f) => f.kind))],
    });
  });

  it("N3 SC-1 from the persisted plates: every targeted member-meal in tolerance or flagged with its reason", async () => {
    const k = kept();
    const db = drizzle(k.pool);
    const meals = await readPlan(k.pool, k.main.householdId, F1_WEEK);
    const cfg = await householdConfig(db, ctx);
    const result = evaluateSc1(
      cfg,
      F1_WEEK,
      meals,
      await variantNutrients(k.pool, meals),
      k.main.flags,
    );
    measure({ check: "sc1", ...result, failures: result.failures.slice(0, 20) });
    expect(result.failures).toEqual([]);
    expect(result.total).toBeGreaterThan(0);
    expect(result.inTolerance + result.flagged + result.noPlateFlagged).toBe(result.total);
    expect(result.storedDrift).toBe(0);
  });

  it("N3 the OQ-8 repeat gaps hold on the persisted plan", async () => {
    const k = kept();
    const result = checkRepeatGaps(
      await readPlan(k.pool, k.main.householdId, F1_WEEK),
      k.main.flags,
    );
    measure({ check: "gaps", ...result });
    expect(result.violations, result.violations.join("\n")).toEqual([]);
    expect(result.pairs).toBeGreaterThan(0);
  });

  it("N3 day 1's cook sheet from the persisted plan: raw totals equal the sum of plate raw equivalents", async () => {
    const k = kept();
    const day1 = F1_WEEK[0];
    const meals = await readPlan(k.pool, k.main.householdId, [day1]);
    const result = await checkCookSheet(drizzle(k.pool), ctx, day1, meals, RAW_TOLERANCE_G);
    measure({ check: "cooksheet", ...result, failures: result.failures.slice(0, 20) });
    expect(result.failures).toEqual([]);
    expect(result.batches).toBeGreaterThan(0);
  });

  it("N3 SC-2 over seeds 1–10 through the job path: median ≥ 8 %, every seed ≥ 0 %", async () => {
    const perSeed = [];
    for (const seed of SEEDS) {
      const count = async (economy: number) => {
        const r = runs.find((x) => x.seed === seed && x.economy === economy);
        if (r === undefined)
          throw new Error(`no run for seed ${String(seed)} economy ${String(economy)}`);
        const pool = new pg.Pool({ connectionString: r.url, max: 1 });
        try {
          return (await coreIngredients(pool, r.householdId, F1_WEEK)).length;
        } finally {
          await pool.end();
        }
      };
      const economy = await count(ECONOMY);
      const baseline = await count(0);
      perSeed.push({ seed, economy, baseline, reduction: 1 - economy / baseline });
    }
    const agg = sc2Aggregate(perSeed.map((s) => s.reduction));
    measure({ check: "sc2", perSeed, ...agg });
    expect(perSeed.every((s) => s.baseline > 0)).toBe(true);
    expect(agg.pass).toBe(true);
  });

  it("N3 negative control: persisted plate grams tampered off tolerance fail SC-1", async () => {
    const k = kept();
    const db = drizzle(k.pool);
    const cfg = await householdConfig(db, ctx);
    const before = await readPlan(k.pool, k.main.householdId, F1_WEEK);
    const targetedIds = new Set(cfg.members.filter((m) => m.isTargeted).map((m) => m.id));
    const plate = before
      .flatMap((m) => m.plates)
      .find((p) => targetedIds.has(p.memberId) && p.fitStatus === "in_tolerance");
    const item = plate?.items.reduce((a, b) => (b.cookedG > a.cookedG ? b : a));
    expect(item).toBeDefined();
    await k.pool.query(
      "UPDATE plate_item SET cooked_g = cooked_g * 1.6 WHERE plate_id = $1 AND variant_id = $2 AND component_id = $3",
      [plate?.id, item?.variantId, item?.componentId],
    );
    const meals = await readPlan(k.pool, k.main.householdId, F1_WEEK);
    const result = evaluateSc1(
      cfg,
      F1_WEEK,
      meals,
      await variantNutrients(k.pool, meals),
      k.main.flags,
    );
    measure({
      check: "sc1-control",
      failures: result.failures.length,
      maxStoredDiff: result.maxStoredDiff,
      storedDrift: result.storedDrift,
    });
    expect(result.failures.some((f) => f.includes("out of tolerance and not flagged"))).toBe(true);
    expect(result.storedDrift).toBeGreaterThan(0);
  });

  it("N3 negative control: a repeated dish inside the gap fails the repeat check, also when every meal says relaxed without a persisted flag", async () => {
    const k = kept();
    const meals = await readPlan(k.pool, k.main.householdId, F1_WEEK);
    // A dinner two days after another dinner gets that dinner's dish (both are main meals: gap 7).
    const first = meals.find((m) => m.slotKey === "dinner" && m.date === F1_WEEK[0]);
    const second = meals.find((m) => m.slotKey === "dinner" && m.date === F1_WEEK[2]);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await k.pool.query("UPDATE plan_meal SET dish_id = $1 WHERE id = $2", [
      first?.dishId,
      second?.id,
    ]);
    const tampered = await readPlan(k.pool, k.main.householdId, F1_WEEK);
    const plain = checkRepeatGaps(tampered, k.main.flags);
    // Every meal marked relaxed, with no persisted flag behind it (pre-CP2 finding 2).
    const allRelaxed = tampered.map((m) => ({ ...m, frequencyRelaxed: "marked by the control" }));
    const unbacked = checkRepeatGaps(allRelaxed, k.main.flags);
    // Soundness: the same marks backed by persisted flags with a reason are accepted.
    const backing = allRelaxed.map((m) => ({
      kind: "frequency_relaxed",
      date: m.date,
      slotKey: m.slotKey,
      memberId: m.memberScope === "shared" ? null : m.memberScope,
      reason: "control",
    }));
    const backed = checkRepeatGaps(allRelaxed, [...k.main.flags, ...backing]);
    measure({
      check: "gaps-control",
      violations: plain.violations.length,
      unbackedViolations: unbacked.violations.length,
      backedViolations: backed.violations.length,
    });
    expect(plain.violations.length).toBeGreaterThan(0);
    expect(unbacked.violations.length).toBeGreaterThan(0);
    expect(backed.violations).toEqual([]);
  });

  it("N3 negative control: OQ-8 at its boundaries (main 6 and short 3 fail, main 7 and short 4 pass)", () => {
    const meal = (id: string, date: string, slotKey: string): StoredMeal => ({
      id,
      date,
      slotTypeId: slotKey,
      slotKey,
      dishId: "dish",
      memberScope: "shared",
      locked: false,
      attendees: ["member"],
      frequencyRelaxed: null,
      plates: [],
      batches: [],
    });
    const pair = (slotKey: string, apart: number) =>
      checkRepeatGaps(
        [
          meal("a", "2026-10-01", slotKey),
          meal("b", `2026-10-${String(1 + apart).padStart(2, "0")}`, slotKey),
        ],
        [],
      ).violations.length;
    const figures = {
      main6: pair("dinner", 6),
      main7: pair("dinner", 7),
      short3: pair("snack", 3),
      short4: pair("snack", 4),
      mixed4: checkRepeatGaps(
        [meal("a", "2026-10-01", "snack"), meal("b", "2026-10-05", "lunch")],
        [],
      ).violations.length,
    };
    measure({ check: "gaps-boundary", ...figures });
    expect(figures).toEqual({ main6: 1, main7: 0, short3: 1, short4: 0, mixed4: 1 });
  });

  it("N3 negative control: SC-2 measured against itself (0 %) fails", () => {
    const agg = sc2Aggregate(SEEDS.map(() => 0));
    const floor = sc2Aggregate([...SEEDS.slice(1).map(() => 0.2), -0.01]);
    measure({ check: "sc2-control", self: agg, floor });
    expect(agg.pass).toBe(false);
    expect(floor.median).toBeGreaterThanOrEqual(0.08);
    expect(floor.pass).toBe(false);
  });
});
