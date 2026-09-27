// BLD-8 R-52 (leaf 1.4.4 SPEC-Q-2): "Send to kitchen" publishes a day's plan (`plan.publish`,
// admin) and "Mark cooked" sets a meal's status (`plan_meal.status`, admin and kitchen). Both are
// logged change sets that undo restores; repeated or impossible changes are refused with 422;
// members cannot call them; nothing crosses households.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { generatePlan } from "@mealplanner/db/services/plans";
import { callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { acceptWithSignup, addMembers, invite, ok, signupAdmin, type Login } from "./support/world";

const DATE = "2026-12-07";
const UNPLANNED = "2026-12-20";

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };
let b: Login & { householdId: string };
let member: Login;
let kitchen: Login;
let mealId: string;
let otherMealId: string;

interface Day {
  date: string;
  status: string;
  meals: Array<{ id: string; status: string }>;
}

async function day(caller: Caller, date: string): Promise<Day | undefined> {
  return ok<{ days: Day[] }>(
    await callJson(c.plansList, { query: { from: date, to: date } }, caller),
    "plans",
  ).days[0];
}

async function plan(login: Login & { householdId: string }, date: string): Promise<string> {
  await generatePlan(
    app.rt.db,
    { householdId: login.householdId, userId: login.userId, role: "admin" },
    { dates: [date], seed: 3, by: { actor: "user", source: "ui" } },
  );
  const id = (await day(login, date))?.meals[0]?.id;
  if (id === undefined) throw new Error(`no meal planned on ${date}`);
  return id;
}

const undo = (caller: Caller, id: string) => callJson(c.changeSetsUndo, { params: { id } }, caller);

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  a = await signupAdmin("Status A");
  b = await signupAdmin("Status B");
  const { adultId } = await addMembers(a);
  await addMembers(b);
  member = await acceptWithSignup(await invite(a, "member", adultId), "Sara");
  kitchen = await acceptWithSignup(await invite(a, "kitchen", null), "Priya");
  mealId = await plan(a, DATE);
  otherMealId = await plan(b, DATE);
}, 300_000);

afterAll(async () => {
  await app.close();
  await db.drop();
}, 60_000);

describe("plan.publish (R-52)", () => {
  it("an admin sends a draft day to the kitchen; it is logged, and undo returns it to draft", async () => {
    expect((await day(a, DATE))?.status).toBe("draft");
    const r = await callJson(c.plansPublish, { params: { date: DATE } }, a);
    expect(r.status, r.text).toBe(200);
    const { changeSetId } = r.json as { changeSetId: string };
    expect((await day(a, DATE))?.status).toBe("published");
    const log = ok<{ entries: Array<{ id: string; summary: string }> }>(
      await callJson(c.changeSetsList, { query: { limit: 10 } }, a),
      "log",
    ).entries;
    expect(log.find((e) => e.id === changeSetId)?.summary).toBe(
      `Send the plan for ${DATE} to the kitchen`,
    );
    expect((await undo(a, changeSetId)).status).toBe(200);
    expect((await day(a, DATE))?.status).toBe("draft");
  });

  it("publishing twice, or a date with no plan, is refused with 422", async () => {
    expect((await callJson(c.plansPublish, { params: { date: DATE } }, a)).status).toBe(200);
    const again = await callJson(c.plansPublish, { params: { date: DATE } }, a);
    expect(again.status).toBe(422);
    expect(again.text).toMatch(/already published/);
    const none = await callJson(c.plansPublish, { params: { date: UNPLANNED } }, a);
    expect(none.status).toBe(422);
    expect(none.text).toMatch(/no plan/);
  });

  it("members and kitchen users cannot publish; another household's day is untouched", async () => {
    expect((await callJson(c.plansPublish, { params: { date: DATE } }, member)).status).toBe(403);
    expect((await callJson(c.plansPublish, { params: { date: DATE } }, kitchen)).status).toBe(403);
    expect((await day(b, DATE))?.status).toBe("draft");
  });
});

describe("plan_meal.status (R-52)", () => {
  it("the kitchen marks a meal cooked; the response carries the meal; undo restores planned", async () => {
    const r = await callJson(
      c.planMealsStatus,
      { params: { id: mealId }, body: { status: "cooked" } },
      kitchen,
    );
    expect(r.status, r.text).toBe(200);
    const body = r.json as { changeSetId: string; meal: { id: string; status: string } };
    expect(body.meal).toMatchObject({ id: mealId, status: "cooked" });
    expect((await day(a, DATE))?.meals.find((m) => m.id === mealId)?.status).toBe("cooked");
    expect((await undo(a, body.changeSetId)).status).toBe(200);
    expect((await day(a, DATE))?.meals.find((m) => m.id === mealId)?.status).toBe("planned");
  });

  it("an admin sets skipped and back to planned; the same status twice is refused with 422", async () => {
    const set = (status: string) =>
      callJson(c.planMealsStatus, { params: { id: mealId }, body: { status } }, a);
    expect((await set("skipped")).status).toBe(200);
    expect((await set("skipped")).status).toBe(422);
    expect((await set("planned")).status).toBe(200);
  });

  it("a member cannot set a status; an unknown status is a 400; another household's meal is 404", async () => {
    expect(
      (
        await callJson(
          c.planMealsStatus,
          { params: { id: mealId }, body: { status: "cooked" } },
          member,
        )
      ).status,
    ).toBe(403);
    const bad = await callJson(
      c.planMealsStatus,
      { params: { id: mealId }, rawBody: JSON.stringify({ status: "eaten" }) },
      a,
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await callJson(
          c.planMealsStatus,
          { params: { id: otherMealId }, body: { status: "cooked" } },
          a,
        )
      ).status,
    ).toBe(404);
  });
});
