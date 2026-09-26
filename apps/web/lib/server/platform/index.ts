// The platform operator console (R2-ADM-8; leaf-1.4.1 SPEC-Q-7). Platform data (households with
// counts, users and their memberships, AI usage and cost, failed jobs) is served to operators
// directly. Household data is served only through `support*`, and only while an unexpired,
// unrevoked support grant for this operator exists; every such read first writes a
// `support_access` row (shown in the household's change log), in the same transaction, so no
// household data leaves without its log entry.
import { and, count, desc, eq, gt, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  aiGeneration,
  household,
  householdUser,
  member,
  newId,
  planDay,
  proposal,
  supportAccess,
  supportGrant,
  user,
} from "@mealplanner/db/schema";
import { failedJobs } from "@mealplanner/db/services/plans";
import type { CallerContext, SessionInfo } from "../../auth/context";
import { changeLog } from "../changes";
import { householdDto } from "../household";
import { revokeAllSessions } from "../identity";
import { planDays } from "../plans";
import { ProblemError, conflict, notFound } from "../problem";
import type { Runtime } from "../runtime";
import { plain } from "../serialize";
import { costUsd } from "./pricing";

type HouseholdRow = typeof household.$inferSelect;

function statusOf(h: HouseholdRow): "active" | "suspended" | "deletion_pending" {
  if (h.deletionRequestedAt !== null) return "deletion_pending";
  return h.suspendedAt === null ? "active" : "suspended";
}

async function householdSummaries(rt: Runtime, ids?: readonly string[]) {
  const rows = await rt.db
    .select()
    .from(household)
    .where(ids === undefined ? undefined : inArray(household.id, [...ids]));
  if (rows.length === 0) return [];
  const hh = rows.map((h) => h.id);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const logins = await rt.db
    .select({ householdId: householdUser.householdId, role: householdUser.role, n: count() })
    .from(householdUser)
    .where(inArray(householdUser.householdId, hh))
    .groupBy(householdUser.householdId, householdUser.role);
  const plans = await rt.db
    .select({ householdId: planDay.householdId, n: count() })
    .from(planDay)
    .where(and(inArray(planDay.householdId, hh), gte(planDay.generatedAt, since)))
    .groupBy(planDay.householdId);
  const calls = await rt.db
    .select({ householdId: aiGeneration.householdId, n: count() })
    .from(aiGeneration)
    .where(and(inArray(aiGeneration.householdId, hh), gte(aiGeneration.createdAt, since)))
    .groupBy(aiGeneration.householdId);
  const sum = (list: { householdId: string; n: number }[], id: string) =>
    list.filter((l) => l.householdId === id).reduce((s, l) => s + l.n, 0);
  return rows
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => ({
      id: h.id,
      name: h.name,
      admins: sum(
        logins.filter((l) => l.role === "admin"),
        h.id,
      ),
      logins: sum(logins, h.id),
      plans30d: sum(plans, h.id),
      aiCalls30d: sum(calls, h.id),
      status: statusOf(h),
      createdAt: h.createdAt.toISOString(),
    }));
}

export async function households(rt: Runtime) {
  return { households: await householdSummaries(rt) };
}

async function one(rt: Runtime, id: string) {
  const [row] = await householdSummaries(rt, [id]);
  if (row === undefined) throw notFound("household");
  return row;
}

async function householdRow(rt: Runtime, id: string): Promise<HouseholdRow> {
  const [h] = await rt.db.select().from(household).where(eq(household.id, id));
  if (h === undefined) throw notFound("household");
  return h;
}

export async function suspend(rt: Runtime, id: string) {
  const h = await householdRow(rt, id);
  if (h.suspendedAt !== null)
    throw conflict("already_suspended", "the household is already suspended");
  await rt.db.update(household).set({ suspendedAt: new Date() }).where(eq(household.id, id));
  return one(rt, id);
}

export async function reactivate(rt: Runtime, id: string) {
  const h = await householdRow(rt, id);
  if (h.suspendedAt === null) throw conflict("not_suspended", "the household is not suspended");
  await rt.db.update(household).set({ suspendedAt: null }).where(eq(household.id, id));
  return one(rt, id);
}

/** Operator delete: only a suspended household; the same 14-day grace its admins can cancel. */
export async function startDeletion(rt: Runtime, operator: SessionInfo, id: string) {
  const h = await householdRow(rt, id);
  if (h.suspendedAt === null)
    throw conflict("not_suspended", "suspend the household before deleting it");
  if (h.deletionRequestedAt !== null)
    throw conflict("deletion_requested", "deletion is already requested");
  const now = new Date();
  await rt.db
    .update(household)
    .set({
      deletionRequestedAt: now,
      deletionRequestedByUserId: operator.user.id,
      deletionConfirmedAt: now,
      deletionConfirmedByUserId: operator.user.id,
    })
    .where(eq(household.id, id));
  return one(rt, id);
}

async function userSummaries(rt: Runtime, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const users = await rt.db
    .select()
    .from(user)
    .where(inArray(user.id, [...ids]));
  const logins = await rt.db
    .select({ login: householdUser, name: household.name })
    .from(householdUser)
    .innerJoin(household, eq(household.id, householdUser.householdId))
    .where(inArray(householdUser.userId, [...ids]));
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    platformBlocked: u.platformBlockedAt !== null,
    memberships: logins
      .filter((l) => l.login.userId === u.id)
      .map((l) => ({
        householdId: l.login.householdId,
        householdName: l.name,
        role: l.login.role,
        status: l.login.status,
      })),
  }));
}

