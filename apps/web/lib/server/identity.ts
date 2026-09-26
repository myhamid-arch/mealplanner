// Sign-up, invites, people & access and the account screen (ARC-6, R2-ADM-1 … 5; leaf-1.4.1
// SPEC-Q-3 … 6, SPEC-Q-22). Membership rows created by sign-up and invite acceptance are the auth
// flow (DM-6 exception, R-24); every other change to a login goes through a change set.
import { randomInt } from "node:crypto";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { InviteCreateBody, InviteDto } from "@mealplanner/api-contract/contract";
import type { HouseholdRole } from "@mealplanner/core/types";
import {
  account,
  household,
  householdUser,
  invite,
  member,
  newId,
  platformOperator,
  session,
  twoFactor,
  user,
  userNotificationPref,
} from "@mealplanner/db/schema";
import { activeAdminCount, applyChangeSet } from "@mealplanner/db/services/changes";
import { createHousehold } from "@mealplanner/db/services/config";
import type { CallerContext, SessionInfo } from "../auth/context";
import { emailNotConfigured } from "./mail";
import { ProblemError, conflict, notFound } from "./problem";
import { Reply } from "./route";
import type { Runtime } from "./runtime";
import { iso } from "./serialize";

// Sessions -------------------------------------------------------------------------------------

/** Deletes every session of the user (R2-ADM-4: the next request is 401). Returns how many. */
export async function revokeAllSessions(rt: Runtime, userId: string): Promise<number> {
  const rows = await rt.db
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id });
  return rows.length;
}

/** Signs in and returns the session with the auth cookies to set (and the bearer token). */
async function signIn(rt: Runtime, email: string, password: string) {
  const result = await rt.auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const headers = new Headers();
  for (const cookie of result.headers.getSetCookie()) headers.append("set-cookie", cookie);
  const token = result.headers.get("set-auth-token") ?? result.response.token;
  return { headers, token, userId: result.response.user.id };
}

async function emailTaken(rt: Runtime, email: string): Promise<boolean> {
  const [row] = await rt.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return row !== undefined;
}

async function createUser(
  rt: Runtime,
  body: { email: string; password: string; name: string },
): Promise<string> {
  if (await emailTaken(rt, body.email))
    throw conflict("email_taken", "an account with this email exists; sign in instead");
  const created = await rt.auth.api.signUpEmail({ body });
  return created.user.id;
}

async function deleteUserCompletely(rt: Runtime, userId: string): Promise<void> {
  await rt.db.delete(session).where(eq(session.userId, userId));
  await rt.db.delete(account).where(eq(account.userId, userId));
  await rt.db.delete(user).where(eq(user.id, userId));
}

/** ARC-6: signing up creates a user and a household; the user becomes admin (SPEC-Q-3). */
export async function signupUser(
  rt: Runtime,
  body: { email: string; password: string; name: string; householdName: string },
) {
  const userId = await createUser(rt, body);
  let householdId: string;
  try {
    householdId = (await createHousehold(rt.db, { name: body.householdName, adminUserId: userId }))
      .householdId;
  } catch (error) {
    await deleteUserCompletely(rt, userId);
    throw error;
  }
  const signedIn = await signIn(rt, body.email, body.password);
  return new Reply(
    {
      user: { id: userId, email: body.email, name: body.name },
      householdId,
      token: signedIn.token,
    },
    { status: 201, headers: signedIn.headers },
  );
}

// Invites (R2-ADM-2) ---------------------------------------------------------------------------

/** 31 symbols, no look-alikes (0/O, 1/I/L). */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const EXPIRY_MS = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;

export function inviteCode(): string {
  let code = "";
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
  return code;
}

type InviteRow = typeof invite.$inferSelect;

export function inviteDto(
  rt: Runtime,
  row: InviteRow,
  now = new Date(),
): z.input<typeof InviteDto> {
  const status =
    row.usedAt !== null
      ? "used"
      : row.revokedAt !== null
        ? "revoked"
        : row.expiresAt <= now
          ? "expired"
          : "open";
  return {
    id: row.id,
    code: row.code,
    link: `${rt.config.appUrl}/invite/${row.code}`,
    role: row.role,
    memberId: row.memberId,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: iso(row.usedAt),
    revokedAt: iso(row.revokedAt),
    createdAt: row.createdAt.toISOString(),
    status,
  };
}

