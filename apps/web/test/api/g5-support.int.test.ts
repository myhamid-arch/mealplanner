// G5 (R2-ADM-8): the platform's support endpoints return household data only under an active
// support grant from that household to that operator, and every such access is logged (one
// `support_access` row per read, shown to the household as a `support_view` change-log entry that
// cannot be undone). Refused reads log nothing and return no data. Platform-wide endpoints carry
// no household data (members, reviews, plans, conversations).
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import type { EndpointSpec } from "@mealplanner/api-contract/contract";
import { household, newId, supportAccess, supportGrant } from "@mealplanner/db/schema";
import type { CallerContext } from "../../lib/auth/context";
import { supportMembersView } from "../../lib/server/platform";
import { route } from "../../lib/server/route";
import {
  call,
  callJson,
  requestFor,
  startTestApp,
  type CallInput,
  type Caller,
  type TestApp,
} from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { measure } from "./support/measure";
import { buildWorld, ok, operatorLogin, PLAN_DATE, type Login, type World } from "./support/world";

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

const SUPPORT: Array<{ endpoint: EndpointSpec; input: (householdId: string) => CallInput }> = [
  { endpoint: c.supportSummary, input: (id) => ({ params: { id } }) },
  { endpoint: c.supportMembers, input: (id) => ({ params: { id } }) },
  {
    endpoint: c.supportPlans,
    input: (id) => ({ params: { id }, query: { from: PLAN_DATE, to: PLAN_DATE } }),
  },
  { endpoint: c.supportChangeLog, input: (id) => ({ params: { id } }) },
];

type Invoke = (endpoint: EndpointSpec, input: CallInput, caller: Caller) => Promise<Response>;

async function accessRows(householdId: string): Promise<number> {
  const [row] = await app.rt.db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportAccess)
    .where(eq(supportAccess.householdId, householdId));
  return row?.n ?? 0;
}

/** Ids and names of household `hh` that must not appear in a refused or platform-wide response. */
function householdData(hh: World["b"]): string[] {
  return [
    hh.adultId,
    hh.childId,
    hh.planMealId,
    hh.plateId,
    hh.reviewId,
    hh.conversationId,
    hh.proposalId,
    "Sara",
    "Zayd",
  ];
}

/**
 * The G5 refusal check: every support read of `householdId` by `operator` is 403 problem+json,
 * carries none of the household's data, and logs no access. Returns the problems found.
 */
async function refusalProblems(
  invoke: Invoke,
  operator: Login,
  householdId: string,
  secrets: string[],
): Promise<string[]> {
  const problems: string[] = [];
  const before = await accessRows(householdId);
  for (const s of SUPPORT) {
    const res = await invoke(s.endpoint, s.input(householdId), operator);
    const text = await res.text();
    if (res.status !== 403) problems.push(`${s.endpoint.id}: status ${String(res.status)}`);
    if (!(res.headers.get("content-type") ?? "").startsWith("application/problem+json"))
      problems.push(`${s.endpoint.id}: not a problem`);
    for (const secret of secrets)
      if (text.includes(secret)) problems.push(`${s.endpoint.id}: returned ${secret}`);
  }
  const after = await accessRows(householdId);
  if (after !== before)
    problems.push(`${String(after - before)} access rows logged for refused reads`);
  return problems;
}

async function insertGrant(
  householdId: string,
  operatorUserId: string,
  grantedBy: string,
  state: "expired" | "revoked",
) {
  await app.rt.db.insert(supportGrant).values({
    id: newId(),
    householdId,
    operatorUserId,
    grantedByUserId: grantedBy,
    createdAt: new Date(Date.now() - 7_200_000),
    expiresAt:
      state === "expired" ? new Date(Date.now() - 60_000) : new Date(Date.now() + 3_600_000),
    revokedAt: state === "revoked" ? new Date(Date.now() - 30_000) : null,
  });
}

