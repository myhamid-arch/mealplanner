// Leaf 1.4.8 G1 (UX-4 drag to move, W-5 addendum; BLD-8 R-58, R-60): `POST /plan-meals/{id}/move`.
// A meal moves to the same slot on another draft day through `plan_meal.move`; a meal already
// there exchanges; the plates of both days are re-solved (checked against the target resolver for
// each date, independently of the move service); undo through the change log restores both days;
// a locked meal, a day sent to the kitchen or a cooked meal is refused with 409; a refusal of
// either meal by the planner refuses the whole move (422, nothing written); admin only.
// Negative control: a move that only rewrites `plan_meal.plan_day_id` (the bare op, no re-solve)
// fails the "both days solved" check. Also R-7 / R-60: `planMeals.swap` refuses an infeasible
// dish for a member in strict mode and keeps the least-bad save in flexible mode.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { resolveSlotTargets } from "@mealplanner/core/planner";
import type { HouseholdContext } from "@mealplanner/core/types";
import { generatePlan, loadPlanInput } from "@mealplanner/db/services/plans";
import { callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import {
  acceptWithSignup,
  addMembers,
  applyOps,
  invite,
  ok,
  signupAdmin,
  type Login,
} from "./support/world";

// A Monday-to-Thursday stretch, far from the other test files' dates.
const MON = "2027-03-01";
const TUE = "2027-03-02";
const WED = "2027-03-03";
const THU = "2027-03-04";
const FRI = "2027-03-05";

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };
let b: Login & { householdId: string };
let member: Login;
let kitchen: Login;
let sara: string;
let slots: Map<string, string>;

type Meal = {
  id: string;
  date: string;
  slotKey: string;
  slotTypeId: string;
  memberScope: string;
  dishId: string;
  dishName: string;
  locked: boolean;
  plates: Array<{ memberId: string; fitStatus: string; target: { kcal: number } | null }>;
};

const ctxOf = (l: Login & { householdId: string }): HouseholdContext => ({
  householdId: l.householdId,
  userId: l.userId,
  role: "admin",
});

async function days(from: string, to: string, who: Login = a) {
  return ok<{ days: Array<{ date: string; status: string; meals: Meal[] }> }>(
    await callJson(c.plansList, { query: { from, to } }, who),
    "plans",
  ).days;
}

async function mealAt(date: string, slotKey: string, scope = "shared"): Promise<Meal> {
  const m = (await days(date, date))[0]?.meals.find(
    (x) => x.slotKey === slotKey && x.memberScope === scope,
  );
  if (m === undefined) throw new Error(`no ${slotKey} (${scope}) on ${date}`);
  return m;
}

const move = (id: string, toDate: string, who: Login = a) =>
  callJson(c.planMealsMove, { params: { id }, body: { toDate } }, who);

/** Every row of the plan tables of household A, for "nothing written" comparisons. */
async function planRows(householdId = a.householdId): Promise<string> {
  const rows = await app.rt.db.execute(
    sql`SELECT 'meal' AS t, pm.id::text, pm.plan_day_id::text AS day, pm.dish_id::text AS dish, pm.score_breakdown::text AS x
          FROM plan_meal pm WHERE pm.household_id = ${householdId}
        UNION ALL
        SELECT 'plate', p.id::text, p.plan_meal_id::text, p.member_id::text, p.target::text || p.actual::text
          FROM plate p WHERE p.household_id = ${householdId}
        ORDER BY 1, 2`,
  );
  return JSON.stringify(rows.rows);
}

/**
 * Independently of the move service: every targeted plate on `dates` was solved for its meal's
 * date. Its resolver target is the target resolver's own target for that member, date and slot,
 * and the target it was solved against is for that date. Returns what is wrong (empty when solved).
 */
async function unsolved(dates: readonly string[], who = a): Promise<string[]> {
  const { input, stored } = await loadPlanInput(app.rt.db, ctxOf(who), { dates });
  const out: string[] = [];
  for (const date of dates) {
    const want = resolveSlotTargets(input.config, date);
    for (const meal of stored.filter((m) => m.date === date))
      for (const p of meal.plates.filter((x) => x.targeted)) {
        const r = want.find((t) => t.memberId === p.memberId && t.slotTypeId === meal.slotTypeId);
        const got = p.resolverTarget;
        const where = `${date} ${meal.slotKey} ${p.memberId}`;
        if (r === undefined) out.push(`${where}: the member does not attend this slot that day`);
        else if (got === null) out.push(`${where}: no resolver target`);
        else if (got.date !== date || p.target?.date !== date)
          out.push(`${where}: solved for ${got.date}`);
        else if (
          got.kcal !== r.kcal ||
          got.protein !== r.protein ||
          got.carbs !== r.carbs ||
          got.fat !== r.fat ||
          got.dayKind !== r.dayKind
        )
          out.push(
            `${where}: target ${JSON.stringify(got)} is not the resolver's ${JSON.stringify(r)}`,
          );
      }
  }
  return out;
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  a = await signupAdmin("Move A");
  b = await signupAdmin("Move B");
  ({ adultId: sara } = await addMembers(a));
  await addMembers(b);
  member = await acceptWithSignup(await invite(a, "member", null), "Layla");
  kitchen = await acceptWithSignup(await invite(a, "kitchen", null), "Priya");
  slots = new Map(
    ok<{ slots: Array<{ id: string; key: string }> }>(
      await callJson(c.slotsList, {}, a),
      "slots",
    ).slots.map((s) => [s.key, s.id]),
  );
  // Sara trains on Monday and Thursday only: those days have her pre-workout meal.
  await applyOps(
    a,
    [MON, THU].map((date) => ({
      kind: "day_override.set",
      payload: { memberId: sara, date, kind: "training", active: true },
    })),
  );
  for (const who of [a, b])
    await generatePlan(app.rt.db, ctxOf(who), {
      dates: [MON, TUE, WED, THU, FRI],
      seed: 3,
      by: { actor: "user", source: "ui" },
    });
}, 600_000);