async function sendInviteEmail(rt: Runtime, to: string, row: InviteRow, householdName: string) {
  await rt.mailer.send({
    to,
    subject: `You're invited to ${householdName}`,
    text: `You have been invited to ${householdName} as ${row.role}. Open ${rt.config.appUrl}/invite/${row.code} or enter the code ${row.code}. The invite works once and expires on ${row.expiresAt.toUTCString()}.`,
  });
}

async function insertInvite(
  rt: Runtime,
  caller: CallerContext,
  args: { role: HouseholdRole; memberId: string | null; ttlMs: number },
): Promise<InviteRow> {
  if (args.memberId !== null) {
    const [m] = await rt.db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, args.memberId), eq(member.householdId, caller.ctx.householdId)));
    if (m === undefined)
      throw new ProblemError(422, "unknown_member", "the member is not in this household");
  }
  const now = new Date();
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await rt.db
      .insert(invite)
      .values({
        id: newId(),
        householdId: caller.ctx.householdId,
        code: inviteCode(),
        role: args.role,
        memberId: args.memberId,
        expiresAt: new Date(now.getTime() + args.ttlMs),
        usedAt: null,
        revokedAt: null,
        createdByUserId: caller.ctx.userId,
        createdAt: now,
      })
      .onConflictDoNothing({ target: invite.code })
      .returning();
    const row = rows[0];
    if (row !== undefined) return row;
  }
  throw new Error("could not allocate an invite code");
}

export async function createInvite(
  rt: Runtime,
  caller: CallerContext,
  body: z.output<typeof InviteCreateBody>,
) {
  if (body.channel === "email" && !rt.mailer.configured) throw emailNotConfigured();
  const row = await insertInvite(rt, caller, {
    role: body.role,
    memberId: body.memberId,
    ttlMs: EXPIRY_MS[body.expiresIn],
  });
  if (body.channel === "email" && body.email !== undefined)
    await sendInviteEmail(rt, body.email, row, caller.household.name);
  return inviteDto(rt, row);
}

async function householdInvite(rt: Runtime, caller: CallerContext, id: string): Promise<InviteRow> {
  const [row] = await rt.db
    .select()
    .from(invite)
    .where(and(eq(invite.id, id), eq(invite.householdId, caller.ctx.householdId)));
  if (row === undefined) throw notFound("invite");
  return row;
}

export async function revokeInvite(rt: Runtime, caller: CallerContext, id: string) {
  const row = await householdInvite(rt, caller, id);
  if (row.usedAt !== null) throw conflict("invite_used", "the invite has been used");
  if (row.revokedAt !== null) return inviteDto(rt, row);
  const [updated] = await rt.db
    .update(invite)
    .set({ revokedAt: new Date() })
    .where(and(eq(invite.id, id), isNull(invite.usedAt)))
    .returning();
  if (updated === undefined) throw conflict("invite_used", "the invite has been used");
  return inviteDto(rt, updated);
}

/** Resend: a fresh code with the same role, member and lifetime; the old invite is revoked. */
export async function resendInvite(
  rt: Runtime,
  caller: CallerContext,
  id: string,
  body: { channel: "link" | "email"; email?: string | undefined },
) {
  const old = await householdInvite(rt, caller, id);
  if (old.usedAt !== null) throw conflict("invite_used", "the invite has been used");
  if (body.channel === "email" && !rt.mailer.configured) throw emailNotConfigured();
  if (old.revokedAt === null) await revokeInvite(rt, caller, id);
  const row = await insertInvite(rt, caller, {
    role: old.role,
    memberId: old.memberId,
    ttlMs: Math.max(EXPIRY_MS["24h"], old.expiresAt.getTime() - old.createdAt.getTime()),
  });
  if (body.channel === "email" && body.email !== undefined)
    await sendInviteEmail(rt, body.email, row, caller.household.name);
  return inviteDto(rt, row);
}

export async function listInvites(rt: Runtime, caller: CallerContext) {
  const rows = await rt.db
    .select()
    .from(invite)
    .where(eq(invite.householdId, caller.ctx.householdId));
  return {
    invites: rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => inviteDto(rt, r)),
  };
}

const inviteGone = () =>
  new ProblemError(410, "invite_invalid", "this invite has been used, revoked or has expired");

