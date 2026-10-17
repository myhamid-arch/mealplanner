// W-29: a household with nobody in it once got a "ready" plan with no meals. POST /plans/generate
// now answers 409 without queueing a job, and the planner itself (used by the worker and the
// assistant) refuses, saying why; nothing is saved. Negative control: the same household plans
// once a person is added.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { generatePlan, NO_PEOPLE, PlanServiceError } from "@mealplanner/db/services/plans";
import { callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { addMembers, signupAdmin, type Login } from "./support/world";

const DATE = "2026-12-07";

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  a = await signupAdmin("Empty household");
}, 300_000);

afterAll(async () => {
  await app.close();
  await db.drop();
}, 60_000);

const days = async () =>
  (
    (await callJson(c.plansList, { query: { from: DATE, to: DATE } }, a)).json as {
      days: unknown[];
    }
  ).days;

describe("W-29: no plan without people", () => {
  it("POST /plans/generate answers 409 no_people and queues nothing", async () => {
    const r = await callJson(c.plansGenerate, { body: { dates: [DATE], seed: 1 } }, a);
    expect(r.status, r.text).toBe(409);
    const problem = c.Problem.parse(r.json);
    expect(problem.code).toBe("no_people");
    expect(problem.detail ?? problem.title).toContain("Nobody to plan for yet");
  });

  it("the planner refuses with the same reason and saves no plan day", async () => {
    const ctx = { householdId: a.householdId, userId: a.userId, role: "admin" as const };
    const run = generatePlan(app.rt.db, ctx, {
      dates: [DATE],
      seed: 1,
      by: { actor: "user", source: "ui" },
    });
    await expect(run).rejects.toBeInstanceOf(PlanServiceError);
    await expect(run).rejects.toThrow(NO_PEOPLE);
    expect(await days()).toEqual([]);
  });

  it("negative control: with a person added, the same request plans meals", async () => {
    await addMembers(a);
    const ctx = { householdId: a.householdId, userId: a.userId, role: "admin" as const };
    const result = await generatePlan(app.rt.db, ctx, {
      dates: [DATE],
      seed: 1,
      by: { actor: "user", source: "ui" },
    });
    expect(result.plan.days.reduce((n, d) => n + d.meals.length, 0)).toBeGreaterThan(0);
  });
});
