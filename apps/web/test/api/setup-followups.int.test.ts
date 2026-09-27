// G3 (R2-ONB-6; BLD-8 R-55, R-56; leaf-1.4.7 SPEC-Q-8 … 11): the first-days follow-ups through the
// real routes. Household A is set up from the F1 answers with 1.4.3's `inferSetup` and one change
// set, as the onboarding page does. Only the unsettled items are proposed, one card a day, answers
// and dismissals persist (and answers change the configuration as one change set), and the
// "Getting set up" checklist counts progress. A day passing is simulated by moving the stored
// resolution back one day.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import {
  inferSetup,
  parseNeverEat,
  parsePeople,
  parseTargets,
  type OnboardingAnswers,
} from "@mealplanner/core/onboarding";
import { changeSet, newId, setupFollowup } from "@mealplanner/db/schema";
import { generatePlan } from "@mealplanner/db/services/plans";
import { callJson, type Caller, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { acceptWithSignup, invite, ok, signupAdmin, type Login } from "./support/world";

type Followups = ReturnType<typeof c.SetupFollowupsDto.parse>;

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };
let b: Login & { householdId: string };
let members: { name: string; id: string }[] = [];

const F1_TEXT = {
  people: "Adult A 40, Adult B 37, Child C1 18 F, Child C2 15 M, Child C3 10 M",
  targets: {
    "Adult A":
      "2150 cal, 180p 200c 70f, sat fat 22 g, soluble fibre 10 g. Training days: 2390 / 180 / 260 / 70",
    "Adult B": "1655 / 130 / 160 / 55, sat fat max 18 g",
  },
  neverEat: "Child C3 is allergic to sesame.",
};

function f1Answers(): OnboardingAnswers {
  const people = parsePeople(F1_TEXT.people);
  return {
    people,
    targets: Object.entries(F1_TEXT.targets).map(([person, raw]) => {
      const p = parseTargets(raw);
      if (!p.ok) throw new Error(p.reason);
      return { person, numbers: p.value };
    }),
    week: {
      school: { people: ["Child C1", "Child C2", "Child C3"], weekdays: [0, 1, 2, 3, 4] },
      work: { people: ["Adult A"], weekdays: [0, 1, 2, 3, 4] },
      training: [
        { person: "Adult A", weekdays: [0, 2, 4], time: "evening" },
        { person: "Adult B", weekdays: [1, 3, 5], time: "morning" },
      ],
      snacks: true,
    },
    cuisines: ["italian", "levantine", "american", "british", "indian"],
    neverEat: parseNeverEat(
      F1_TEXT.neverEat,
      people.map((p) => p.name),
    ),
  };
}

/** Onboards a household from the F1 answers, as the onboarding page does. */
async function onboardF1(admin: Caller) {
  const [slots, cuisines, ingredients, household] = await Promise.all([
    callJson(c.slotsList, {}, admin),
    callJson(c.cuisinesList, {}, admin),
    callJson(c.ingredientsList, { query: { limit: 500 } }, admin),
    callJson(c.householdGet, {}, admin),
  ]);
  const setup = inferSetup(f1Answers(), {
    referenceYear: 2026,
    adminName: "Adult A",
    slots: ok<{ slots: never[] }>(slots, "slots").slots,
    cuisines: ok<{ cuisines: never[] }>(cuisines, "cuisines").cuisines,
    ingredients: ok<{ ingredients: never[] }>(ingredients, "ingredients").ingredients,
    satFatDefaultPct: ok<{ satFatDefaultPct: number }>(household, "household").satFatDefaultPct,
    newId,
  });
  ok(
    await callJson(
      c.changeSetsApply,
      { body: { summary: "Household set up from onboarding", ops: setup.changeOps } },
      admin,
    ),
    "apply",
  );
  return setup.members;
}

const id = (name: string) => {
  const m = members.find((x) => x.name === name);
  if (m === undefined) throw new Error(`no member ${name}`);
  return m.id;
};

async function get(caller: Caller = a): Promise<Followups> {
  return c.SetupFollowupsDto.parse(ok(await callJson(c.setupFollowupsGet, {}, caller), "get"));
}
const answer = (key: string, choice: string, caller: Caller = a) =>
  callJson(c.setupFollowupsAnswer, { params: { key }, body: { choice } }, caller);