export async function lookupInvite(rt: Runtime, code: string) {
  const [row] = await rt.db
    .select({ invite, householdName: household.name })
    .from(invite)
    .innerJoin(household, eq(household.id, invite.householdId))
    .where(eq(invite.code, code.toUpperCase()));
  if (row === undefined || inviteDto(rt, row.invite).status !== "open") throw inviteGone();
  let memberName: string | null = null;
  if (row.invite.memberId !== null) {
    const [m] = await rt.db
      .select({ name: member.displayName })
      .from(member)
      .where(eq(member.id, row.invite.memberId));
    memberName = m?.name ?? null;
  }
  return {
    householdName: row.householdName,
    role: row.invite.role,
    memberName,
    expiresAt: row.invite.expiresAt.toISOString(),
  };
}

/**
 * Accepts an invite (SPEC-Q-4): one transaction claims it (`used_at` set only while it is unused,
 * unrevoked and unexpired, so concurrent accepts cannot both succeed) and adds the login.
 */
/** The user whose email and password these are, or null (library password hashing, ARC-10). */
async function checkCredentials(
  rt: Runtime,
  credentials: { email: string; password: string },
): Promise<string | null> {
  const [row] = await rt.db
    .select({ userId: user.id, hash: account.password })
    .from(user)
    .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
    .where(eq(user.email, credentials.email.toLowerCase()));
  if (row?.hash === null || row?.hash === undefined) return null;
  const ctx = await rt.auth.$context;
  return (await ctx.password.verify({ hash: row.hash, password: credentials.password }))
    ? row.userId
    : null;
}

export async function acceptInvite(
  rt: Runtime,
  body: {
    code: string;
    signup?: { email: string; password: string; name: string } | undefined;
    credentials?: { email: string; password: string } | undefined;
  },
  session: SessionInfo | null,
) {
  const code = body.code.toUpperCase();
  let userId: string;
  let created = false;
  let signInWith: { email: string; password: string } | null = null;
  if (body.signup !== undefined) {
    // Refuse early for a code that cannot be claimed, so no user is created for nothing.
    await lookupInvite(rt, code);
    userId = await createUser(rt, body.signup);
    created = true;
    signInWith = body.signup;
  } else if (body.credentials !== undefined) {
    await lookupInvite(rt, code);
    const found = await checkCredentials(rt, body.credentials);
    if (found === null)
      throw new ProblemError(401, "invalid_credentials", "the email or password is wrong");
    const [blocked] = await rt.db
      .select({ at: user.platformBlockedAt })
      .from(user)
      .where(eq(user.id, found));
    if (blocked?.at !== null && blocked?.at !== undefined)
      throw new ProblemError(403, "account_blocked", "this account is blocked");
    userId = found;
    signInWith = body.credentials;
  } else if (session !== null) {
    userId = session.user.id;
  } else {
    throw new ProblemError(401, "unauthorized", "sign in, or sign up with the invite");
  }
  let accepted: { householdId: string; role: HouseholdRole };
  try {
    accepted = await rt.db.transaction(async (trx) => {
      const now = new Date();
      const [claimed] = await trx
        .update(invite)
        .set({ usedAt: now })
        .where(
          and(
            eq(invite.code, code),
            isNull(invite.usedAt),
            isNull(invite.revokedAt),
            gt(invite.expiresAt, now),
          ),
        )
        .returning();
      if (claimed === undefined) throw inviteGone();
      const [existing] = await trx
        .select({ userId: householdUser.userId })
        .from(householdUser)
        .where(
          and(eq(householdUser.householdId, claimed.householdId), eq(householdUser.userId, userId)),
        );
      if (existing !== undefined)
        throw conflict("already_member", "you already belong to this household");
      if (claimed.memberId !== null) {
        // Serialise concurrent accepts of invites bound to the same member (one login each).
        await trx.execute(sql`SELECT 1 FROM member WHERE id = ${claimed.memberId} FOR UPDATE`);
        const [linked] = await trx
          .select({ userId: householdUser.userId })
          .from(householdUser)
          .where(
            and(
              eq(householdUser.householdId, claimed.householdId),
              eq(householdUser.memberId, claimed.memberId),
            ),
          );
        if (linked !== undefined)
          throw conflict("member_linked", "that member already has a login");
      }
      await trx.insert(householdUser).values({
        householdId: claimed.householdId,
        userId,
        role: claimed.role,
        memberId: claimed.memberId,
        status: "active",
        blockedReason: null,
        lastActiveAt: null,
        createdAt: now,
      });
      return { householdId: claimed.householdId, role: claimed.role };
    });
  } catch (error) {
    if (created) await deleteUserCompletely(rt, userId);
    throw error;
  }
  if (signInWith === null) return { ...accepted, userId, token: null };
  const signedIn = await signIn(rt, signInWith.email, signInWith.password);
  return new Reply({ ...accepted, userId, token: signedIn.token }, { headers: signedIn.headers });
}

