// One valid call per endpoint (G1): given the test world and the role making the call, the input
// (and, for account, platform and destructive endpoints, the caller) of a request that must succeed.
// Destructive calls act on resources made for the call (a fresh login, invite, household, plan
// day), so the calls can run in any order and the shared world stays intact.
import * as c from "@mealplanner/api-contract/contract";
import { createProposals } from "@mealplanner/db/services/proposals";
import { generatePlan } from "@mealplanner/db/services/plans";
import type { HouseholdRole } from "@mealplanner/core/types";
import { ANON, callJson, type CallInput, type Caller, type TestApp } from "./app";
import { secretOf, totpCode } from "./totp";
import {
  acceptWithSignup,
  applyOps,
  invite,
  ok,
  operatorLogin,
  signupAdmin,
  type Login,
  type World,
} from "./world";

export interface CaseArgs {
  app: TestApp;
  w: World;
  /** The household role making the call (household endpoints). */
  who: HouseholdRole;
}

export interface Valid {
  input: CallInput;
  /** The caller; household endpoints default to the world's login of role `who` in household A. */
  caller?: Caller;
}

export type Case = (args: CaseArgs) => Promise<Valid> | Valid;

export function loginOf(w: World, who: HouseholdRole): Login {
  if (who === "admin") return w.a.admin;
  if (who === "member") return w.a.member;
  return w.a.kitchen;
}

/** A new login in household A (for block, remove, role and session endpoints). */
async function freshLogin(w: World, role: HouseholdRole = "member"): Promise<Login> {
  return acceptWithSignup(await invite(w.a.admin, role, null), "Fresh");
}

let dayOffset = 0;
/** A new generated plan day in household A (for swap, lock and override). */
async function freshMeal(app: TestApp, w: World) {
  dayOffset += 1;
  const date = new Date(Date.UTC(2026, 11, dayOffset)).toISOString().slice(0, 10);
  await generatePlan(
    app.rt.db,
    { householdId: w.a.id, userId: w.a.admin.userId, role: "admin" },
    { dates: [date], seed: 1, by: { actor: "user", source: "ui" } },
  );
  const plans = ok<{
    days: Array<{
      meals: Array<{
        id: string;
        dishId: string;
        plates: Array<{
          id: string;
          items: Array<{ componentId: string; variantId: string; cookedG: number }>;
        }>;
      }>;
    }>;
  }>(await callJson(c.plansList, { query: { from: date, to: date } }, w.a.admin), "plans");
  const meal = plans.days[0]?.meals.find((m) => m.plates.length > 0);
  if (meal === undefined) throw new Error(`no meal on ${date}`);
  return { date, meal };
}

async function freshReview(caller: Caller, w: World, who: HouseholdRole) {
  const body =
    who === "kitchen"
      ? { targetType: "ingredient", targetId: w.a.ingredientId, tags: ["ingredient_unavailable"] }
      : { targetType: "dish", targetId: w.a.dishId, rating: 3, tags: [] };
  return ok<{ id: string }>(await callJson(c.reviewsCreate, { body }, caller), "review").id;
}

async function freshProposal(app: TestApp, w: World): Promise<string> {
  const ctx = { householdId: w.a.id, userId: w.a.admin.userId, role: "admin" as const };
  const cuisines = ok<{ cuisines: Array<{ key: string }> }>(
    await callJson(c.cuisinesList, {}, w.a.admin),
    "cuisines",
  ).cuisines;
  dayOffset += 1;
  const key = cuisines[dayOffset % cuisines.length]?.key ?? "levantine";
  // Proposals are de-duplicated by op kind and key: each fresh one names another cuisine.
  const r = await createProposals(app.rt.db, ctx, [
    {
      origin: "rule",
      title: `Prefer ${key}`,
      rationale: "test",
      ops: [
        {
          kind: "preference.set",
          payload: {
            memberId: w.a.childId,
            entityType: "cuisine",
            entityKey: key,
            score: 0.3,
            source: "proposal",
            locked: false,
            hard: "none",
          },
        },
      ],
      evidence: { reviewIds: [], count: 1, metrics: {} },
      priority: 3,
    },
  ]);
  const id = r.stored[0]?.id;
  if (id === undefined) throw new Error(`proposal not stored: ${JSON.stringify(r)}`);
  return id;
}

