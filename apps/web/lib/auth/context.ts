// Who is calling (ARC-4, ARC-6; leaf-1.4.1 SPEC-Q-2, -5, -6): the session (cookie or bearer), the
// household it acts on, the login's role and status, and the checks that apply to every request:
// - a platform-blocked user, or a blocked login, is refused with 401 (its sessions are gone too);
// - a suspended household is refused with 403 `household_suspended` (R2-ADM-8);
// - an admin without TOTP in a household that requires it gets 403 `totp_required` (R2-ADM-5);
// - the role must be in the endpoint's ARC-6 row (403 `forbidden_role`).
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { HouseholdRole } from "@mealplanner/core/types";
import type { HouseholdContext } from "@mealplanner/core/types";
import { household, householdUser, platformOperator, user } from "@mealplanner/db/schema";
import { ProblemError, forbidden, notFound, unauthorized } from "../server/problem";
import type { Runtime } from "../server/runtime";

export interface SessionInfo {
  sessionId: string;
  token: string;
  user: { id: string; email: string; name: string; twoFactorEnabled: boolean };
}

export interface CallerContext extends SessionInfo {
  ctx: HouseholdContext & { userId: string };
  household: typeof household.$inferSelect;
  memberId: string | null;
}

/** How often `household_user.last_active_at` is refreshed (R2-ADM-3 "last active"). */
const LAST_ACTIVE_EVERY_MS = 5 * 60 * 1000;

/** The session of the request, or null. Platform-blocked users have no usable session. */
export async function readSession(rt: Runtime, request: Request): Promise<SessionInfo | null> {
  const found = await rt.auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (found === null) return null;
  const [u] = await rt.db
    .select({ blocked: user.platformBlockedAt, twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, found.user.id));
  if (u === undefined || u.blocked !== null) return null;
  return {
    sessionId: found.session.id,
    token: found.session.token,
    user: {
      id: found.user.id,
      email: found.user.email,
      name: found.user.name,
      twoFactorEnabled: u.twoFactorEnabled,
    },
  };
}

export async function requireSession(rt: Runtime, request: Request): Promise<SessionInfo> {
  const s = await readSession(rt, request);
  if (s === null) throw unauthorized();
  return s;
}

/** The household routes act on: `X-Household-Id`, or the user's single membership (SPEC-Q-2). */
export async function requireHousehold(
  rt: Runtime,
  request: Request,
  roles: readonly HouseholdRole[],
  opts: { allowWithoutTotp?: boolean } = {},
): Promise<CallerContext> {
  const s = await requireSession(rt, request);
  const rows = await rt.db
    .select({ login: householdUser, household })
    .from(householdUser)
    .innerJoin(household, eq(household.id, householdUser.householdId))
    .where(eq(householdUser.userId, s.user.id));
  const wanted = request.headers.get("x-household-id");
  let row: (typeof rows)[number] | undefined;
  if (wanted !== null && wanted !== "") {
    row = rows.find((r) => r.household.id === wanted);
    if (row === undefined) throw notFound("household");
  } else {
    const usable = rows.filter((r) => r.login.status !== "blocked");
    if (usable.length > 1)
      throw new ProblemError(
        409,
        "household_ambiguous",
        "choose a household with the X-Household-Id header",
      );
    row = usable[0] ?? rows[0];
  }
  if (row === undefined) throw forbidden("no_household", "this login has no household");
  if (row.login.status === "blocked") throw unauthorized("this login is blocked");
  if (row.household.suspendedAt !== null)
    throw forbidden("household_suspended", "this household is suspended");
  const role = row.login.role;
  if (!roles.includes(role)) throw forbidden("forbidden_role", `not allowed for role ${role}`);
  if (
    role === "admin" &&
    row.household.requireTotpForAdmins &&
    !s.user.twoFactorEnabled &&
    opts.allowWithoutTotp !== true
  )
    throw forbidden("totp_required", "this household requires two-step sign-in for admins");
  const now = new Date();
  if (
    row.login.lastActiveAt === null ||
    now.getTime() - row.login.lastActiveAt.getTime() > LAST_ACTIVE_EVERY_MS
  )
    await rt.db
      .update(householdUser)
      .set({ lastActiveAt: now })
      .where(
        and(eq(householdUser.householdId, row.household.id), eq(householdUser.userId, s.user.id)),
      );
  return {
    ...s,
    ctx: { householdId: row.household.id, userId: s.user.id, role },
    household: row.household,
    memberId: row.login.memberId,
  };
}

/** A platform operator (R2-ADM-8). */
export async function requireOperator(rt: Runtime, request: Request): Promise<SessionInfo> {
  const s = await requireSession(rt, request);
  const [op] = await rt.db
    .select({ userId: platformOperator.userId })
    .from(platformOperator)
    .where(eq(platformOperator.userId, s.user.id));
  if (op === undefined) throw forbidden("not_operator", "platform operators only");
  return s;
}

export type Db = NodePgDatabase;