// People & access (R2-ADM-3/4) -------------------------------------------------------------------

export async function listAccess(rt: Runtime, caller: CallerContext) {
  const logins = await rt.db
    .select({ login: householdUser, user: { id: user.id, name: user.name, email: user.email } })
    .from(householdUser)
    .innerJoin(user, eq(user.id, householdUser.userId))
    .where(eq(householdUser.householdId, caller.ctx.householdId));
  const members = await rt.db
    .select({ id: member.id, displayName: member.displayName, archivedAt: member.archivedAt })
    .from(member)
    .where(eq(member.householdId, caller.ctx.householdId));
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const linked = new Set(
    logins.map((l) => l.login.memberId).filter((m): m is string => m !== null),
  );
  return {
    logins: logins
      .map((l) => ({
        userId: l.user.id,
        name: l.user.name,
        email: l.user.email,
        role: l.login.role,
        status: l.login.status,
        memberId: l.login.memberId,
        memberName: l.login.memberId === null ? null : (names.get(l.login.memberId) ?? null),
        lastActiveAt: iso(l.login.lastActiveAt),
        blockedReason: l.login.blockedReason,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    membersWithoutLogin: members
      .filter((m) => m.archivedAt === null && !linked.has(m.id))
      .map((m) => ({ memberId: m.id, displayName: m.displayName })),
  };
}

async function requireLogin(rt: Runtime, caller: CallerContext, userId: string) {
  const [row] = await rt.db
    .select({ login: householdUser, email: user.email })
    .from(householdUser)
    .innerJoin(user, eq(user.id, householdUser.userId))
    .where(
      and(eq(householdUser.householdId, caller.ctx.householdId), eq(householdUser.userId, userId)),
    );
  if (row === undefined) throw notFound("login");
  return row;
}

/** An admin's change to a login, applied from the UI (protected ops are allowed there, AGT-5). */
async function accessChange(
  rt: Runtime,
  caller: CallerContext,
  summary: string,
  op: { kind: string; payload: unknown },
) {
  return applyChangeSet(rt.db, caller.ctx, { actor: "user", source: "ui", summary, ops: [op] });
}

export async function changeRole(
  rt: Runtime,
  caller: CallerContext,
  userId: string,
  role: HouseholdRole,
) {
  await requireLogin(rt, caller, userId);
  const applied = await accessChange(rt, caller, `Change role to ${role}`, {
    kind: "role.set",
    payload: { userId, role },
  });
  return { changeSetId: applied.changeSetId };
}

export async function blockLogin(
  rt: Runtime,
  caller: CallerContext,
  userId: string,
  reason: string | undefined,
) {
  await requireLogin(rt, caller, userId);
  const applied = await accessChange(rt, caller, "Block login", {
    kind: "access.block",
    payload: { userId, ...(reason === undefined ? {} : { reason }) },
  });
  return { changeSetId: applied.changeSetId, sessionsRevoked: await revokeAllSessions(rt, userId) };
}

export async function unblockLogin(rt: Runtime, caller: CallerContext, userId: string) {
  await requireLogin(rt, caller, userId);
  const applied = await accessChange(rt, caller, "Unblock login", {
    kind: "access.unblock",
    payload: { userId },
  });
  return { changeSetId: applied.changeSetId };
}

export async function removeLogin(
  rt: Runtime,
  caller: CallerContext,
  userId: string,
  body: { reason?: string | undefined; archiveMember: boolean },
) {
  await requireLogin(rt, caller, userId);
  const applied = await accessChange(
    rt,
    caller,
    body.archiveMember ? "Remove login and archive member" : "Remove login",
    {
      kind: "access.remove",
      payload: {
        userId,
        archiveMember: body.archiveMember,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      },
    },
  );
  return { changeSetId: applied.changeSetId, sessionsRevoked: await revokeAllSessions(rt, userId) };
}

export async function linkMember(
  rt: Runtime,
  caller: CallerContext,
  userId: string,
  memberId: string | null,
) {
  await requireLogin(rt, caller, userId);
  const applied = await accessChange(
    rt,
    caller,
    memberId === null ? "Unlink login" : "Link login to member",
    {
      kind: "access.link_member",
      payload: { userId, memberId },
    },
  );
  return { changeSetId: applied.changeSetId };
}

export async function sendPasswordReset(rt: Runtime, caller: CallerContext, userId: string) {
  const row = await requireLogin(rt, caller, userId);
  if (!rt.mailer.configured) throw emailNotConfigured();
  await rt.auth.api.requestPasswordReset({
    body: { email: row.email, redirectTo: `${rt.config.appUrl}/reset-password` },
  });
  return { ok: true as const };
}

export async function signOutEverywhere(rt: Runtime, caller: CallerContext, userId: string) {
  await requireLogin(rt, caller, userId);
  return { sessionsRevoked: await revokeAllSessions(rt, userId) };
}

// Account (R2-ADM-5) -----------------------------------------------------------------------------

export async function accountView(rt: Runtime, s: SessionInfo) {
  const prefs = await rt.db
    .select()
    .from(userNotificationPref)
    .where(eq(userNotificationPref.userId, s.user.id));
  return {
    user: { id: s.user.id, email: s.user.email, name: s.user.name },
    twoFactorEnabled: s.user.twoFactorEnabled,
    notifications: prefs
      .map((p) => ({ key: p.key, enabled: p.enabled }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export async function setNotifications(
  rt: Runtime,
  s: SessionInfo,
  prefs: readonly { key: string; enabled: boolean }[],
) {
  await rt.db.transaction(async (trx) => {
    await trx.delete(userNotificationPref).where(eq(userNotificationPref.userId, s.user.id));
    const unique = new Map(prefs.map((p) => [p.key, p.enabled]));
    if (unique.size > 0)
      await trx
        .insert(userNotificationPref)
        .values([...unique].map(([key, enabled]) => ({ userId: s.user.id, key, enabled })));
  });
  return { notifications: (await accountView(rt, s)).notifications };
}

export async function renameUser(rt: Runtime, s: SessionInfo, name: string) {
  await rt.db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, s.user.id));
  return { id: s.user.id, email: s.user.email, name };
}

export async function listSessions(rt: Runtime, s: SessionInfo) {
  const rows = await rt.db.select().from(session).where(eq(session.userId, s.user.id));
  return {
    sessions: rows
      .filter((r) => r.expiresAt > new Date())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        current: r.id === s.sessionId,
      })),
  };
}

export async function revokeSession(rt: Runtime, s: SessionInfo, sessionId: string) {
  const rows = await rt.db
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, s.user.id)))
    .returning({ id: session.id });
  if (rows.length === 0) throw notFound("session");
}

