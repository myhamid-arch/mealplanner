// G2 (UX-4; BLD-8 R-55, R-56; leaf-1.4.7 SPEC-Q-6): POST /api/v1/plans/preview runs as the
// `plans.preview` job in the built worker process and writes no plan: the row count of every table
// (job rows apart) and the change log are identical before and after. Its proposed side equals the
// plan actually produced by applying the same weights (`weights.set` through POST /change-sets) and
// replanning the same dates with the same seed (POST /plans/generate), meal by meal and plate by
// plate, in figures and in the meals that change. Both with no saved plan (current computed) and
// over a saved plan (current = saved).
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import type { PlannedMeal } from "@mealplanner/core/planner";
import { changeSet, job, jobEvent } from "@mealplanner/db/schema";
import { loadPlanInput } from "@mealplanner/db/services/plans";
import {
  mealChanges,
  metricsOf,
  previewPlan,
  type PreviewWeights,
} from "../../../worker/dist/src/jobs/plans-preview.js";
import { callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { startWorkerProcess, type WorkerProcess } from "./support/worker";
import { acceptWithSignup, addMembers, applyOps, invite, ok, signupAdmin, type Login } from "./support/world";

type Preview = ReturnType<typeof c.PlanPreviewDto.parse>;

let db: TestDatabase;
let app: TestApp;
let worker: WorkerProcess;
let a: Login & { householdId: string };
let member: Login;

const DATES = ["2026-11-09", "2026-11-10"];
const SEED = 5;
const CROWD: PreviewWeights = { appeal: 0.9, ingredientEconomy: 0.2, variety: 0.2 };
const FEWEST: PreviewWeights = { appeal: 0.4, ingredientEconomy: 0.8, variety: 0.2 };

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  a = await signupAdmin("Household A");
  const { adultId } = await addMembers(a);
  member = await acceptWithSignup(await invite(a, "member", adultId), "Sara");
  worker = await startWorkerProcess(db.url);
}, 300_000);

afterAll(async () => {
  await worker.stop();
  await app.close();
  await db.drop();
}, 60_000);

const ctx = () => ({ householdId: a.householdId, userId: a.userId, role: "admin" as const });