describe("G5 support grants", () => {
  it("G5 support endpoints refuse household data with no grant, an expired grant, a revoked grant, another operator's grant or another household's grant, and log nothing", async () => {
    const results: Record<string, string[]> = {};
    // Household B: no grant at all (the operator's only grant is household A's).
    results["no grant (the operator's grant is another household's)"] = await refusalProblems(
      call,
      w.operator,
      w.b.id,
      householdData(w.b),
    );
    await insertGrant(w.b.id, w.operator.userId, w.b.admin.userId, "expired");
    results["expired grant"] = await refusalProblems(call, w.operator, w.b.id, householdData(w.b));
    await insertGrant(w.b.id, w.operator.userId, w.b.admin.userId, "revoked");
    results["revoked grant"] = await refusalProblems(call, w.operator, w.b.id, householdData(w.b));
    // Household A has an active grant, but for the first operator only.
    const other = await operatorLogin(app);
    results["another operator's grant"] = await refusalProblems(
      call,
      other,
      w.a.id,
      householdData(w.a),
    );
    // A household admin (not an operator) is refused before any grant lookup.
    const admin = await Promise.all(
      SUPPORT.map((s) => callJson(s.endpoint, s.input(w.a.id), w.a.admin)),
    );
    measure("G5", "refusals", {
      conditions: Object.keys(results).length,
      calls: Object.keys(results).length * SUPPORT.length,
      problems: Object.values(results).flat().length,
      adminStatuses: admin.map((r) => r.status),
    });
    expect(results).toEqual(Object.fromEntries(Object.keys(results).map((k) => [k, []])));
    expect(admin.every((r) => r.status === 403)).toBe(true);
  });

  it("G5 with an active grant each support read returns the household's data and logs exactly one access row (operator, grant, method, path)", async () => {
    const rows: Array<{ id: string; status: number; added: number; path: string | null }> = [];
    for (const s of SUPPORT) {
      const before = await accessRows(w.a.id);
      const r = await callJson(s.endpoint, s.input(w.a.id), w.operator);
      const after = await accessRows(w.a.id);
      const [last] = await app.rt.db
        .select()
        .from(supportAccess)
        .where(eq(supportAccess.householdId, w.a.id))
        .orderBy(sql`${supportAccess.createdAt} desc`)
        .limit(1);
      const parsed = s.endpoint.response?.safeParse(r.json);
      rows.push({
        id: s.endpoint.id,
        status: r.status,
        added: after - before,
        path: last?.path ?? null,
      });
      expect(r.status, r.text).toBe(200);
      expect(parsed?.success).toBe(true);
      expect(after - before).toBe(1);
      expect(last?.operatorUserId).toBe(w.operator.userId);
      expect(last?.grantId).toBe(w.a.grantId);
      expect(last?.method).toBe("GET");
      expect(last?.path).toBe(
        new URL(requestFor(s.endpoint, s.input(w.a.id), w.operator).url).pathname,
      );
    }
    const members = await callJson(c.supportMembers, { params: { id: w.a.id } }, w.operator);
    expect(members.text).toContain(w.a.adultId);
    measure("G5", "granted", {
      reads: rows.length,
      logged: rows.reduce((n, r) => n + r.added, 0),
      statuses: rows.map((r) => r.status),
    });
  });

  it("G5 the household sees every support access in its change log as a support view that cannot be undone", async () => {
    const logged = await accessRows(w.a.id);
    const log = ok<{
      entries: Array<{
        kind?: string;
        source?: string;
        summary: string;
        undo: { available: boolean };
      }>;
    }>(await callJson(c.changeSetsList, { query: { limit: 200 } }, w.a.admin), "change log");
    const views = log.entries.filter((e) => JSON.stringify(e).includes("support_view"));
    measure("G5", "change-log", {
      logged,
      views: views.length,
      undoable: views.filter((v) => v.undo.available).length,
    });
    expect(views.length).toBe(logged);
    expect(views.every((v) => !v.undo.available)).toBe(true);
    // Household B's log shows none of A's accesses.
    const bLog = await callJson(c.changeSetsList, { query: { limit: 200 } }, w.b.admin);
    expect(bLog.text.includes("support_view")).toBe(false);
  });

  it("G5 platform-wide endpoints carry no household data", async () => {
    const [h] = await app.rt.db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.id, w.a.id));
    expect(h).toBeDefined();
    const calls = [
      await callJson(c.platformHouseholds, {}, w.operator),
      await callJson(c.platformUsers, { query: { q: "example" } }, w.operator),
      await callJson(c.platformAiUsage, { query: { days: 30 } }, w.operator),
      await callJson(c.platformFailedJobs, { query: { hours: 24 } }, w.operator),
    ];
    const secrets = [...householdData(w.a), ...householdData(w.b)];
    const leaks = calls.flatMap((r, i) =>
      secrets.filter((s) => r.text.includes(s)).map((s) => `${String(i)}: ${s}`),
    );
    measure("G5", "platform-wide", { statuses: calls.map((r) => r.status), leaks });
    expect(calls.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(leaks).toEqual([]);
  });

  it("G5 negative control: a support read that skips the grant check returns household data and logs nothing", async () => {
    // Faulty: the members view without withSupport (no grant lookup, no log row).
    const faulty = route(c.supportMembers, async ({ rt, session, params }) => {
      const [row] = await rt.db.select().from(household).where(eq(household.id, params.id));
      if (row === undefined) throw new Error("no household");
      const caller = {
        ...session,
        ctx: { householdId: params.id, userId: session.user.id, role: "admin" },
        household: row,
        memberId: null,
      } as CallerContext;
      return supportMembersView(rt, caller);
    });
    const invoke: Invoke = (endpoint, input, caller) =>
      endpoint.id === c.supportMembers.id
        ? faulty(requestFor(endpoint, input, caller), {
            params: Promise.resolve(input.params ?? {}),
          })
        : call(endpoint, input, caller);
    const problems = await refusalProblems(invoke, w.operator, w.b.id, householdData(w.b));
    const [grants] = await app.rt.db
      .select({ n: sql<number>`count(*)::int` })
      .from(supportGrant)
      .where(
        and(
          eq(supportGrant.householdId, w.b.id),
          sql`${supportGrant.revokedAt} is null`,
          sql`${supportGrant.expiresAt} > now()`,
        ),
      );
    measure("G5", "negative-skipped-grant", { problems, activeGrantsOfB: grants?.n ?? 0 });
    expect(grants?.n ?? 0).toBe(0);
    expect(problems.some((p) => p.startsWith("support.members: status 200"))).toBe(true);
    expect(problems.some((p) => p.includes(w.b.adultId))).toBe(true);
  });
});
