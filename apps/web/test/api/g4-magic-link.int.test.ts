// G4 (R2-ADM-1, SPEC-Q-6): magic-link sign-in through the captured mail, and its refusal for a
// user with two-step sign-in on. Held out of the G4 gate until the architect rules on
// `verification.id` (Better Auth 1.7.6 stores a non-UUID primary key there; PR #13 question).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
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
  async function magicLink(
    email: string,
  ): Promise<{ status: number; token: string | null; location: string | null }> {
    const before = app.mail.length;
    const sent = await authCall("/sign-in/magic-link", { email, callbackURL: "/" });
    expect(sent.status).toBe(200);
    const mail = app.mail.slice(before).find((m) => m.to === email);
    const url = /https?:\/\/\S+/.exec(mail?.text ?? "")?.[0];
    if (url === undefined) throw new Error("no magic link mailed");
    const mod = (await import("../../app/api/auth/[...all]/route")) as {
      GET: (r: Request) => Promise<Response>;
    };
    const res = await mod.GET(new Request(url, { method: "GET", redirect: "manual" }));
    return {
      status: res.status,
      token: res.headers.get("set-auth-token"),
      location: res.headers.get("location"),
    };
  }

  it("G4 a magic link signs a login in, but not a user with two-step sign-in on (SPEC-Q-6)", async () => {
    const plain = await acceptWithSignup(await invite(a, "member", null), "Linky");
    const ok1 = await magicLink(plain.email);
    const me = await callJson(c.me, {}, { token: ok1.token });
    const strict = await acceptWithSignup(await invite(a, "member", null), "Strict linky");
    const en = ok<{ totpUri: string }>(
      await callJson(c.accountTotpEnable, { body: { password: strict.password } }, strict),
      "enable",
    );
    ok(
      await callJson(
        c.accountTotpVerify,
        { body: { code: totpCode(secretOf(en.totpUri)) } },
        strict,
      ),
      "verify",
    );
    const sessionsBefore = await sessionsOf(strict.userId);
    const refused = await magicLink(strict.email);
    const sessionsAfter = await sessionsOf(strict.userId);
    measure("G4", "magic-link", {
      plainMe: me.status,
      refusedToken: refused.token !== null,
      newSessions: sessionsAfter - sessionsBefore,
    });
    expect(ok1.token).toBeTruthy();
    expect(me.status).toBe(200);
    expect(refused.token).toBeNull();
    expect(sessionsAfter).toBe(sessionsBefore);
  });
});
