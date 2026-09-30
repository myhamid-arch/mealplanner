// Root R4 (SC-3) on a fresh compose stack (R-79, R-80), as node-1.3 N3 measures it. F1 is built
// through the stack's API (Adult B signs in with their own login, from an invite); a one-day plan
// comes from the stack's worker; Adult B's 1★ reviews go through `POST /reviews` and
// `POST /insights/run` runs the worker's `insights.run` with the recorded synthesis response.
// Negative control first, on the same household: one 1★ review gives no proposal. Then a second
// 1★ review lowers B's dish score and plate appeal (others' unchanged) and gives exactly one
// pending proposal of B's dislike of the dish.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { resolveScore } from "@mealplanner/core/learning/preferences";
import { createRepos } from "@mealplanner/db/repos";
import { appealOf } from "../../../../packages/db/test/reviews/measure";
import { measure } from "../../../../packages/db/test/node/support";
import { loadRecordings, type RecordedModel } from "../node/recorded-model";
import type { Api } from "../node/support";
import { assertF1, buildF1, type F1Household } from "./f1-api";
import { apiAs, pool, recordedModel, waitForJob } from "./stack";

const PLAN_DATE = "2026-09-28";
/** The recording that answers every insight synthesis request (recorded/intelligence.json). */
const SYNTHESIS = "insights.run: synthesis keeps the rule candidates as they are";

let db: pg.Pool;
let model: RecordedModel;
let f1: F1Household;
let memberApi: Api;
let memberId: string;
let dishId: string;
let planMealId: string;
let before: { scoreBefore: number; appealBefore: number; others: string[]; othersBefore: number[] };

beforeAll(async () => {
  db = pool();
  model = await recordedModel([]);
});

afterAll(async () => {
  await model.close();
  await db.end();
});

async function prefsScore(): Promise<number> {
  const prefs = await createRepos(drizzle(db), f1.ctx).preference.list();
  return resolveScore(prefs, memberId, "dish", dishId);
}

async function runInsights(): Promise<void> {
  const run = await f1.adminApi("POST", "/insights/run");
  expect(run.status, JSON.stringify(run.json)).toBe(202);
  await waitForJob(f1.adminApi, (run.json as { jobId: string }).jobId);
}

async function pendingProposals(): Promise<{ id: string; kind: string; payload: unknown }[]> {
  const r = await f1.adminApi("GET", "/proposals?status=pending");
  expect(r.status).toBe(200);
  return (r.json as { proposals: { id: string; kind: string; payload: unknown }[] }).proposals;
}

async function reviewOnce(): Promise<void> {
  const r = await memberApi("POST", "/reviews", {
    targetType: "dish",
    targetId: dishId,
    planMealId,
    rating: 1,
    tags: [],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
}

describe("root SC-3 (compose stack)", () => {
  it("SC-3 set-up: F1 through the stack's API, Adult B's own login, and a plan from the stack's worker", async () => {
    f1 = await buildF1("sc3");
    const compared = await assertF1(db, f1);
    memberId = f1.members.adult_b ?? "";
    const b = f1.logins.adult_b;
    if (b === undefined) throw new Error("no Adult B login");
    memberApi = apiAs(b);
    const weights = await f1.adminApi("POST", "/change-sets", {
      summary: "root SC-3: AI recipes off",
      ops: [{ kind: "weights.set", payload: { aiGeneration: "off" } }],
    });
    expect(weights.status).toBe(201);
    const gen = await f1.adminApi("POST", "/plans/generate", { dates: [PLAN_DATE], seed: 1 });
    expect(gen.status, JSON.stringify(gen.json)).toBe(202);
    await waitForJob(f1.adminApi, (gen.json as { jobId: string }).jobId, 1_200_000);
    const { rows: meals } = await db.query<{ id: string; dish_id: string }>(
      `SELECT m.id, m.dish_id FROM plan_meal m
         JOIN plan_day d ON d.id = m.plan_day_id
         JOIN slot_type s ON s.id = m.slot_type_id
         JOIN plate p ON p.plan_meal_id = m.id
        WHERE m.household_id = $1 AND d.date = $2 AND s.key = 'dinner' AND p.member_id = $3`,
      [f1.householdId, PLAN_DATE, memberId],
    );
    expect(meals.length).toBe(1);
    planMealId = meals[0]?.id ?? "";
    dishId = meals[0]?.dish_id ?? "";
    model.add(
      loadRecordings("intelligence", {
        MEMBER_ID: memberId,
        CHILD_ID: f1.members.c1 ?? "",
        DISH_ID: dishId,
      }).filter((r) => r.name === SYNTHESIS),
    );
    measure({ check: "setup", compared, planMealId, dishId, memberId });
  });

  it("SC-3 negative control: one 1★ review gives no proposal", async () => {
    const d = drizzle(db);
    const members = Object.values(f1.members).filter((m) => m !== memberId);
    const { rows: plated } = await db.query<{ member_id: string }>(
      "SELECT member_id FROM plate WHERE plan_meal_id = $1",
      [planMealId],
    );
    const others = plated.map((p) => p.member_id).filter((m) => members.includes(m));
    before = {
      scoreBefore: await prefsScore(),
      appealBefore: await appealOf(d, f1.ctx, planMealId, memberId),
      others,
      othersBefore: await Promise.all(others.map((m) => appealOf(d, f1.ctx, planMealId, m))),
    };
    await reviewOnce();
    await runInsights();
    const pending = await pendingProposals();
    measure({ check: "sc3-control", pending: pending.length });
    expect(pending).toEqual([]);
  });

  it("SC-3 a second 1★ review lowers the member's dish appeal and insights.run proposes the dislike", async () => {
    const d = drizzle(db);
    const { scoreBefore, appealBefore, others, othersBefore } = before;
    await reviewOnce();
    const scoreAfter = await prefsScore();
    const appealAfter = await appealOf(d, f1.ctx, planMealId, memberId);
    const othersAfter = await Promise.all(others.map((m) => appealOf(d, f1.ctx, planMealId, m)));
    await runInsights();
    const pending = await pendingProposals();
    const mine = pending.filter((p) => {
      const ops =
        (p.payload as { ops?: { kind: string; payload: Record<string, unknown> }[] }).ops ?? [];
      return ops.some(
        (o) =>
          o.kind === "preference.set" &&
          o.payload.memberId === memberId &&
          o.payload.entityType === "dish" &&
          o.payload.entityKey === dishId &&
          o.payload.score === -0.8,
      );
    });
    measure({
      check: "sc3",
      scoreBefore,
      scoreAfter,
      appealBefore,
      appealAfter,
      others: others.length,
      othersUnchanged: JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
      pending: pending.length,
      proposals: mine.length,
    });
    expect(appealAfter).toBeLessThan(appealBefore);
    expect(scoreAfter).toBeLessThan(scoreBefore);
    expect(others.length).toBeGreaterThan(0);
    expect(othersAfter).toEqual(othersBefore);
    expect(mine.length).toBe(1);
  });

  it("SC-3 the recorded model answered every request, and no live call was made", () => {
    const syntheses = model.answered.get(SYNTHESIS) ?? 0;
    measure({
      check: "model",
      requests: model.requests.length,
      syntheses,
      failures: model.failures,
    });
    expect(model.failures, model.failures.join("\n")).toEqual([]);
    expect(syntheses).toBeGreaterThanOrEqual(2);
    expect(model.requests.length).toBe(syntheses);
  });
});