/** Households where the user is an active admin that require TOTP for admins. */
async function totpRequiredBy(rt: Runtime, userId: string): Promise<string[]> {
  const rows = await rt.db
    .select({ id: household.id })
    .from(householdUser)
    .innerJoin(household, eq(household.id, householdUser.householdId))
    .where(
      and(
        eq(householdUser.userId, userId),
        eq(householdUser.role, "admin"),
        ne(householdUser.status, "blocked"),
        eq(household.requireTotpForAdmins, true),
      ),
    );
  return rows.map((r) => r.id);
}

function authHeaders(request: Request): Headers {
  return request.headers;
}

export async function enableTotp(rt: Runtime, request: Request, password: string) {
  try {
    const r = await rt.auth.api.enableTwoFactor({
      body: { password },
      headers: authHeaders(request),
    });
    if (r.method !== "totp") throw new Error("two-factor setup did not return a TOTP secret");
    return { totpUri: r.totpURI, backupCodes: r.backupCodes };
  } catch (error) {
    throw authFailure(error, "invalid_password");
  }
}

/**
 * Confirms TOTP setup. Enabling two-step sign-in replaces the session (the auth library deletes
 * the old one), so the new bearer token is returned and the session cookie forwarded.
 */
export async function verifyTotp(rt: Runtime, request: Request, code: string) {
  let headers: Headers;
  try {
    const result = await rt.auth.api.verifyTOTP({
      body: { code },
      headers: authHeaders(request),
      returnHeaders: true,
    });
    headers = result.headers;
  } catch (error) {
    throw authFailure(error, "invalid_code");
  }
  const forwarded = new Headers();
  for (const cookie of headers.getSetCookie()) forwarded.append("set-cookie", cookie);
  return new Reply(
    { twoFactorEnabled: true as const, token: headers.get("set-auth-token") },
    { headers: forwarded },
  );
}

