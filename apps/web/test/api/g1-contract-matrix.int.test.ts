// G1 (ARC-5, ARC-6): every endpoint has a contract test (schema in: invalid input is refused with
// 400; schema out: the real response parses with the contract) and an authorisation-matrix test
// (anonymous, blocked, operator without household, each household role, and another household's
// admin), including cross-household denial and a leak check. The route files, ENDPOINTS and the
// matrix cases are proven to be the same set.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { ENDPOINTS } from "@mealplanner/api-contract/contract";
import { household } from "@mealplanner/db/schema";
import { cookSheetFor } from "@mealplanner/db/services/plans";
import { route } from "../../lib/server/route";
import { listMembers } from "../../lib/server/reads";
import type { CallerContext } from "../../lib/auth/context";
import { callJson, requestFor, startTestApp, type TestApp } from "./support/app";
import { CASES, type Case } from "./support/cases";
import { createTestDatabase, type TestDatabase } from "./support/db";
import {
  completeness,
  observe,
  routeInventory,
  runMatrix,
  successProblems,
  type Invoke,
  type Outcome,
} from "./support/matrix";
import { measure } from "./support/measure";
import { buildWorld, ok, PLAN_DATE, type World } from "./support/world";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../app/api/v1");

let db: TestDatabase;
let app: TestApp;
let w: World;

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  w = await buildWorld(app);
}, 300_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

function caseOf(id: string): Case {
  const make = CASES[id];
  if (make === undefined) throw new Error(`no case for ${id}`);
  return make;
}

const failures = (outcomes: Outcome[]) => outcomes.filter((o) => o.problems.length > 0);
const describeFailures = (outcomes: Outcome[]) =>
  failures(outcomes)
    .map((o) => `${o.endpoint} as ${o.caller}: ${o.problems.join("; ")}`)
    .join("\n");

describe("G1 completeness", () => {
  it("G1 every route file is a contract endpoint, every endpoint has its route file and a matrix case", () => {
    const routes = routeInventory(API_DIR);
    const gaps = completeness(routes, ENDPOINTS);
    const withoutCase = ENDPOINTS.filter((e) => CASES[e.id] === undefined).map((e) => e.id);
    const staleCases = Object.keys(CASES).filter((id) => !ENDPOINTS.some((e) => e.id === id));
    measure("G1", "completeness", {
      routes: routes.length,
      endpoints: ENDPOINTS.length,
      cases: Object.keys(CASES).length,
      missingRoutes: gaps.missingRoutes,
      unregistered: gaps.unregistered,
      withoutCase,
      staleCases,
    });
    expect(gaps).toEqual({ missingRoutes: [], unregistered: [] });
    expect(withoutCase).toEqual([]);
    expect(staleCases).toEqual([]);
    expect(routes.length).toBe(ENDPOINTS.length);
  });
});

describe("G1 contract and ARC-6 matrix, per endpoint", () => {
  it.each(ENDPOINTS.map((e) => [e.id, e] as const))(
    "G1 endpoint %s: contract in and out, ARC-6 matrix and cross-household denial",
    async (id, endpoint) => {
      const make = CASES[id];
      if (make === undefined) throw new Error(`no case for ${id}`);
      const outcomes = await runMatrix(endpoint, make, { app, w });
      measure("G1", "endpoint", {
        id,
        auth: endpoint.auth,
        calls: outcomes.length,
        refusals: outcomes.filter(
          (o) => o.expected === 401 || o.expected === 403 || o.expected === 404,
        ).length,
        invalidInputs: outcomes.filter((o) => o.expected === 400).length,
        successes: outcomes.filter((o) => o.expected < 300).length,
        crossHousehold: outcomes.filter((o) => o.caller.startsWith("other household")).length,
        failures: failures(outcomes).length,
      });
      expect(describeFailures(outcomes)).toBe("");
      expect(outcomes.some((o) => o.expected < 300)).toBe(true);
    },
    120_000,
  );
});

