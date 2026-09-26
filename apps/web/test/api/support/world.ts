// A test world of two households and a platform operator, built through the API (sign-up, invites,
// change sets) plus the plan services for a generated plan:
// - household A: admin, second admin, member login linked to a targeted adult, kitchen login,
//   a blocked member login, an untargeted child, a generated day plan, a review, a proposal, a
//   conversation, a finished job with events, an open invite, a support grant for the operator;
// - household B: admin with a targeted adult and a generated day plan (for cross-household tests);
// - operator: a platform operator with no household.
import * as c from "@mealplanner/api-contract/contract";
import { createProposals } from "@mealplanner/db/services/proposals";
import { appendJobEvent, createJob, finishJob, generatePlan } from "@mealplanner/db/services/plans";
import {
  chatMessage,
  conversation,
  cuisine,
  dish,
  ingredient,
  newId,
  platformOperator,
  preparationMethod,
  supportGrant,
} from "@mealplanner/db/schema";
import { and, eq } from "drizzle-orm";
import { ANON, callJson, type Caller, type TestApp } from "./app";

export const PLAN_DATE = "2026-11-02";

export interface Login extends Caller {
  token: string;
  userId: string;
  email: string;
  password: string;
}

export interface HouseholdWorld {
  id: string;
  admin: Login;
  adultId: string;
  childId: string;
  planMealId: string;
  plateId: string;
  ownPlateId: string | null;
  planDayId: string;
  reviewId: string;
  proposalId: string;
  conversationId: string;
  jobId: string;
  inviteId: string;
  changeSetId: string;
  dishId: string;
  variantId: string;
  ingredientId: string;
  /** A household-owned ingredient and dish (other households must not see them). */
  ownIngredientId: string;
  ownDishId: string;
}

export interface World {
  a: HouseholdWorld & {
    admin2: Login;
    member: Login;
    kitchen: Login;
    blocked: Login;
    grantId: string;
  };
  b: HouseholdWorld;
  operator: Login;
}

// T names the expected body shape at the call site (a test-side cast of the parsed JSON).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function ok<T = Record<string, unknown>>(
  r: { status: number; json: unknown; text: string },
  what: string,
): T {
  if (r.status >= 300) throw new Error(`${what}: ${String(r.status)} ${r.text.slice(0, 500)}`);
  return r.json as T;
}

