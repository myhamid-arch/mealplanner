// G4 (R2-ADM-1, SPEC-Q-6, BLD-8 R-42): magic-link sign-in through the captured mail. The first
// one for an account whose email was not verified removes its password and sessions (the library's
// pre-registration takeover defence) and says so on the redirect and a header; a user with
// two-step sign-in on is sent no link.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { PASSWORD_REMOVED } from "@mealplanner/api-contract/contract";
import { session } from "@mealplanner/db/schema";
import { eq } from "drizzle-orm";
import { authCall, callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { measure } from "./support/measure";
import { secretOf, totpCode } from "./support/totp";
import { acceptWithSignup, invite, ok, signupAdmin, type Login } from "./support/world";

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };

beforeAll(async () => {
  db = await createTestDatabase({ seed: false });
  app = startTestApp(db.url);
  a = await signupAdmin("Household A");
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

describe("G4 magic link", () => {
  interface LinkResult {
    mailed: boolean;
    status: number;
    token: string | null;
    location: string | null;
    flagHeader: string | null;
  }

  async function magicLink(email: string): Promise<LinkResult> {
    const before = app.mail.length;
    const sent = await authCall("/sign-in/magic-link", { email, callbackURL: "/" });
    expect(sent.status).toBe(200);
    const mail = app.mail.slice(before).find((m) => m.to === email);
    const url = /https?:\/\/\S+/.exec(mail?.text ?? "")?.[0];
    if (url === undefined)
      return { mailed: false, status: 0, token: null, location: null, flagHeader: null };
    const mod = (await import("../../app/api/auth/[...all]/route")) as {
      GET: (r: Request) => Promise<Response>;
    };
    const res = await mod.GET(new Request(url, { method: "GET", redirect: "manual" }));
    return {
      mailed: true,
      status: res.status,
      token: res.headers.get("set-auth-token"),
      location: res.headers.get("location"),
      flagHeader: res.headers.get(PASSWORD_REMOVED.header),
    };
  }

  async function passwordSignIn(email: string, password: string): Promise<number> {
    return (await authCall("/sign-in/email", { email, password })).status;
  }

  it("G4 a magic link signs a login in; the first one for an unverified account removes its password and sessions and says so (R-42)", async () => {
    const l = await acceptWithSignup(await invite(a, "member", null), "Linky");
    const before = await passwordSignIn(l.email, l.password);
    const first = await magicLink(l.email);
    const me = await callJson(c.me, {}, { token: first.token });
    const oldToken = await callJson(c.me, {}, { token: l.token });
    const afterPassword = await passwordSignIn(l.email, l.password);
    const second = await magicLink(l.email);
    const flagged = (r: LinkResult) =>
      r.flagHeader === "1" &&
      r.location !== null &&
      new URL(r.location, "http://x").searchParams.get(PASSWORD_REMOVED.query) === "1";
    measure("G4", "magic-link", {
      passwordBefore: before,
      firstFlagged: flagged(first),
      me: me.status,
      oldToken: oldToken.status,
      passwordAfter: afterPassword,
      secondFlagged: flagged(second),
      secondMe: (await callJson(c.me, {}, { token: second.token })).status,
    });
    expect(before).toBe(200);
    expect(first.token).toBeTruthy();
    expect(me.status).toBe(200);
    expect(flagged(first)).toBe(true);
    expect(oldToken.status).toBe(401);
    expect(afterPassword).not.toBe(200);
    expect(second.token).toBeTruthy();
    expect(flagged(second)).toBe(false);
  });

  it("G4 no magic link is sent to a user with two-step sign-in on, and their password and sessions stay (SPEC-Q-6)", async () => {
    const strict = await acceptWithSignup(await invite(a, "member", null), "Strict linky");
    const en = ok<{ totpUri: string }>(
      await callJson(c.accountTotpEnable, { body: { password: strict.password } }, strict),
      "enable",
    );
    const verified = ok<{ token: string | null }>(
      await callJson(
        c.accountTotpVerify,
        { body: { code: totpCode(secretOf(en.totpUri)) } },
        strict,
      ),
      "verify",
    );
    const sessionsBefore = await sessionsOf(strict.userId);
    const link = await magicLink(strict.email);
    const sessionsAfter = await sessionsOf(strict.userId);
    const stillIn = await callJson(c.me, {}, { token: verified.token });
    const password = await authCall("/sign-in/email", {
      email: strict.email,
      password: strict.password,
    });
    const step1 = (await password.json()) as { twoFactorRedirect?: boolean };
    measure("G4", "magic-link-totp", {
      mailed: link.mailed,
      sessionsKept: sessionsAfter === sessionsBefore,
      stillIn: stillIn.status,
      passwordStep1: step1.twoFactorRedirect === true,
    });
    expect(link.mailed).toBe(false);
    expect(sessionsAfter).toBe(sessionsBefore);
    expect(stillIn.status).toBe(200);
    expect(step1.twoFactorRedirect).toBe(true);
  });
});
