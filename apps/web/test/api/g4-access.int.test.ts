// G4 (R2-ADM): blocking a login revokes all its sessions immediately (the next request is 401, and
// sign-in is refused); invites are single-use and expire (a second, expired or revoked accept is
// 410; concurrent accepts of one invite admit exactly one); TOTP is enforced for admins when the
// household requires it (403 until enabled; sign-in then needs the second step).
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { applyChangeSet } from "@mealplanner/db/services/changes";
import {
  household,
  householdUser,
  invite as inviteTable,
  session,
  user,
} from "@mealplanner/db/schema";
import { ANON, authCall, callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { measure } from "./support/measure";
import { secretOf, totpCode } from "./support/totp";
import {
  acceptWithSignup,
  applyOps,
  invite,
  ok,
  operatorLogin,
  signupAdmin,
  uniqueEmail,
  type Login,
} from "./support/world";

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };
let b: Login & { householdId: string };

beforeAll(async () => {
  db = await createTestDatabase({ seed: false });
  app = startTestApp(db.url);
  a = await signupAdmin("Household A");
  b = await signupAdmin("Household B");
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

async function sessionsOf(userId: string): Promise<number> {
  const [row] = await app.rt.db
    .select({ n: sql<number>`count(*)::int` })
    .from(session)
    .where(eq(session.userId, userId));
  return row?.n ?? 0;
}

async function signIn(
  email: string,
  password: string,
): Promise<{ status: number; token: string | null; json: unknown; cookies: string[] }> {
  const res = await authCall("/sign-in/email", { email, password });
  const text = await res.text();
  return {
    status: res.status,
    token: res.headers.get("set-auth-token"),
    json: text === "" ? null : (JSON.parse(text) as unknown),
    cookies: res.headers.getSetCookie(),
  };
}

const cookieHeader = (setCookies: string[]) => setCookies.map((s) => s.split(";")[0]).join("; ");

describe("G4 block revokes sessions", () => {
  it("G4 blocking a login deletes all its sessions at once: the next request is 401 and sign-in is refused; unblocking restores access", async () => {
    const l = await acceptWithSignup(await invite(a, "member", null), "Blocky");
    const second = await signIn(l.email, l.password);
    expect(second.status).toBe(200);
    const tokens = [l.token, second.token ?? ""];
    for (const t of tokens)
      expect((await callJson(c.membersList, {}, { token: t })).status).toBe(200);
    const before = await sessionsOf(l.userId);
    const blocked = ok<{ sessionsRevoked: number }>(
      await callJson(c.accessBlock, { params: { userId: l.userId }, body: { reason: "test" } }, a),
      "block",
    );
    const after = await sessionsOf(l.userId);
    const next = await Promise.all(tokens.map((t) => callJson(c.membersList, {}, { token: t })));
    const me = await callJson(c.me, {}, { token: l.token });
    const signInBlocked = await signIn(l.email, l.password);
    ok(await callJson(c.accessUnblock, { params: { userId: l.userId } }, a), "unblock");
    const signInAgain = await signIn(l.email, l.password);
    const restored = await callJson(c.membersList, {}, { token: signInAgain.token });
    measure("G4", "block", {
      sessionsBefore: before,
      sessionsRevoked: blocked.sessionsRevoked,
      sessionsAfter: after,
      nextStatuses: next.map((r) => r.status),
      meStatus: me.status,
      signInWhileBlocked: signInBlocked.status,
      signInAfterUnblock: signInAgain.status,
      restoredStatus: restored.status,
    });
    expect(before).toBe(2);
    expect(blocked.sessionsRevoked).toBe(2);
    expect(after).toBe(0);
    expect(next.map((r) => r.status)).toEqual([401, 401]);
    expect(me.status).toBe(401);
    expect(signInBlocked.status).toBe(403);
    expect(signInBlocked.token).toBeNull();
    expect(signInAgain.status).toBe(200);
    expect(restored.status).toBe(200);
  });

  it("G4 a platform block revokes every session of the user and refuses sign-in", async () => {
    const operator = await operatorLogin(app);
    const l = await acceptWithSignup(await invite(a, "kitchen", null), "Platformblock");
    ok(await callJson(c.platformBlock, { params: { id: l.userId } }, operator), "platform block");
    const after = await sessionsOf(l.userId);
    const next = await callJson(c.me, {}, l);
    const again = await signIn(l.email, l.password);
    measure("G4", "platform-block", {
      sessionsAfter: after,
      next: next.status,
      signIn: again.status,
    });
    expect(after).toBe(0);
    expect(next.status).toBe(401);
    expect(again.status).toBe(403);
  });

  it("G4 the last active admin cannot be blocked or removed", async () => {
    const solo = await signupAdmin("Solo");
    const self = await callJson(c.accessBlock, { params: { userId: solo.userId }, body: {} }, solo);
    const remove = await callJson(
      c.accessRemove,
      { params: { userId: solo.userId }, body: {} },
      solo,
    );
    measure("G4", "last-admin", { block: self.status, remove: remove.status });
    expect(self.status).toBe(409);
    expect(remove.status).toBe(409);
    expect(await sessionsOf(solo.userId)).toBeGreaterThan(0);
  });

  it("G4 negative control: an access.block applied without the session revocation leaves the sessions alive", async () => {
    const l = await acceptWithSignup(await invite(a, "member", null), "Naive");
    // Faulty block: the change set only (the API also deletes the sessions).
    await applyChangeSet(
      app.rt.db,
      { householdId: a.householdId, userId: a.userId, role: "admin" },
      {
        actor: "user",
        source: "ui",
        summary: "naive block",
        ops: [{ kind: "access.block", payload: { userId: l.userId } }],
      },
    );
    const left = await sessionsOf(l.userId);
    measure("G4", "negative-naive-block", { sessionsLeft: left });
    expect(left).toBeGreaterThan(0);
  });
});

describe("G4 invites", () => {
  it("G4 an invite is single-use: a second accept and a lookup after use are refused with 410", async () => {
    const code = await invite(a, "member", null);
    const lookup = await callJson(c.invitesLookup, { params: { code } }, ANON);
    const first = await acceptWithSignup(code, "Once");
    const again = await callJson(
      c.invitesAccept,
      {
        body: {
          code,
          signup: { email: uniqueEmail("twice"), password: "twice horse battery", name: "Twice" },
        },
      },
      ANON,
    );
    const signedInAgain = await callJson(c.invitesAccept, { body: { code } }, b);
    const lookupAfter = await callJson(c.invitesLookup, { params: { code } }, ANON);
    measure("G4", "single-use", {
      lookup: lookup.status,
      second: again.status,
      signedIn: signedInAgain.status,
      lookupAfter: lookupAfter.status,
    });
    expect(lookup.status).toBe(200);
    expect(first.userId).toBeTruthy();
    expect(again.status).toBe(410);
    expect(signedInAgain.status).toBe(410);
    expect(lookupAfter.status).toBe(410);
  });

  it("G4 an expired or revoked invite is refused with 410", async () => {
    const expiredCode = await invite(a, "member", null);
    await app.rt.db
      .update(inviteTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteTable.code, expiredCode));
    const created = ok<{ id: string; code: string }>(
      await callJson(c.invitesCreate, { body: { role: "kitchen", expiresIn: "24h" } }, a),
      "invite",
    );
    ok(await callJson(c.invitesRevoke, { params: { id: created.id } }, a), "revoke");
    const accept = (code: string) =>
      callJson(
        c.invitesAccept,
        {
          body: {
            code,
            signup: { email: uniqueEmail("late"), password: "late horse battery", name: "Late" },
          },
        },
        ANON,
      );
    const expired = await accept(expiredCode);
    const revoked = await accept(created.code);
    const expiredLookup = await callJson(c.invitesLookup, { params: { code: expiredCode } }, ANON);
    const [expiresAt] = await app.rt.db
      .select({ expiresAt: inviteTable.expiresAt, createdAt: inviteTable.createdAt })
      .from(inviteTable)
      .where(eq(inviteTable.id, created.id));
    const hours =
      expiresAt === undefined
        ? 0
        : (expiresAt.expiresAt.getTime() - expiresAt.createdAt.getTime()) / 3_600_000;
    measure("G4", "expiry", {
      expired: expired.status,
      revoked: revoked.status,
      expiredLookup: expiredLookup.status,
      ttlHours: hours,
    });
    expect(expired.status).toBe(410);
    expect(revoked.status).toBe(410);
    expect(expiredLookup.status).toBe(410);
    expect(hours).toBeCloseTo(24, 3);
  });

  it("G4 twenty concurrent accepts of one invite admit exactly one login", async () => {
    const code = await invite(a, "member", null);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        callJson(
          c.invitesAccept,
          {
            body: {
              code,
              signup: {
                email: uniqueEmail(`race${String(i)}`),
                password: "racing horse battery",
                name: `Race ${String(i)}`,
              },
            },
          },
          ANON,
        ),
      ),
    );
    const statuses = results.map((r) => r.status);
    const [used] = await app.rt.db.select().from(inviteTable).where(eq(inviteTable.code, code));
    const joined = await app.rt.db
      .select({ userId: householdUser.userId })
      .from(householdUser)
      .innerJoin(user, eq(user.id, householdUser.userId))
      .where(and(eq(householdUser.householdId, a.householdId), sql`${user.name} like 'Race %'`));
    // Refused sign-ups leave no user behind (no orphan accounts without a household).
    const raceUsers = await app.rt.db
      .select({ id: user.id })
      .from(user)
      .where(sql`${user.name} like 'Race %'`);
    measure("G4", "concurrent-accept", {
      usersLeft: raceUsers.length,
      successes: statuses.filter((s) => s === 200).length,
      refused: statuses.filter((s) => s === 410 || s === 409).length,
      other: statuses.filter((s) => s !== 200 && s !== 410 && s !== 409),
      loginsCreated: joined.length,
    });
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 200).every((s) => s === 410 || s === 409)).toBe(true);
    expect(joined).toHaveLength(1);
    expect(raceUsers).toHaveLength(1);
    expect(used?.usedAt).not.toBeNull();
  }, 60_000);

  it("G4 negative control: an accept without the single-use guard admits several logins under concurrency", async () => {
    const code = await invite(a, "member", null);
    const users = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.rt.auth.api.signUpEmail({
          body: {
            email: uniqueEmail(`naive${String(i)}`),
            password: "naive horse battery",
            name: `Naive ${String(i)}`,
          },
        }),
      ),
    );
    // Faulty accept: read, check, then write, with no conditional update of used_at.
    const naiveAccept = async (userId: string) => {
      const [row] = await app.rt.db.select().from(inviteTable).where(eq(inviteTable.code, code));
      if (row === undefined || row.usedAt !== null) return false;
      await new Promise((r) => setTimeout(r, 20));
      await app.rt.db
        .insert(householdUser)
        .values({ householdId: row.householdId, userId, role: row.role, createdAt: new Date() });
      await app.rt.db
        .update(inviteTable)
        .set({ usedAt: new Date() })
        .where(eq(inviteTable.id, row.id));
      return true;
    };
    const admitted = (await Promise.all(users.map((u) => naiveAccept(u.user.id)))).filter(
      Boolean,
    ).length;
    measure("G4", "negative-naive-accept", { admitted });
    expect(admitted).toBeGreaterThan(1);
  });
});