export async function users(rt: Runtime, q: string) {
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await rt.db
    .select({ id: user.id })
    .from(user)
    .where(or(ilike(user.email, pattern), ilike(user.name, pattern)))
    .limit(50);
  return {
    users: await userSummaries(
      rt,
      rows.map((r) => r.id),
    ),
  };
}

async function oneUser(rt: Runtime, id: string) {
  const [row] = await userSummaries(rt, [id]);
  if (row === undefined) throw notFound("user");
  return row;
}

export async function blockUser(rt: Runtime, operator: SessionInfo, id: string) {
  if (id === operator.user.id) throw conflict("self_block", "an operator cannot block themselves");
  await oneUser(rt, id);
  await rt.db
    .update(user)
    .set({ platformBlockedAt: new Date() })
    .where(and(eq(user.id, id), isNull(user.platformBlockedAt)));
  await revokeAllSessions(rt, id);
  return oneUser(rt, id);
}

export async function unblockUser(rt: Runtime, id: string) {
  await oneUser(rt, id);
  await rt.db.update(user).set({ platformBlockedAt: null }).where(eq(user.id, id));
  return oneUser(rt, id);
}

export async function aiUsage(rt: Runtime, days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const rows = await rt.db
    .select({
      model: aiGeneration.model,
      purpose: aiGeneration.purpose,
      calls: count(),
      inputTokens: sql<string>`coalesce(sum(${aiGeneration.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${aiGeneration.outputTokens}), 0)`,
      cacheReadTokens: sql<string>`coalesce(sum(${aiGeneration.cacheReadTokens}), 0)`,
    })
    .from(aiGeneration)
    .where(gte(aiGeneration.createdAt, from))
    .groupBy(aiGeneration.model, aiGeneration.purpose);
  const out = rows
    .map((r) => {
      const tokens = {
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: Number(r.cacheReadTokens),
      };
      return {
        model: r.model,
        purpose: r.purpose,
        calls: r.calls,
        ...tokens,
        costUsd: costUsd(r.model, tokens),
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.purpose.localeCompare(b.purpose));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows: out,
    totalCostUsd: out.reduce((s, r) => s + (r.costUsd ?? 0), 0),
  };
}

export async function failed(rt: Runtime, hours: number) {
  const rows = await failedJobs(rt.db, { since: new Date(Date.now() - hours * 3_600_000) }, 200);
  return { jobs: plain(rows) };
}

// Support access (grant-gated, logged) -----------------------------------------------------------

export const supportRequired = () =>
  new ProblemError(
    403,
    "support_grant_required",
    "this household has not granted you support access",
  );

/**
 * Runs `read` for the operator on the household only under an active grant, after logging the
 * access. The log row and the read share one transaction's outcome: if logging fails, nothing is
 * returned.
 */
export async function withSupport<T>(
  rt: Runtime,
  request: Request,
  operator: SessionInfo,
  householdId: string,
  read: (caller: CallerContext) => Promise<T>,
): Promise<T> {
  const now = new Date();
  const [grant] = await rt.db
    .select()
    .from(supportGrant)
    .where(
      and(
        eq(supportGrant.householdId, householdId),
        eq(supportGrant.operatorUserId, operator.user.id),
        isNull(supportGrant.revokedAt),
        gt(supportGrant.expiresAt, now),
      ),
    )
    .orderBy(desc(supportGrant.expiresAt))
    .limit(1);
  if (grant === undefined) throw supportRequired();
  const h = await householdRow(rt, householdId);
  await rt.db.insert(supportAccess).values({
    id: newId(),
    householdId,
    grantId: grant.id,
    operatorUserId: operator.user.id,
    method: request.method,
    path: new URL(request.url).pathname,
    createdAt: now,
  });
  // A read-only view with admin visibility inside the granted household (no writes are exposed).
  const caller: CallerContext = {
    ...operator,
    ctx: { householdId, userId: operator.user.id, role: "admin" },
    household: h,
    memberId: null,
  };
  return read(caller);
}

export async function supportSummaryView(rt: Runtime, caller: CallerContext) {
  const hh = caller.ctx.householdId;
  const [members] = await rt.db
    .select({ n: count() })
    .from(member)
    .where(eq(member.householdId, hh));
  const [logins] = await rt.db
    .select({ n: count() })
    .from(householdUser)
    .where(eq(householdUser.householdId, hh));
  const [days] = await rt.db
    .select({ n: count() })
    .from(planDay)
    .where(eq(planDay.householdId, hh));
  const [pending] = await rt.db
    .select({ n: count() })
    .from(proposal)
    .where(and(eq(proposal.householdId, hh), eq(proposal.status, "pending")));
  return {
    household: householdDto(caller.household),
    members: members?.n ?? 0,
    logins: logins?.n ?? 0,
    planDays: days?.n ?? 0,
    pendingProposals: pending?.n ?? 0,
  };
}

export async function supportMembersView(rt: Runtime, caller: CallerContext) {
  const rows = await rt.db
    .select()
    .from(member)
    .where(eq(member.householdId, caller.ctx.householdId));
  return { members: plain(rows) };
}

export async function supportPlansView(
  rt: Runtime,
  caller: CallerContext,
  from: string,
  to: string,
) {
  return planDays(rt, caller, from, to);
}

export async function supportChangeLogView(rt: Runtime, caller: CallerContext) {
  return changeLog(rt, caller.ctx, { limit: 100 });
}
