// Root R2 (SC-1) on a fresh compose stack (R-79, R-80). F1 is built through the stack's API and
// checked against loadFixture(F1); node-1.2 N3's inputs (F1's week, seed 1, economy 0.4, AI recipes
// off) are queued through the API and the stack's worker container runs `plan.generate`. SC-1 is
// node-1.2 N3's measure (test/node/engine-measure.ts `evaluateSc1`) on the persisted plates.
// Negative control: persisted plate grams tampered off tolerance fail SC-1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { measure } from "../../../../packages/db/test/node/support";
import { loadRecordings, type RecordedModel } from "../node/recorded-model";
import { evaluateSc1, householdConfig, readPlan, variantNutrients } from "../node/engine-measure";
import { assertF1 } from "./f1-api";
import { ECONOMY, F1_WEEK, finishRun, queueRun, type Run } from "./engine-runs";
import { pool, recordedModel } from "./stack";

/** The worker's insight synthesis, answered from the recording (recorded/product-parse.json). */
const SYNTHESIS = "insights.run: synthesis keeps the rule candidates as they are";
const SYNTHESIS_ONLY = () =>
  loadRecordings("product-parse", {}).filter((r) => r.name === SYNTHESIS);

let db: pg.Pool;
let model: RecordedModel;
let run: Run;

beforeAll(async () => {
  db = pool();
  // plan.generate with AI recipes off calls no model. The worker's scheduled insights runs ask for
  // a synthesis, answered by the node gates' recorded synthesis; any other request is a failure.
  model = await recordedModel(SYNTHESIS_ONLY());
});

afterAll(async () => {
  await model.close();
  await db.end();
});

async function sc1(r: Run) {
  const ctx = r.f1.ctx;
  const meals = await readPlan(db, r.f1.householdId, F1_WEEK);
  const cfg = await householdConfig(drizzle(db), ctx);
  return evaluateSc1(cfg, F1_WEEK, meals, await variantNutrients(db, meals), r.flags);
}

describe("root SC-1 (compose stack)", () => {
  it("SC-1 F1 through the stack's API, and plan.generate by its worker persists the 7-day plan (seed 1, economy 0.4, AI recipes off)", async () => {
    let compared: Record<string, number> = {};
    const queued = await queueRun("sc1", 1, ECONOMY, async (f1) => {
      compared = await assertF1(db, f1);
    });
    run = await finishRun(db, queued);
    const { rows } = await db.query<{ days: number; meals: number; plates: number }>(
      `SELECT (SELECT count(*) FROM plan_day WHERE household_id = $1)::int AS days,
              (SELECT count(*) FROM plan_meal WHERE household_id = $1)::int AS meals,
              (SELECT count(*) FROM plate WHERE household_id = $1)::int AS plates`,
      [run.f1.householdId],
    );
    measure({
      check: "setup",
      compared,
      days: rows[0]?.days,
      meals: rows[0]?.meals,
      plates: rows[0]?.plates,
      seconds: run.seconds,
      flags: run.flags.length,
      flagKinds: [...new Set(run.flags.map((f) => f.kind))],
    });
    expect(rows[0]?.days).toBe(7);
  });

  it("SC-1 from the persisted plates: every targeted member-meal in tolerance or flagged with its reason", async () => {
    const result = await sc1(run);
    measure({ check: "sc1", ...result, failures: result.failures.slice(0, 20) });
    expect(result.failures).toEqual([]);
    expect(result.total).toBeGreaterThan(0);
    expect(result.inTolerance + result.flagged + result.noPlateFlagged).toBe(result.total);
    expect(result.storedDrift).toBe(0);
  });

  it("SC-1 negative control: persisted plate grams tampered off tolerance fail SC-1", async () => {
    const cfg = await householdConfig(drizzle(db), run.f1.ctx);
    const before = await readPlan(db, run.f1.householdId, F1_WEEK);
    const targetedIds = new Set(cfg.members.filter((m) => m.isTargeted).map((m) => m.id));
    const plate = before
      .flatMap((m) => m.plates)
      .find((p) => targetedIds.has(p.memberId) && p.fitStatus === "in_tolerance");
    const item = plate?.items.reduce((a, b) => (b.cookedG > a.cookedG ? b : a));
    expect(item).toBeDefined();
    await db.query(
      "UPDATE plate_item SET cooked_g = cooked_g * 1.6 WHERE plate_id = $1 AND variant_id = $2 AND component_id = $3",
      [plate?.id, item?.variantId, item?.componentId],
    );
    const result = await sc1(run);
    measure({
      check: "sc1-control",
      failures: result.failures.length,
      maxStoredDiff: result.maxStoredDiff,
      storedDrift: result.storedDrift,
    });
    expect(result.failures.some((f) => f.includes("out of tolerance and not flagged"))).toBe(true);
    expect(result.storedDrift).toBeGreaterThan(0);
  });

  it("SC-1 the recorded model answered every request (insight syntheses only), and no live call was made", () => {
    const syntheses = model.answered.get(SYNTHESIS) ?? 0;
    measure({
      check: "model",
      requests: model.requests.length,
      syntheses,
      failures: model.failures,
    });
    expect(model.failures, model.failures.join("\n")).toEqual([]);
    expect(model.requests.length).toBe(syntheses);
  });
});