afterAll(async () => {
  await app.close();
  await db.drop();
}, 60_000);

describe("POST /plan-meals/{id}/move (G1)", () => {
  it("the generated days start solved (the check's baseline)", async () => {
    expect(await unsolved([MON, TUE, WED, THU, FRI])).toEqual([]);
  });

  it("onto an occupied slot the two meals exchange; both days are re-solved", async () => {
    const mon = await mealAt(MON, "dinner");
    const tue = await mealAt(TUE, "dinner");
    const r = await move(mon.id, TUE);
    expect(r.status, r.text).toBe(200);
    const body = r.json as { changeSetId: string; meals: Meal[] };
    expect(body.meals.map((m) => [m.id, m.date, m.dishId])).toEqual([
      [mon.id, TUE, mon.dishId],
      [tue.id, MON, tue.dishId],
    ]);
    expect((await mealAt(TUE, "dinner")).dishId).toBe(mon.dishId);
    expect((await mealAt(MON, "dinner")).dishId).toBe(tue.dishId);
    expect(await unsolved([MON, TUE])).toEqual([]);
    const entry = ok<{ forward: Array<{ kind: string }> }>(
      await callJson(c.changeSetsGet, { params: { id: body.changeSetId } }, a),
      "change set",
    );
    expect(entry.forward[0]?.kind).toBe("plan_meal.move");
    expect(entry.forward.filter((o) => o.kind === "plan.swap_dish").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("undo through the change log puts both days back exactly", async () => {
    const before = await planRows();
    const wed = await mealAt(WED, "lunch");
    const r = await move(wed.id, TUE);
    expect(r.status, r.text).toBe(200);
    expect(await planRows()).not.toBe(before);
    const undo = await callJson(
      c.changeSetsUndo,
      { params: { id: (r.json as { changeSetId: string }).changeSetId } },
      a,
    );
    expect(undo.status, undo.text).toBeLessThan(300);
    expect(await planRows()).toBe(before);
    expect(await unsolved([TUE, WED])).toEqual([]);
  });

  it("onto an empty slot the meal moves and the source slot is left empty", async () => {
    // Sara's pre-workout is on Monday; Wednesday becomes a training day after it was planned.
    await applyOps(a, [
      {
        kind: "day_override.set",
        payload: { memberId: sara, date: WED, kind: "training", active: true },
      },
    ]);
    const pre = await mealAt(MON, "pre_workout", sara);
    expect((await days(WED, WED))[0]?.meals.some((m) => m.slotKey === "pre_workout")).toBe(false);
    const r = await move(pre.id, WED);
    expect(r.status, r.text).toBe(200);
    expect((await mealAt(WED, "pre_workout", sara)).id).toBe(pre.id);
    expect((await days(MON, MON))[0]?.meals.some((m) => m.slotKey === "pre_workout")).toBe(false);
    // Wednesday's other meals were re-solved for a training day with a pre-workout slot.
    expect(await unsolved([MON, WED])).toEqual([]);
  });

  it("a locked meal or a locked occupant is refused with 409", async () => {
    const thu = await mealAt(THU, "breakfast");
    const fri = await mealAt(FRI, "breakfast");
    ok(await callJson(c.planMealsLock, { params: { id: thu.id } }, a), "lock");
    const before = await planRows();
    const own = await move(thu.id, FRI);
    expect(own.status, own.text).toBe(409);
    const occ = await move(fri.id, THU);
    expect(occ.status, occ.text).toBe(409);
    expect(await planRows()).toBe(before);
    ok(await callJson(c.planMealsUnlock, { params: { id: thu.id } }, a), "unlock");
  });

  it("a day sent to the kitchen, or a cooked meal, is refused with 409", async () => {
    const before = await planRows();
    ok(await callJson(c.plansPublish, { params: { date: FRI } }, a), "publish");
    const lunch = await mealAt(THU, "lunch");
    const toSent = await move(lunch.id, FRI);
    expect(toSent.status, toSent.text).toBe(409);
    const fromSent = await move((await mealAt(FRI, "lunch")).id, THU);
    expect(fromSent.status, fromSent.text).toBe(409);
    ok(
      await callJson(
        c.planMealsStatus,
        { params: { id: lunch.id }, body: { status: "cooked" } },
        a,
      ),
      "cooked",
    );
    const cooked = await move(lunch.id, TUE);
    expect(cooked.status, cooked.text).toBe(409);
    ok(
      await callJson(
        c.planMealsStatus,
        { params: { id: lunch.id }, body: { status: "planned" } },
        a,
      ),
      "planned",
    );
    // Undo the publish through the change log (its latest entry) to keep Friday a draft.
    const log = ok<{ entries: Array<{ id: string; summary: string }> }>(
      await callJson(c.changeSetsList, { query: { limit: 5 } }, a),
      "log",
    ).entries;
    const publish = log.find((e) => e.summary.toLowerCase().includes("kitchen"));
    if (publish === undefined) throw new Error("no publish entry");
    ok(await callJson(c.changeSetsUndo, { params: { id: publish.id } }, a), "undo publish");
    expect(await planRows()).toBe(before);
  });

  it("the same date, a date without a plan, or an occupant the planner refuses: 422, nothing written", async () => {
    const before = await planRows();
    const tue = await mealAt(TUE, "snack", sara);
    const same = await move(tue.id, TUE);
    expect(same.status, same.text).toBe(422);
    const none = await move(tue.id, "2027-03-20");
    expect(none.status, none.text).toBe(422);
    // Thursday's pre-workout onto Wednesday exchanges with Wednesday's (moved there above); Sara
    // no longer attends pre-workout on Thursday, so the occupant is refused there (R-60).
    await applyOps(a, [
      {
        kind: "day_override.set",
        payload: {
          memberId: sara,
          date: THU,
          kind: "absent_slot",
          slotTypeId: slots.get("pre_workout"),
          active: true,
        },
      },
    ]);
    const afterOverride = await planRows();
    const thuPre = await mealAt(THU, "pre_workout", sara);
    const refused = await move(thuPre.id, WED);
    expect(refused.status, refused.text).toBe(422);
    expect(refused.text).toMatch(/pre-workout on 2027-03-04/i);
    expect(await planRows()).toBe(afterOverride);
    expect(afterOverride).toBe(before);
  });

  it("admins only: a member or kitchen login gets 403; another household's meal is 404", async () => {
    const mon = await mealAt(MON, "lunch");
    expect((await move(mon.id, TUE, member)).status).toBe(403);
    expect((await move(mon.id, TUE, kitchen)).status).toBe(403);
    const other = await move(mon.id, TUE, b);
    expect(other.status, other.text).toBe(404);
    const theirs = (await days(MON, MON, b))[0]?.meals.find((m) => m.slotKey === "lunch");
    if (theirs === undefined) throw new Error("no lunch in household B");
    expect((await move(theirs.id, TUE, a)).status).toBe(404);
  });

  it("negative control: the bare op without the re-solve leaves the days unsolved", async () => {
    const wed = await mealAt(WED, "dinner");
    await applyOps(a, [{ kind: "plan_meal.move", payload: { planMealId: wed.id, toDate: TUE } }]);
    const found = await unsolved([TUE, WED]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.includes("solved for 2027-03-03"))).toBe(true);
  });
});

describe("planMeals.swap refuses an infeasible dish in strict mode (R-7, R-60)", () => {
  // Household B: Sara's target is set out of reach, so every dinner is infeasible for her.
  let dinner: Meal;
  let dishId: string;
  let bSara: string;
  beforeAll(async () => {
    dinner = (await days(TUE, TUE, b))[0]?.meals.find((m) => m.slotKey === "dinner") as Meal;
    bSara = dinner.plates.find((p) => p.target !== null)?.memberId ?? "";
    const alts = ok<{ alternatives: Array<{ dishId: string }> }>(
      await callJson(c.planMealsAlternatives, { params: { id: dinner.id } }, b),
      "alternatives",
    ).alternatives;
    dishId = alts[0]?.dishId ?? "";
    await applyOps(b, [
      {
        kind: "target.set",
        payload: {
          memberId: bSara,
          kind: "default",
          profile: { kcal: 9000, proteinG: 900, carbsG: 900, fatG: 300 },
        },
      },
    ]);
  }, 300_000);

  it("strict: 422 naming the member, the macro and the amount; nothing written", async () => {
    const before = await planRows(b.householdId);
    const r = await callJson(c.planMealsSwap, { params: { id: dinner.id }, body: { dishId } }, b);
    expect(r.status, r.text).toBe(422);
    expect(r.text).toMatch(/Sara's dinner would miss (protein|carbs|fat|calories) by \d+/);
    expect(await planRows(b.householdId)).toBe(before);
  });

  it("flexible: the least-bad plate is saved as a flexible miss", async () => {
    await applyOps(b, [{ kind: "tolerance.set", payload: { memberId: bSara, mode: "flexible" } }]);
    const r = await callJson(c.planMealsSwap, { params: { id: dinner.id }, body: { dishId } }, b);
    expect(r.status, r.text).toBe(200);
    const meal = (r.json as { meal: Meal }).meal;
    expect(meal.dishId).toBe(dishId);
    expect(meal.plates.find((p) => p.memberId === bSara)?.fitStatus).toBe("flexible_miss");
  });
});