describe("G1 ARC-6 row details", () => {
  it("G1 ARC-6: a member reads only their own member and targets; a kitchen login cannot read targets or plates", async () => {
    const own = await callJson(c.membersGet, { params: { id: w.a.adultId } }, w.a.member);
    expect(own.status).toBe(200);
    const other = await callJson(c.membersGet, { params: { id: w.a.childId } }, w.a.member);
    expect(other.status).toBe(404);
    const targets = ok<{ targets: Array<{ memberId: string }> }>(
      await callJson(c.targetsList, {}, w.a.member),
      "targets",
    );
    expect(targets.targets.every((t) => t.memberId === w.a.adultId)).toBe(true);
    expect((await callJson(c.targetsList, {}, w.a.kitchen)).status).toBe(403);
    expect((await callJson(c.platesGet, { params: { id: w.a.plateId } }, w.a.kitchen)).status).toBe(
      403,
    );
  });

  it("G1 ARC-6: kitchen writes kitchen tags only; members change only their own taste preferences", async () => {
    const rated = await callJson(
      c.reviewsCreate,
      { body: { targetType: "dish", targetId: w.a.dishId, rating: 5 } },
      w.a.kitchen,
    );
    expect(rated.status).toBe(403);
    const tagged = await callJson(
      c.reviewsCreate,
      {
        body: {
          targetType: "ingredient",
          targetId: w.a.ingredientId,
          tags: ["ingredient_unavailable"],
        },
      },
      w.a.kitchen,
    );
    expect(tagged.status).toBe(201);
    const foreign = await callJson(
      c.preferencesSet,
      { body: { memberId: w.a.childId, entityType: "cuisine", entityKey: "levantine", score: 1 } },
      w.a.member,
    );
    expect(foreign.status).toBe(403);
    expect(
      (
        await callJson(
          c.preferencesSet,
          { body: { memberId: null, entityType: "cuisine", entityKey: "levantine", score: 1 } },
          w.a.kitchen,
        )
      ).status,
    ).toBe(403);
  });

  it("G1 ARC-6: the cook sheet shows the kitchen the plating table of the day", async () => {
    const sheet = ok<{ meals: Array<{ plating: { rows: unknown[] } }> }>(
      await callJson(c.cookSheetsGet, { params: { date: PLAN_DATE } }, w.a.kitchen),
      "cook sheet",
    );
    expect(sheet.meals.length).toBeGreaterThan(0);
    expect(sheet.meals.some((m) => m.plating.rows.length > 0)).toBe(true);
  });
});