export async function disableTotp(rt: Runtime, request: Request, s: SessionInfo, password: string) {
  if ((await totpRequiredBy(rt, s.user.id)).length > 0)
    throw conflict(
      "totp_required",
      "a household you administer requires two-step sign-in for admins",
    );
  try {
    await rt.auth.api.disableTwoFactor({ body: { password }, headers: authHeaders(request) });
  } catch (error) {
    throw authFailure(error, "invalid_password");
  }
  return { twoFactorEnabled: false as const };
}

export async function changePassword(
  rt: Runtime,
  request: Request,
  body: { currentPassword: string; newPassword: string },
) {
  try {
    await rt.auth.api.changePassword({
      body: { ...body, revokeOtherSessions: true },
      headers: authHeaders(request),
    });
  } catch (error) {
    throw authFailure(error, "invalid_password");
  }
  return { ok: true as const };
}

/** Better Auth's API errors (wrong password, bad code) as 422 problems; others rethrown. */
function authFailure(error: unknown, code: string): unknown {
  const status = (error as { statusCode?: unknown; status?: unknown } | null)?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500)
    return new ProblemError(422, code, (error as Error).message);
  return error;
}

/**
 * Deletes the caller's account (R2-ADM-5, SPEC-Q-22): refused for a household's last active admin;
 * otherwise each login is removed through a change set (the change log keeps its history), and the
 * user's credentials, sessions and TOTP secret are deleted and the user row anonymised (other rows
 * such as reviews and change sets keep referring to it).
 */
export async function deleteAccount(
  rt: Runtime,
  request: Request,
  s: SessionInfo,
  password: string,
) {
  try {
    await rt.auth.api.verifyPassword({ body: { password }, headers: authHeaders(request) });
  } catch (error) {
    throw authFailure(error, "invalid_password");
  }
  const logins = await rt.db
    .select()
    .from(householdUser)
    .where(eq(householdUser.userId, s.user.id));
  for (const l of logins)
    if (
      l.role === "admin" &&
      l.status === "active" &&
      (await activeAdminCount(rt.db, l.householdId)) <= 1
    )
      throw conflict(
        "last_admin",
        "you are the last admin of a household; make someone else admin first",
      );
  for (const l of logins)
    await applyChangeSet(
      rt.db,
      { householdId: l.householdId, userId: s.user.id, role: l.role },
      {
        actor: "user",
        source: "ui",
        summary: "Account deleted",
        ops: [{ kind: "access.remove", payload: { userId: s.user.id } }],
      },
    );
  await rt.db.transaction(async (trx) => {
    await trx.delete(session).where(eq(session.userId, s.user.id));
    await trx.delete(account).where(eq(account.userId, s.user.id));
    await trx.delete(twoFactor).where(eq(twoFactor.userId, s.user.id));
    await trx.delete(userNotificationPref).where(eq(userNotificationPref.userId, s.user.id));
    await trx
      .update(user)
      .set({
        email: `deleted-${s.user.id}@deleted.invalid`,
        name: "Deleted user",
        image: null,
        twoFactorEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(user.id, s.user.id));
  });
}

export async function meView(rt: Runtime, s: SessionInfo) {
  const rows = await rt.db
    .select({ login: householdUser, name: household.name })
    .from(householdUser)
    .innerJoin(household, eq(household.id, householdUser.householdId))
    .where(eq(householdUser.userId, s.user.id));
  const [op] = await rt.db
    .select({ userId: platformOperator.userId })
    .from(platformOperator)
    .where(eq(platformOperator.userId, s.user.id));
  return {
    user: s.user,
    memberships: rows.map((r) => ({
      householdId: r.login.householdId,
      householdName: r.name,
      role: r.login.role,
      status: r.login.status,
      memberId: r.login.memberId,
    })),
    platformOperator: op !== undefined,
  };
}