let serial = 0;
export function uniqueEmail(tag: string): string {
  serial += 1;
  const safe = tag.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${safe}-${String(serial)}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export async function signupAdmin(householdName: string): Promise<Login & { householdId: string }> {
  const email = uniqueEmail("admin");
  const password = "correct horse battery";
  const r = await callJson(
    c.signup,
    { body: { email, password, name: `Admin ${householdName}`, householdName } },
    ANON,
  );
  const j = ok<{ user: { id: string }; householdId: string; token: string }>(r, "signup");
  return { token: j.token, userId: j.user.id, email, password, householdId: j.householdId };
}

export async function invite(
  admin: Caller,
  role: "admin" | "member" | "kitchen",
  memberId: string | null,
): Promise<string> {
  const r = await callJson(
    c.invitesCreate,
    { body: { role, memberId, expiresIn: "7d", channel: "link" } },
    admin,
  );
  return ok<{ code: string }>(r, "invite").code;
}

export async function acceptWithSignup(code: string, name: string): Promise<Login> {
  const email = uniqueEmail(name.toLowerCase());
  const password = "another horse battery";
  const r = await callJson(
    c.invitesAccept,
    { body: { code, signup: { email, password, name } } },
    ANON,
  );
  const j = ok<{ userId: string; token: string }>(r, "accept");
  return { token: j.token, userId: j.userId, email, password };
}

export async function applyOps(admin: Caller, ops: unknown[]): Promise<string> {
  const r = await callJson(c.changeSetsApply, { body: { summary: "test setup", ops } }, admin);
  return ok<{ changeSetId: string }>(r, "apply ops").changeSetId;
}

/** A targeted adult and an untargeted child (F2-like), with default slots from sign-up. */
export async function addMembers(
  admin: Caller,
): Promise<{ adultId: string; childId: string; changeSetId: string }> {
  const adultId = newId();
  const childId = newId();
  const changeSetId = await applyOps(admin, [
    {
      kind: "member.create",
      payload: {
        id: adultId,
        displayName: "Sara",
        color: "tomato",
        isTargeted: true,
        birthYear: 1990,
      },
    },
    {
      kind: "member.create",
      payload: {
        id: childId,
        displayName: "Zayd",
        color: "saffron",
        isTargeted: false,
        birthYear: 2016,
        appetite: "medium",
      },
    },
    {
      kind: "target.set",
      payload: {
        memberId: adultId,
        kind: "default",
        profile: { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70 },
      },
    },
  ]);
  return { adultId, childId, changeSetId };
}

async function firstMeal(admin: Caller, memberId: string | null) {
  const plans = ok<{
    days: Array<{
      id: string;
      meals: Array<{
        id: string;
        dishId: string;
        plates: Array<{ id: string; memberId: string; items: Array<{ variantId: string }> }>;
      }>;
    }>;
  }>(await callJson(c.plansList, { query: { from: PLAN_DATE, to: PLAN_DATE } }, admin), "plans");
  const day = plans.days[0];
  if (day === undefined) throw new Error("no plan day");
  const meal = day.meals.find((m) => m.plates.length > 0);
  if (meal === undefined) throw new Error("no meal with plates");
  const plate = meal.plates[0];
  const own =
    memberId === null
      ? null
      : (day.meals.flatMap((m) => m.plates).find((p) => p.memberId === memberId) ?? null);
  const variantId = plate?.items[0]?.variantId;
  if (plate === undefined || variantId === undefined) throw new Error("no plate");
  return {
    planDayId: day.id,
    planMealId: meal.id,
    dishId: meal.dishId,
    plateId: plate.id,
    ownPlateId: own?.id ?? null,
    variantId,
  };
}

/** A household ingredient and a household dish made of it, through change sets. */
async function ownCatalogue(app: TestApp, admin: Caller, householdId: string) {
  const tag = householdId.slice(-8);
  await applyOps(admin, [
    {
      kind: "ingredient.create",
      payload: {
        slug: `house_greens_${tag}`,
        name: "House greens",
        category: "vegetable",
        kcal: 30,
        proteinG: 2,
        carbsG: 5,
        fatG: 0.3,
        satFatG: 0,
        fibreG: 2,
        solubleFibreG: null,
        sugarG: null,
        sodiumMg: null,
        nutritionSource: "manual",
        nutritionConfidence: "medium",
      },
    },
  ]);
  const db = app.rt.db;
  const [ing] = await db
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(
      and(
        eq(ingredient.slug, `house_greens_${tag}`),
        eq(ingredient.createdByHouseholdId, householdId),
      ),
    );
  const [cu] = await db
    .select({ id: cuisine.id })
    .from(cuisine)
    .where(eq(cuisine.key, "levantine"));
  const [me] = await db
    .select({ id: preparationMethod.id })
    .from(preparationMethod)
    .where(eq(preparationMethod.key, "sauteed"));
  if (ing === undefined || cu === undefined || me === undefined)
    throw new Error("catalogue rows missing");
  await applyOps(admin, [
    {
      kind: "dish.create",
      payload: {
        name: "House greens",
        slug: `house_greens_dish_${tag}`,
        description: "Household recipe.",
        cuisineId: cu.id,
        slotKeys: ["dinner"],
        isPackable: false,
        servedColdOk: true,
        components: [
          {
            name: "Greens",
            role: "vegetable",
            portioning: "continuous",
            minServingG: 0,
            maxServingG: 300,
            defaultServingG: 120,
            required: true,
            variants: [
              {
                methodId: me.id,
                label: "Sauteed",
                isDefault: true,
                steps: ["Saute."],
                ingredients: [{ ingredientId: ing.id, rawGPerBatch: 500 }],
              },
            ],
          },
        ],
      },
    },
  ]);
  const [d] = await db
    .select({ id: dish.id })
    .from(dish)
    .where(and(eq(dish.slug, `house_greens_dish_${tag}`), eq(dish.householdId, householdId)));
  if (d === undefined) throw new Error("household dish missing");
  return { ownIngredientId: ing.id, ownDishId: d.id };
}

async function household(
  app: TestApp,
  name: string,
): Promise<HouseholdWorld & { admin: Login & { householdId: string } }> {
  const admin = await signupAdmin(name);
  const { adultId, childId, changeSetId } = await addMembers(admin);
  await generatePlan(
    app.rt.db,
    { householdId: admin.householdId, userId: admin.userId, role: "admin" },
    {
      dates: [PLAN_DATE],
      seed: 1,
      by: { actor: "user", source: "ui" },
    },
  );
  const meal = await firstMeal(admin, adultId);
  const review = ok<{ id: string }>(
    await callJson(
      c.reviewsCreate,
      {
        body: {
          targetType: "dish",
          targetId: meal.dishId,
          rating: 4,
          tags: ["tasty"],
          onBehalfOfMemberId: adultId,
        },
      },
      admin,
    ),
    "review",
  );
  const ctx = { householdId: admin.householdId, userId: admin.userId, role: "admin" as const };
  const proposals = await createProposals(app.rt.db, ctx, [
    {
      origin: "rule",
      title: "More appeal",
      rationale: "test proposal",
      ops: [{ kind: "weights.set", payload: { appeal: 0.8 } }],
      evidence: { reviewIds: [], count: 1, metrics: {} },
      priority: 3,
    },
  ]);
  const proposalId = proposals.stored[0]?.id;
  if (proposalId === undefined) throw new Error("no proposal stored");
  const conversationId = newId();
  await app.rt.db.insert(conversation).values({
    id: conversationId,
    householdId: admin.householdId,
    userId: admin.userId,
    title: "Chat",
    createdAt: new Date(),
    archivedAt: null,
  });
  await app.rt.db.insert(chatMessage).values({
    id: newId(),
    householdId: admin.householdId,
    conversationId,
    role: "user",
    content: [{ type: "text", text: "hi" }],
    createdAt: new Date(),
  });
  const job = await createJob(app.rt.db, {
    kind: "insights.run",
    householdId: admin.householdId,
    payload: {},
    createdByUserId: admin.userId,
  });
  await appendJobEvent(app.rt.db, job.id, "started", {});
  await appendJobEvent(app.rt.db, job.id, "done", {});
  await finishJob(app.rt.db, job.id, { status: "succeeded" });
  const inviteRow = ok<{ id: string }>(
    await callJson(
      c.invitesCreate,
      { body: { role: "member", memberId: null, expiresIn: "7d", channel: "link" } },
      admin,
    ),
    "invite",
  );
  const ingredients = ok<{ ingredients: Array<{ id: string }> }>(
    await callJson(c.ingredientsList, { query: { limit: 1 } }, admin),
    "ingredients",
  );
  return {
    id: admin.householdId,
    admin,
    adultId,
    childId,
    ...meal,
    reviewId: review.id,
    proposalId,
    conversationId,
    jobId: job.id,
    inviteId: inviteRow.id,
    changeSetId,
    ingredientId: ingredients.ingredients[0]?.id ?? "",
    ...(await ownCatalogue(app, admin, admin.householdId)),
  };
}

export async function operatorLogin(app: TestApp): Promise<Login> {
  const email = uniqueEmail("operator");
  const password = "operator horse battery";
  const created = await app.rt.auth.api.signUpEmail({
    body: { email, password, name: "Operator" },
  });
  await app.rt.db
    .insert(platformOperator)
    .values({ userId: created.user.id, createdAt: new Date() });
  const signed = await app.rt.auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const token = signed.headers.get("set-auth-token") ?? signed.response.token;
  return { token, userId: created.user.id, email, password };
}

export async function buildWorld(app: TestApp): Promise<World> {
  const a = await household(app, "Household A");
  const b = await household(app, "Household B");
  const admin2 = await acceptWithSignup(await invite(a.admin, "admin", null), "Admin2");
  const member = await acceptWithSignup(
    await invite(a.admin, "member", a.adultId),
    "Linked member",
  );
  const kitchen = await acceptWithSignup(await invite(a.admin, "kitchen", null), "Cook");
  const blocked = await acceptWithSignup(await invite(a.admin, "member", null), "Blocked");
  ok(
    await callJson(
      c.accessBlock,
      { params: { userId: blocked.userId }, body: { reason: "test" } },
      a.admin,
    ),
    "block",
  );
  const operator = await operatorLogin(app);
  const grantId = newId();
  await app.rt.db.insert(supportGrant).values({
    id: grantId,
    householdId: a.id,
    operatorUserId: operator.userId,
    grantedByUserId: a.admin.userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
  });
  return { a: { ...a, admin2, member, kitchen, blocked, grantId }, b, operator };
}