describe("G1 ARC-6 projections that depend on household settings", () => {
  const setSettings = (payload: Record<string, boolean>) =>
    callJson(
      c.changeSetsApply,
      { body: { summary: "settings", ops: [{ kind: "household.update", payload }] } },
      w.a.admin,
    );

  it("G1 ARC-6: with members_see_plates off a member's cook sheet has only their own plating rows, and with kitchen_sees_names off the kitchen's sheet carries no member name", async () => {
    ok(await setSettings({ membersSeePlates: false, kitchenSeesNames: false }), "settings off");
    try {
      const memberSheet = ok<{
        meals: Array<{ plating: { rows: Array<{ memberId: string }> }; notes: string[] }>;
      }>(
        await callJson(c.cookSheetsGet, { params: { date: PLAN_DATE } }, w.a.member),
        "member sheet",
      );
      const rows = memberSheet.meals.flatMap((m) => m.plating.rows.map((r) => r.memberId));
      const kitchen = await callJson(c.cookSheetsGet, { params: { date: PLAN_DATE } }, w.a.kitchen);
      const kitchenSheet = kitchen.json as { meals: Array<{ notes: string[] }> };
      measure("G1", "projection-cook-sheet", {
        memberRows: rows.length,
        foreignRows: rows.filter((id) => id !== w.a.adultId).length,
        kitchenNamesShown: ["Sara", "Zayd"].filter((n) => kitchen.text.includes(n)),
        toleranceNotes: kitchenSheet.meals
          .flatMap((m) => m.notes)
          .filter((n) => n.includes("tolerance")).length,
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((id) => id === w.a.adultId)).toBe(true);
      expect(kitchen.status).toBe(200);
      expect(kitchen.text).not.toContain("Sara");
      expect(kitchen.text).not.toContain("Zayd");
      expect(kitchenSheet.meals.flatMap((m) => m.notes).some((n) => n.includes("tolerance"))).toBe(
        false,
      );
    } finally {
      ok(await setSettings({ membersSeePlates: true, kitchenSeesNames: true }), "settings on");
    }
  });

  it("G1 ARC-6: the kitchen's review list has kitchen-tag reviews only, without ratings, comments or hidden author names", async () => {
    ok(await setSettings({ kitchenSeesNames: false }), "names off");
    try {
      const list = ok<{
        reviews: Array<{
          rating: number | null;
          comment: string | null;
          tags: string[];
          authorName: string;
          authorUserId: string;
        }>;
      }>(await callJson(c.reviewsList, { query: { limit: 200 } }, w.a.kitchen), "kitchen reviews");
      const all = ok<{ reviews: unknown[] }>(
        await callJson(c.reviewsList, { query: { limit: 200 } }, w.a.admin),
        "all reviews",
      );
      measure("G1", "projection-reviews", {
        kitchenSees: list.reviews.length,
        adminSees: all.reviews.length,
      });
      expect(list.reviews.length).toBeLessThan(all.reviews.length);
      for (const r of list.reviews) {
        expect(r.rating).toBeNull();
        expect(r.comment).toBeNull();
        expect(r.tags.length).toBeGreaterThan(0);
        expect(
          r.tags.every((t) =>
            ["ingredient_unavailable", "recipe_unclear", "quantity_wrong"].includes(t),
          ),
        ).toBe(true);
        if (r.authorUserId !== w.a.kitchen.userId) expect(r.authorName).toBe("");
      }
    } finally {
      ok(await setSettings({ kitchenSeesNames: true }), "names on");
    }
  });

  it("G1 people, access and support ops are refused on /change-sets (their endpoints add checks), and an invalid time zone is refused", async () => {
    const block = await callJson(
      c.changeSetsApply,
      {
        body: {
          summary: "x",
          ops: [{ kind: "access.block", payload: { userId: w.a.member.userId } }],
        },
      },
      w.a.admin,
    );
    const grant = await callJson(
      c.changeSetsPreview,
      {
        body: {
          ops: [
            {
              kind: "support.grant",
              payload: { operatorUserId: w.operator.userId, expiresAt: "2099-01-01T00:00:00Z" },
            },
          ],
        },
      },
      w.a.admin,
    );
    const tz = await callJson(
      c.changeSetsApply,
      {
        body: {
          summary: "x",
          ops: [{ kind: "household.update", payload: { timezone: "Foo/Bar" } }],
        },
      },
      w.a.admin,
    );
    measure("G1", "dedicated-ops", {
      block: block.status,
      grant: grant.status,
      timezone: tz.status,
    });
    expect(block.status).toBe(422);
    expect((block.json as { code: string }).code).toBe("dedicated_endpoint");
    expect(grant.status).toBe(422);
    expect(tz.status).toBe(400);
    expect((await callJson(c.membersList, {}, w.a.member)).status).toBe(200);
  });
});

// Negative controls: the same checks on faulty routes and a faulty route inventory must fail.
describe("G1 negative controls", () => {
  it("G1 negative control: an unregistered route file and a missing route are both reported", () => {
    const routes = routeInventory(API_DIR);
    const extra = completeness([...routes, "DELETE /api/v1/weights"], ENDPOINTS);
    expect(extra.unregistered).toEqual(["DELETE /api/v1/weights"]);
    const missing = completeness(
      routes.filter((r) => r !== "GET /api/v1/weights"),
      ENDPOINTS,
    );
    expect(missing.missingRoutes).toEqual(["GET /api/v1/weights"]);
    measure("G1", "negative-completeness", {
      unregistered: extra.unregistered.length,
      missingRoutes: missing.missingRoutes.length,
    });
  });

  it("G1 negative control: a route that skips the household and role check fails the matrix", async () => {
    // Faulty: signed-in is enough, and the household is not taken from the caller at all.
    const faulty = route(
      { ...c.membersList, auth: "session", roles: undefined },
      async ({ rt, session }) => {
        const id = w.a.id;
        const [h] = await rt.db.select().from(household).where(eq(household.id, id));
        if (h === undefined) throw new Error("no household");
        const caller = {
          ...session,
          ctx: { householdId: id, userId: session.user.id, role: "admin" },
          household: h,
          memberId: null,
        } as CallerContext;
        return listMembers(rt, caller);
      },
    );
    const invoke: Invoke = (endpoint, input, caller, headers) =>
      faulty(requestFor(endpoint, input, caller, headers), { params: Promise.resolve({}) });
    const outcomes = await runMatrix(c.membersList, caseOf("members.list"), { app, w }, invoke);
    const failed = failures(outcomes).map((o) => o.caller);
    measure("G1", "negative-skipped-check", { failures: failed.length, callers: failed });
    expect(failed).toContain("operator without household");
    expect(failed).toContain("other household's admin, naming this household");
    expect(failed).toContain("other household's admin, own household (no data of this household)");
  });

  it("G1 negative control: a cook sheet built without the caller's view carries the names the kitchen must not see", async () => {
    const raw = await cookSheetFor(
      app.rt.db,
      { householdId: w.a.id, userId: w.a.kitchen.userId, role: "kitchen" },
      PLAN_DATE,
    );
    const text = JSON.stringify(raw.sheet);
    const shown = ["Sara", "Zayd"].filter((n) => text.includes(n));
    measure("G1", "negative-unprojected-sheet", { namesShown: shown.length });
    expect(shown.length).toBeGreaterThan(0);
  });

  it("G1 negative control: a response that violates its schema fails the contract check", async () => {
    const faulty = route(c.weightsGet, () => Promise.resolve({ bogus: 1 } as never));
    const invoke: Invoke = (endpoint, input, caller, headers) =>
      faulty(requestFor(endpoint, input, caller, headers), { params: Promise.resolve({}) });
    const outcomes = await runMatrix(c.weightsGet, caseOf("weights.get"), { app, w }, invoke);
    const failed = failures(outcomes).map((o) => o.caller);
    // The body itself, checked without the route's own guard, violates the contract too.
    const direct = successProblems(c.weightsGet, {
      status: 200,
      contentType: "application/json",
      text: JSON.stringify({ bogus: 1 }),
    });
    const real = await observe(
      await (
        await import("../../app/api/v1/weights/route")
      ).GET(requestFor(c.weightsGet, {}, w.a.admin)),
    );
    measure("G1", "negative-bad-response", {
      failures: failed.length,
      directProblems: direct.length,
      realProblems: successProblems(c.weightsGet, real).length,
    });
    expect(failed).toContain("household admin");
    expect(direct.length).toBeGreaterThan(0);
    expect(successProblems(c.weightsGet, real)).toEqual([]);
  });
});