async function freshUser(): Promise<Login & { householdId: string }> {
  return signupAdmin("Fresh household");
}

const preference = (w: World, who: HouseholdRole) => ({
  memberId: who === "admin" ? w.a.childId : w.a.adultId,
  entityType: "cuisine" as const,
  entityKey: "levantine",
});

export const CASES: Record<string, Case> = {
  // Auth and account
  "auth.signup": () => ({
    caller: ANON,
    input: {
      body: {
        email: `signup-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.test`,
        password: "correct horse battery",
        name: "New",
        householdName: "New household",
      },
    },
  }),
  "auth.me": async () => ({ caller: await freshUser(), input: {} }),
  "account.get": async () => ({ caller: await freshUser(), input: {} }),
  "account.update": async () => ({
    caller: await freshUser(),
    input: { body: { name: "Renamed" } },
  }),
  "account.password": async () => {
    const u = await freshUser();
    return {
      caller: u,
      input: { body: { currentPassword: u.password, newPassword: "a brand new passphrase" } },
    };
  },
  "account.sessions": async () => ({ caller: await freshUser(), input: {} }),
  "account.sessionRevoke": async () => {
    const u = await freshUser();
    const list = ok<{ sessions: Array<{ id: string }> }>(
      await callJson(c.accountSessions, {}, u),
      "sessions",
    );
    const id = list.sessions[0]?.id;
    if (id === undefined) throw new Error("no session");
    return { caller: u, input: { params: { id } } };
  },
  "account.totpEnable": async () => {
    const u = await freshUser();
    return { caller: u, input: { body: { password: u.password } } };
  },
  "account.totpVerify": async () => {
    const u = await freshUser();
    const en = ok<{ totpUri: string }>(
      await callJson(c.accountTotpEnable, { body: { password: u.password } }, u),
      "totp enable",
    );
    return { caller: u, input: { body: { code: totpCode(secretOf(en.totpUri)) } } };
  },
  "account.totpDisable": async () => {
    const u = await freshUser();
    const en = ok<{ totpUri: string }>(
      await callJson(c.accountTotpEnable, { body: { password: u.password } }, u),
      "totp enable",
    );
    const verified = ok<{ token: string | null }>(
      await callJson(c.accountTotpVerify, { body: { code: totpCode(secretOf(en.totpUri)) } }, u),
      "totp verify",
    );
    // Enabling two-step sign-in replaced the session.
    if (verified.token === null) throw new Error("no replacement token");
    return { caller: { ...u, token: verified.token }, input: { body: { password: u.password } } };
  },
  "account.notifications": async () => ({ caller: await freshUser(), input: {} }),
  "account.notificationsSet": async () => ({
    caller: await freshUser(),
    input: { body: { notifications: [] } },
  }),
  "account.delete": async ({ w }) => {
    const u = await freshLogin(w);
    return { caller: u, input: { body: { password: u.password } } };
  },

  // Invites and access
  "invites.list": () => ({ input: {} }),
  "invites.create": () => ({
    input: { body: { role: "member", memberId: null, expiresIn: "24h", channel: "link" } },
  }),
  "invites.resend": async ({ w }) => {
    const r = ok<{ id: string }>(
      await callJson(c.invitesCreate, { body: { role: "kitchen" } }, w.a.admin),
      "invite",
    );
    return { input: { params: { id: r.id }, body: { channel: "link" } } };
  },
  "invites.revoke": async ({ w }) => {
    const r = ok<{ id: string }>(
      await callJson(c.invitesCreate, { body: { role: "kitchen" } }, w.a.admin),
      "invite",
    );
    return { input: { params: { id: r.id } } };
  },
  "invites.lookup": async ({ w }) => ({
    caller: ANON,
    input: { params: { code: await invite(w.a.admin, "member", null) } },
  }),
  "invites.accept": async ({ w }) => ({
    caller: ANON,
    input: {
      body: {
        code: await invite(w.a.admin, "member", null),
        signup: {
          email: `accept-${String(Math.random()).slice(2, 10)}@example.test`,
          password: "accepting horse battery",
          name: "Accepted",
        },
      },
    },
  }),
  "access.list": () => ({ input: {} }),
  "access.role": async ({ w }) => ({
    input: { params: { userId: (await freshLogin(w)).userId }, body: { role: "kitchen" } },
  }),
  "access.block": async ({ w }) => ({
    input: { params: { userId: (await freshLogin(w)).userId }, body: { reason: "test" } },
  }),
  "access.unblock": async ({ w }) => {
    const l = await freshLogin(w);
    ok(
      await callJson(c.accessBlock, { params: { userId: l.userId }, body: {} }, w.a.admin),
      "block",
    );
    return { input: { params: { userId: l.userId } } };
  },
  "access.remove": async ({ w }) => ({
    input: { params: { userId: (await freshLogin(w)).userId }, body: {} },
  }),
  "access.linkMember": async ({ w }) => ({
    input: { params: { userId: (await freshLogin(w)).userId }, body: { memberId: w.a.childId } },
  }),
  "access.passwordReset": async ({ w }) => ({
    input: { params: { userId: (await freshLogin(w)).userId } },
  }),
  "access.signOutAll": async ({ w }) => ({
    input: { params: { userId: (await freshLogin(w)).userId } },
  }),

  // Household
  "households.current": () => ({ input: {} }),
  "households.export": () => ({ input: {} }),
  "households.exportCsv": () => ({ input: { params: { table: "member" } } }),
  "households.deletion": () => ({ input: {} }),
  "households.deletionRequest": async () => ({ caller: await freshUser(), input: {} }),
  "households.deletionConfirm": async () => {
    const first = await freshUser();
    const second = await acceptWithSignup(await invite(first, "admin", null), "Second");
    ok(await callJson(c.householdDeletionRequest, {}, first), "deletion request");
    return { caller: second, input: {} };
  },
  "households.deletionCancel": async () => {
    const first = await freshUser();
    ok(await callJson(c.householdDeletionRequest, {}, first), "deletion request");
    return { caller: first, input: {} };
  },
  "supportGrants.list": () => ({ input: {} }),
  "supportGrants.create": async ({ app }) => ({
    input: { body: { operatorEmail: (await operatorLogin(app)).email, hours: 2 } },
  }),
  "supportGrants.revoke": async ({ app, w }) => {
    const op = await operatorLogin(app);
    const g = ok<{ id: string }>(
      await callJson(
        c.supportGrantsCreate,
        { body: { operatorEmail: op.email, hours: 1 } },
        w.a.admin,
      ),
      "grant",
    );
    return { input: { params: { id: g.id } } };
  },

  // Configuration reads
  "members.list": () => ({ input: {} }),
  "members.get": ({ w }) => ({ input: { params: { id: w.a.adultId } } }),
  "targets.list": () => ({ input: {} }),
  "slots.list": () => ({ input: {} }),
  "schedules.get": () => ({ input: {} }),
  "weights.get": () => ({ input: {} }),
  "presets.list": () => ({ input: {} }),
  "exclusions.list": () => ({ input: {} }),
  "frequencyRules.list": () => ({ input: {} }),
  "mealOverrides.list": () => ({ input: {} }),

  // Catalogue
  "dishes.list": () => ({ input: { query: { status: "active" } } }),
  "dishes.get": ({ w }) => ({ input: { params: { id: w.a.ownDishId } } }),
  "ingredients.list": () => ({ input: { query: { limit: 5 } } }),
  "ingredients.get": ({ w }) => ({ input: { params: { id: w.a.ownIngredientId } } }),
  "cuisines.list": () => ({ input: {} }),
  "methods.list": () => ({ input: {} }),

  // Plans
  "plans.list": () => ({ input: { query: { from: "2026-11-02", to: "2026-11-02" } } }),
  "plans.generate": () => ({ input: { body: { dates: ["2026-11-03"], seed: 2 } } }),
  "planMeals.get": ({ w }) => ({ input: { params: { id: w.a.planMealId } } }),
  "planMeals.alternatives": ({ w }) => ({ input: { params: { id: w.a.planMealId } } }),
  "planMeals.swap": async ({ app, w }) => {
    const { meal } = await freshMeal(app, w);
    const alts = ok<{ alternatives: Array<{ dishId: string }> }>(
      await callJson(c.planMealsAlternatives, { params: { id: meal.id } }, w.a.admin),
      "alternatives",
    );
    const dishId = alts.alternatives[0]?.dishId;
    if (dishId === undefined) throw new Error("no alternative");
    return { input: { params: { id: meal.id }, body: { dishId } } };
  },
  "planMeals.lock": async ({ app, w }) => ({
    input: { params: { id: (await freshMeal(app, w)).meal.id } },
  }),
  "planMeals.unlock": async ({ app, w }) => {
    const { meal } = await freshMeal(app, w);
    ok(await callJson(c.planMealsLock, { params: { id: meal.id } }, w.a.admin), "lock");
    return { input: { params: { id: meal.id } } };
  },
  "plates.get": ({ w, who }) => ({
    input: { params: { id: who === "member" ? (w.a.ownPlateId ?? "") : w.a.plateId } },
  }),
  "plates.override": async ({ app, w }) => {
    const { meal } = await freshMeal(app, w);
    const plate = meal.plates[0];
    if (plate === undefined) throw new Error("no plate");
    return {
      input: {
        params: { id: plate.id },
        body: {
          items: plate.items.map((i) => ({
            componentId: i.componentId,
            variantId: i.variantId,
            cookedG: Math.round(i.cookedG) + 10,
          })),
        },
      },
    };
  },
  "cookSheets.get": () => ({ input: { params: { date: "2026-11-02" } } }),
  "cookSheets.flag": ({ w, who }) => ({
    input: {
      params: { date: "2026-11-02" },
      body:
        who === "kitchen"
          ? { kind: "unavailable", ingredientId: w.a.ingredientId, planMealId: w.a.planMealId }
          : { kind: "unclear", variantId: w.a.variantId, note: "which pan?" },
    },
  }),

  // Reviews and preferences
  "reviews.list": () => ({ input: { query: { limit: 20 } } }),
  "reviews.create": ({ w, who }) => ({
    input: {
      body:
        who === "kitchen"
          ? {
              targetType: "ingredient",
              targetId: w.a.ingredientId,
              tags: ["ingredient_unavailable"],
            }
          : { targetType: "dish", targetId: w.a.dishId, rating: 5, tags: [], comment: "lovely" },
    },
  }),
  "reviews.edit": async ({ w, who }) => {
    const caller = loginOf(w, who);
    const id = await freshReview(caller, w, who);
    return {
      caller,
      input: {
        params: { id },
        body: who === "kitchen" ? { tags: ["recipe_unclear"] } : { rating: 4 },
      },
    };
  },
  "reviews.reply": ({ w }) => ({
    input: { params: { id: w.a.reviewId }, body: { comment: "thanks" } },
  }),
  "reviews.react": ({ w }) => ({
    input: { params: { id: w.a.reviewId }, body: { kind: "agree" } },
  }),
  "reviews.revisions": ({ w }) => ({ input: { params: { id: w.a.reviewId } } }),
  "preferences.list": () => ({ input: {} }),
  "preferences.set": ({ w, who }) => ({
    input: { body: { ...preference(w, who), score: 0.5 } },
  }),
  "preferences.reset": async ({ w, who }) => {
    const caller = loginOf(w, who);
    ok(
      await callJson(c.preferencesSet, { body: { ...preference(w, who), score: 0.4 } }, caller),
      "preference set",
    );
    return { caller, input: { body: preference(w, who) } };
  },

  // Detail levels (1.4.3, R-47)
  "detailLevels.list": () => ({ input: {} }),
  "detailLevels.set": ({ w, who }) => ({
    input: {
      body:
        who === "admin"
          ? { memberId: w.a.childId, section: "targets", level: "detailed" }
          : { memberId: w.a.adultId, section: "taste", level: "detailed" },
    },
  }),

  // Changes, proposals, insights
  "proposals.list": () => ({ input: {} }),
  "proposals.accept": async ({ app, w }) => ({
    input: { params: { id: await freshProposal(app, w) } },
  }),
  "proposals.reject": async ({ app, w }) => ({
    input: { params: { id: await freshProposal(app, w) }, body: { note: "no" } },
  }),
  "changeSets.list": () => ({ input: {} }),
  "changeSets.get": ({ w }) => ({ input: { params: { id: w.a.changeSetId } } }),
  "changeSets.apply": () => ({
    input: { body: { summary: "tweak", ops: [{ kind: "weights.set", payload: { appeal: 0.6 } }] } },
  }),
  "changeSets.preview": () => ({
    input: { body: { ops: [{ kind: "weights.set", payload: { appeal: 0.55 } }] } },
  }),
  "changeSets.undo": async ({ w }) => ({
    input: {
      params: {
        id: await applyOps(w.a.admin, [{ kind: "weights.set", payload: { appeal: 0.45 } }]),
      },
    },
  }),
  "insights.run": () => ({ input: {} }),
  "conversations.list": () => ({ input: {} }),
  "conversations.create": () => ({ input: { body: { title: "Dinner ideas" } } }),
  "conversations.get": ({ w }) => ({ input: { params: { id: w.a.conversationId } } }),
  "conversations.messages": ({ w }) => ({ input: { params: { id: w.a.conversationId } } }),
  "jobs.get": ({ w }) => ({ input: { params: { id: w.a.jobId } } }),
  "jobs.events": ({ w }) => ({ input: { params: { id: w.a.jobId } } }),
  "diagnostics.get": () => ({ input: {} }),

  // Platform console (operator)
  "platform.households": ({ w }) => ({ caller: w.operator, input: {} }),
  "platform.suspend": async ({ w }) => ({
    caller: w.operator,
    input: { params: { id: (await freshUser()).householdId } },
  }),
  "platform.reactivate": async ({ w }) => {
    const h = (await freshUser()).householdId;
    ok(await callJson(c.platformSuspend, { params: { id: h } }, w.operator), "suspend");
    return { caller: w.operator, input: { params: { id: h } } };
  },
  "platform.delete": async ({ w }) => {
    const h = (await freshUser()).householdId;
    ok(await callJson(c.platformSuspend, { params: { id: h } }, w.operator), "suspend");
    return { caller: w.operator, input: { params: { id: h } } };
  },
  "platform.users": ({ w }) => ({ caller: w.operator, input: { query: { q: "example" } } }),
  "platform.block": async ({ w }) => ({
    caller: w.operator,
    input: { params: { id: (await freshLogin(w)).userId } },
  }),
  "platform.unblock": async ({ w }) => {
    const l = await freshLogin(w);
    ok(await callJson(c.platformBlock, { params: { id: l.userId } }, w.operator), "block");
    return { caller: w.operator, input: { params: { id: l.userId } } };
  },
  "platform.aiUsage": ({ w }) => ({ caller: w.operator, input: { query: { days: 7 } } }),
  "platform.failedJobs": ({ w }) => ({ caller: w.operator, input: {} }),
  "support.summary": ({ w }) => ({ caller: w.operator, input: { params: { id: w.a.id } } }),
  "support.members": ({ w }) => ({ caller: w.operator, input: { params: { id: w.a.id } } }),
  "support.plans": ({ w }) => ({
    caller: w.operator,
    input: { params: { id: w.a.id }, query: { from: "2026-11-02", to: "2026-11-02" } },
  }),
  "support.changeLog": ({ w }) => ({ caller: w.operator, input: { params: { id: w.a.id } } }),
  "openapi.get": () => ({ caller: ANON, input: {} }),
};