describe("G4 TOTP", () => {
  it("G4 the TOTP helper matches the RFC 6238 test vector", () => {
    // RFC 6238 appendix B, SHA-1, T = 59 s: 94287082 (8 digits).
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of "12345678901234567890"
    expect(totpCode(secret, 59_000, 30, 8)).toBe("94287082");
    expect(totpCode(secret, 1_111_111_109_000, 30, 8)).toBe("07081804");
  });

  it("G4 TOTP enforced when required: 403 for an admin without it, 200 after enabling it with an RFC 6238 code, and sign-in then needs the second step", async () => {
    const h = await signupAdmin("Strict");
    const admin2 = await acceptWithSignup(await invite(h, "admin", null), "Second admin");
    const memberLogin = await acceptWithSignup(await invite(h, "member", null), "Member");
    await applyOps(h, [{ kind: "household.update", payload: { requireTotpForAdmins: true } }]);
    const refused = await callJson(c.weightsGet, {}, admin2);
    const memberOk = await callJson(c.membersList, {}, memberLogin);
    const accountOk = await callJson(c.accountGet, {}, admin2);
    const en = ok<{ totpUri: string }>(
      await callJson(c.accountTotpEnable, { body: { password: admin2.password } }, admin2),
      "enable",
    );
    const wrong = await callJson(c.accountTotpVerify, { body: { code: "000000" } }, admin2);
    const verified = ok<{ token: string | null }>(
      await callJson(
        c.accountTotpVerify,
        { body: { code: totpCode(secretOf(en.totpUri)) } },
        admin2,
      ),
      "verify",
    );
    const allowed = await callJson(c.weightsGet, {}, { token: verified.token });
    const step1 = await signIn(admin2.email, admin2.password);
    const pending = await callJson(c.me, {}, { token: step1.token });
    const step2 = await authCall(
      "/two-factor/verify-totp",
      { code: totpCode(secretOf(en.totpUri)) },
      { cookie: cookieHeader(step1.cookies) },
    );
    const step2Token = step2.headers.get("set-auth-token");
    const afterStep2 = await callJson(c.weightsGet, {}, { token: step2Token });
    const disable = await callJson(
      c.accountTotpDisable,
      { body: { password: admin2.password } },
      { token: step2Token },
    );
    measure("G4", "totp", {
      refused: refused.status,
      refusedCode: (refused.json as { code?: string }).code,
      member: memberOk.status,
      account: accountOk.status,
      wrongCode: wrong.status,
      allowed: allowed.status,
      step1: step1.status,
      step1Redirect: (step1.json as { twoFactorRedirect?: boolean }).twoFactorRedirect === true,
      step1Session: pending.status,
      step2: step2.status,
      afterStep2: afterStep2.status,
      disableWhileRequired: disable.status,
    });
    expect(refused.status).toBe(403);
    expect((refused.json as { code: string }).code).toBe("totp_required");
    expect(memberOk.status).toBe(200);
    expect(accountOk.status).toBe(200);
    expect(wrong.status).toBe(422);
    expect(verified.token).toBeTruthy();
    expect(allowed.status).toBe(200);
    expect(step1.status).toBe(200);
    expect((step1.json as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect(pending.status).toBe(401);
    expect(step2.status).toBe(200);
    expect(afterStep2.status).toBe(200);
    expect(disable.status).toBe(409);
  });

  it("G4 negative control: the same check on a household without the requirement lets a TOTP-less admin through", async () => {
    const r = await callJson(c.weightsGet, {}, b);
    const [row] = await app.rt.db
      .select({ required: household.requireTotpForAdmins })
      .from(household)
      .where(eq(household.id, b.householdId));
    measure("G4", "negative-no-requirement", { status: r.status, required: row?.required });
    expect(row?.required).toBe(false);
    expect(r.status).toBe(200);
  });
});