const dismiss = (key: string, caller: Caller = a) =>
  callJson(c.setupFollowupsDismiss, { params: { key } }, caller);

/** A day passes: every stored answer or dismissal of the household moves back one day. */
async function nextDay(householdId: string) {
  await app.rt.db
    .update(setupFollowup)
    .set({ resolvedAt: sql`${setupFollowup.resolvedAt} - interval '1 day'` })
    .where(eq(setupFollowup.householdId, householdId));
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  a = await signupAdmin("Household A");
  b = await signupAdmin("Household B");
  members = await onboardF1(a);
  await onboardF1(b);
}, 300_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe("G3 first-days follow-ups (R2-ONB-6)", () => {
  it("G3 the F1 answers leave exactly three follow-ups open: nut-free school, dinner time, Adult B's training energy", async () => {
    const f = await get();
    expect(f.card?.key).toBe("school_nut_free");
    expect(f.card?.question).toBe(
      "Is the school nut-free? I'll keep nuts out of Child C1, Child C2 and Child C3's meals.",
    );
    expect(f.upcoming.map((u) => u.key)).toEqual(["dinner_time", `training_kcal:${id("Adult B")}`]);
    expect([f.position, f.total, f.day]).toEqual([1, 3, 1]);
    // Negative control: Adult A answered training-day numbers, so their question never appears.
    expect([f.card?.key, ...f.upcoming.map((u) => u.key)]).not.toContain(
      `training_kcal:${id("Adult A")}`,
    );
  }, 60_000);

  it("G3 only today's card can be answered; a bad choice or an unknown key is refused", async () => {
    const early = await answer("dinner_time", "yes");
    expect([early.status, c.Problem.parse(early.json).code]).toEqual([409, "not_todays_question"]);
    const bad = await answer("school_nut_free", "maybe");
    expect([bad.status, c.Problem.parse(bad.json).code]).toEqual([422, "invalid_choice"]);
    expect((await answer("birthday_cake", "yes")).status).toBe(404);
    expect((await get()).card?.key).toBe("school_nut_free");
  }, 60_000);

  it("G3 yes, nut-free: one change set adds the school children's nut exclusions; no second card today", async () => {
    const r = await answer("school_nut_free", "yes");
    expect(r.status).toBe(200);
    const body = c.FollowupAnswerDto.parse(r.json);
    expect(body.changeSetId).not.toBeNull();
    const [cs] = await app.rt.db
      .select()
      .from(changeSet)
      .where(eq(changeSet.id, body.changeSetId ?? ""));
    expect([cs?.actor, cs?.source, cs?.householdId]).toEqual(["user", "ui", a.householdId]);
    const exclusions = ok<{ exclusions: { memberId: string | null; kind: string; key: string }[] }>(
      await callJson(c.exclusionsList, {}, a),
      "exclusions",
    ).exclusions.filter((e) => e.key === "contains_nuts");
    expect(exclusions.map((e) => [e.memberId, e.kind]).sort()).toEqual(
      ["Child C1", "Child C2", "Child C3"].map((n) => [id(n), "dietary_flag"]).sort(),
    );
    // At most one a day.
    expect(body.followups.card).toBeNull();
    expect([body.followups.position, body.followups.total]).toEqual([1, 3]);
    const again = await answer("school_nut_free", "no");
    expect([again.status, c.Problem.parse(again.json).code]).toEqual([409, "already_answered"]);
  }, 60_000);

  it("G3 answers persist: the next day brings the next card, and the settled question stays gone", async () => {
    await nextDay(a.householdId);
    const f = await get();
    expect(f.card?.key).toBe("dinner_time");
    expect([f.position, f.total]).toEqual([2, 3]);
    const [row] = await app.rt.db
      .select()
      .from(setupFollowup)
      .where(
        and(eq(setupFollowup.householdId, a.householdId), eq(setupFollowup.key, "school_nut_free")),
      );
    expect([row?.status, row?.choice]).toEqual(["answered", "yes"]);
  }, 60_000);

  it("G3 Not sure · Ask me later: dismissed today, it returns after the others", async () => {
    const r = await dismiss("dinner_time");
    expect(r.status).toBe(200);
    expect(c.SetupFollowupsDto.parse(r.json).card).toBeNull();
    await nextDay(a.householdId);
    const f = await get();
    expect(f.card?.key).toBe(`training_kcal:${id("Adult B")}`);
    expect(f.upcoming.map((u) => u.key)).toEqual(["dinner_time"]);
    // Go up records the answer, changes nothing, and points to the training-day numbers.
    const up = c.FollowupAnswerDto.parse(
      ok(await answer(`training_kcal:${id("Adult B")}`, "up"), "answer"),
    );
    expect(up.changeSetId).toBeNull();
    expect(up.then).toEqual({
      label: "Set the training-day numbers",
      href: `/family/${id("Adult B")}#training`,
    });
    await nextDay(a.householdId);
    expect((await get()).card?.key).toBe("dinner_time");
  }, 60_000);

  it("G3 a dinner time choice moves the dinner slot, and the last question closes the queue", async () => {
    const r = c.FollowupAnswerDto.parse(ok(await answer("dinner_time", "20:00"), "answer"));
    expect(r.changeSetId).not.toBeNull();
    const slots = ok<{ slots: { key: string; defaultTime: string }[] }>(
      await callJson(c.slotsList, {}, a),
      "slots",
    ).slots;
    expect(slots.find((s) => s.key === "dinner")?.defaultTime.slice(0, 5)).toBe("20:00");
    await nextDay(a.householdId);
    const f = await get();
    expect(f.card).toBeNull();
    expect([f.position, f.total, f.upcoming.length]).toEqual([3, 3, 0]);
    expect(f.checklist.items.find((i) => i.key === "questions")).toEqual({
      key: "questions",
      label: "Answer 3 optional questions",
      done: true,
    });
  }, 60_000);

  it("G3 the checklist counts progress from the household's data", async () => {
    const before = (await get(b)).checklist;
    expect(before.items.map((i) => [i.key, i.done])).toEqual([
      ["family", true],
      ["first_plan", false],
      ["kitchen", false],
      ["rate", false],
      ["invite_family", false],
      ["questions", false],
    ]);
    expect([before.done, before.total]).toEqual([1, 6]);
    await generatePlan(
      app.rt.db,
      { householdId: b.householdId, userId: b.userId, role: "admin" },
      { dates: ["2026-11-02"], seed: 1, by: { actor: "user", source: "ui" } },
    );
    await invite(b, "kitchen", null);
    const kitchen = await acceptWithSignup(await invite(b, "kitchen", null), "Cook");
    await invite(b, "member", null);
    const plans = ok<{ days: { meals: { dishId: string }[] }[] }>(
      await callJson(c.plansList, { query: { from: "2026-11-02", to: "2026-11-02" } }, b),
      "plans",
    );
    const dishes = [...new Set(plans.days.flatMap((d) => d.meals.map((m) => m.dishId)))].slice(
      0,
      3,
    );
    expect(dishes).toHaveLength(3);
    for (const dishId of dishes)
      ok(
        await callJson(
          c.reviewsCreate,
          { body: { targetType: "dish", targetId: dishId, rating: 4, tags: [] } },
          b,
        ),
        "review",
      );
    const after = (await get(b)).checklist;
    expect(after.items.map((i) => [i.key, i.done])).toEqual([
      ["family", true],
      ["first_plan", true],
      ["kitchen", true],
      ["rate", true],
      ["invite_family", true],
      ["questions", false],
    ]);
    expect([after.done, after.total]).toEqual([5, 6]);
    // Kitchen logins cannot read or answer follow-ups (admin only).
    expect((await callJson(c.setupFollowupsGet, {}, kitchen)).status).toBe(403);
  }, 300_000);

  it("G3 households are separate: A's answers do not settle B's questions", async () => {
    const f = await get(b);
    expect(f.card?.key).toBe("school_nut_free");
    const rows = await app.rt.db
      .select()
      .from(setupFollowup)
      .where(eq(setupFollowup.householdId, b.householdId));
    expect(rows).toEqual([]);
  }, 60_000);

  it("G3 a member login gets 403", async () => {
    const m = await acceptWithSignup(await invite(a, "member", id("Adult B")), "Adult B");
    expect((await callJson(c.setupFollowupsGet, {}, m)).status).toBe(403);
    expect((await answer("dinner_time", "yes", m)).status).toBe(403);
    expect((await dismiss("dinner_time", m)).status).toBe(403);
  }, 60_000);
});