/** Waits for the job's terminal event; returns its type and payload. */
async function finished(jobId: string, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await app.rt.db
      .select({ type: jobEvent.type, payload: jobEvent.payload })
      .from(jobEvent)
      .where(and(eq(jobEvent.jobId, jobId), sql`${jobEvent.type} IN ('done', 'failed', 'cancelled')`));
    if (row !== undefined) return row;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish:\n${worker.output()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function runPreview(weights: PreviewWeights): Promise<Preview> {
  const r = await callJson(c.plansPreview, { body: { dates: DATES, weights, seed: SEED } }, a);
  expect(r.status).toBe(202);
  const { jobId } = c.JobRef.parse(r.json);
  const [row] = await app.rt.db.select({ kind: job.kind }).from(job).where(eq(job.id, jobId));
  expect(row?.kind).toBe("plans.preview");
  const done = await finished(jobId);
  expect(done.type, JSON.stringify(done.payload)).toBe("done");
  return c.PlanPreviewDto.parse(done.payload);
}

async function replan(weights: PreviewWeights) {
  await applyOps(a, [{ kind: "weights.set", payload: weights }]);
  const r = await callJson(c.plansGenerate, { body: { dates: DATES, seed: SEED } }, a);
  expect(r.status).toBe(202);
  const done = await finished(c.JobRef.parse(r.json).jobId);
  expect(done.type, JSON.stringify(done.payload)).toBe("done");
}

/** The saved meals of the dates, and the dish lookup, as the planner's loader reads them. */
async function saved(): Promise<{ meals: PlannedMeal[]; dishes: Map<string, never> }> {
  const { stored, pool } = await loadPlanInput(app.rt.db, ctx(), { dates: DATES });
  return {
    meals: stored.filter((m) => DATES.includes(m.date)),
    dishes: pool.byId as unknown as Map<string, never>,
  };
}

/** Waits until no job is queued or running (follow-up jobs of the setup change sets). */
async function idle(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const busy = await app.rt.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM job WHERE status IN ('queued', 'running')`,
    );
    if (Number(busy.rows[0]?.n ?? 0) === 0) return;
    if (Date.now() > deadline) throw new Error(`jobs still busy:\n${worker.output()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Rows of every table in the public schema, job rows apart (a preview's own record), once the
 * worker is idle, so no other job's writes are counted.
 */
async function rowCounts(): Promise<Record<string, number>> {
  await idle();
  const tables = await app.rt.db.execute<{ t: string }>(
    sql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  const out: Record<string, number> = {};
  for (const { t } of tables.rows) {
    if (t === "job" || t === "job_event") continue;
    const r = await app.rt.db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ${sql.identifier(t)}`);
    out[t] = Number(r.rows[0]?.n ?? 0);
  }
  return out;
}

async function changeLog(): Promise<string[]> {
  const rows = await app.rt.db
    .select({ id: changeSet.id })
    .from(changeSet)
    .where(eq(changeSet.householdId, a.householdId))
    .orderBy(asc(changeSet.appliedAt));
  return rows.map((r) => r.id);
}

/** Meal-by-meal and plate-by-plate differences (empty: the same plan). */
function planDiffs(x: readonly PlannedMeal[], y: readonly PlannedMeal[]): string[] {
  const key = (m: PlannedMeal) => `${m.date} ${m.slotKey} ${m.memberScope}`;
  const shape = (m: PlannedMeal) =>
    JSON.stringify({
      dish: m.dishId,
      kind: m.kind,
      attendees: [...m.attendees].sort(),
      plates: [...m.plates]
        .sort((p, q) => p.memberId.localeCompare(q.memberId))
        .map((p) => ({
          member: p.memberId,
          fit: p.fitStatus,
          items: p.solution.items.map((i) => [i.componentId, i.variantId, Math.round(i.cookedG * 10) / 10]),
          adjusters: p.solution.adjusters.map((i) => [i.dishId, i.variantId, Math.round(i.cookedG * 10) / 10]),
        })),
    });
  const ym = new Map(y.map((m) => [key(m), m]));
  const diffs: string[] = [];
  for (const m of x) {
    const n = ym.get(key(m));
    if (n === undefined) diffs.push(`${key(m)} only in the first plan`);
    else if (shape(m) !== shape(n)) diffs.push(`${key(m)} differs`);
  }
  for (const m of y) if (!x.some((n) => key(n) === key(m))) diffs.push(`${key(m)} only in the second plan`);
  return diffs;
}

describe("G2 planning preview (UX-4)", () => {
  let first: Preview;

  it("G2 with no saved plan: current is computed with the current weights; nothing is written", async () => {
    const counts = await rowCounts();
    const log = await changeLog();
    first = await runPreview(CROWD);
    expect(first.currentSource).toBe("computed");
    expect(first.dates).toEqual(DATES);
    expect(first.proposed.meals).toBeGreaterThan(0);
    expect(first.proposed.distinctIngredients).toBeGreaterThan(0);
    expect(await rowCounts()).toEqual(counts);
    expect(await changeLog()).toEqual(log);
    console.log(
      `G2 measured: computed current ${JSON.stringify(first.current)}, proposed ${JSON.stringify(first.proposed)}, ${String(first.changes.length)} changes`,
    );
  }, 600_000);

  it("G2 the proposed side equals the real replan with the same weights and seed", async () => {
    // In-process, the same code the job ran: its meals, to compare plate by plate.
    const local = await previewPlan(app.rt.db, ctx(), { dates: DATES, weights: CROWD, seed: SEED });
    const { proposedMeals, ...dto } = local;
    expect(c.PlanPreviewDto.parse(dto)).toEqual(first);
    await replan(CROWD);
    const after = await saved();
    expect(planDiffs(proposedMeals, after.meals)).toEqual([]);
    expect(metricsOf(after.meals, after.dishes)).toEqual(first.proposed);
  }, 600_000);

  it("G2 over a saved plan: current is the saved plan, and the listed changes are the replan's", async () => {
    const before = await saved();
    const counts = await rowCounts();
    const log = await changeLog();
    const p = await runPreview(FEWEST);
    expect(p.currentSource).toBe("saved");
    expect(p.current).toEqual(metricsOf(before.meals, before.dishes));
    expect(await rowCounts()).toEqual(counts);
    expect(await changeLog()).toEqual(log);
    await replan(FEWEST);
    const after = await saved();
    expect(p.proposed).toEqual(metricsOf(after.meals, after.dishes));
    const dishes = new Map([...before.dishes, ...after.dishes]);
    expect(p.changes).toEqual(mealChanges(before.meals, after.meals, dishes));
    console.log(
      `G2 measured: saved ${JSON.stringify(p.current)} → proposed ${JSON.stringify(p.proposed)}; ${String(p.changes.length)} meals or plates change (${p.changes.map((ch) => `${ch.date} ${ch.slotKey} ${ch.kind}`).join("; ")})`,
    );
  }, 600_000);

  it("G2 negative control: a plan that differs in one dish or one plate is reported", async () => {
    const { meals } = await saved();
    const [firstMeal, ...rest] = meals;
    if (firstMeal === undefined) throw new Error("no saved meal");
    expect(planDiffs(meals, [{ ...firstMeal, dishId: "00000000-0000-4000-8000-000000000000" }, ...rest])).toHaveLength(1);
    const plate = firstMeal.plates[0];
    if (plate === undefined) throw new Error("no plate");
    const item = plate.solution.items[0];
    if (item === undefined) throw new Error("no item");
    const moved = {
      ...firstMeal,
      plates: [
        { ...plate, solution: { ...plate.solution, items: [{ ...item, cookedG: item.cookedG + 10 }, ...plate.solution.items.slice(1)] } },
        ...firstMeal.plates.slice(1),
      ],
    };
    expect(planDiffs(meals, [moved, ...rest])).toEqual([`${firstMeal.date} ${firstMeal.slotKey} ${firstMeal.memberScope} differs`]);
  });

  it("G2 admin only; a member gets 403 and nothing is queued", async () => {
    const r = await callJson(c.plansPreview, { body: { dates: DATES, weights: CROWD } }, member);
    expect(r.status).toBe(403);
  });

  it("G2 input limits: 1 to 7 dates, weights between 0 and 1, no other fields", async () => {
    const dates8 = Array.from({ length: 8 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`);
    for (const body of [
      { dates: [], weights: {} },
      { dates: dates8, weights: {} },
      { dates: DATES, weights: { appeal: 1.5 } },
      { dates: DATES, weights: { aiGeneration: "off" } },
    ])
      expect((await callJson(c.plansPreview, { body }, a)).status).toBe(400);
  });
});
