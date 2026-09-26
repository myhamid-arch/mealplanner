// Better Auth 1.7.6 (ARC-6, R2-ADM-1/4/5; leaf-1.4.1 ADR-1): email + password, magic link, TOTP
// two-step sign-in and bearer tokens, over the 1.1.2 auth tables through the Drizzle adapter.
// Cookie cache is off, so every request reads the session row: deleting sessions takes effect on
// the next request (R2-ADM-4). A session is refused for a platform-blocked user and for a user
// with no active membership (platform operators excepted).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { bearer, magicLink, twoFactor } from "better-auth/plugins";
import { and, eq, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  account,
  householdUser,
  newId,
  platformOperator,
  session,
  twoFactor as twoFactorTable,
  user,
  verification,
} from "@mealplanner/db/schema";
import { emailNotConfigured, type Mailer } from "../server/mail";

export interface AuthOptions {
  db: NodePgDatabase;
  mailer: Mailer;
  /** APP_URL: the origin links point to and cookies are issued for. */
  appUrl: string;
  /** AUTH_SECRET (≥ 32 characters). */
  secret: string;
  /** TOTP issuer shown in authenticator apps (the product's working name, R2-UX-6). */
  appName?: string;
}

/** True when the user may hold a session: not platform-blocked, and an active login or operator. */
export async function maySignIn(
  db: NodePgDatabase,
  userId: string,
  via: string | null = null,
): Promise<{ ok: boolean; reason: string }> {
  const [u] = await db
    .select({ blocked: user.platformBlockedAt, twoFactor: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, userId));
  if (u === undefined) return { ok: false, reason: "unknown user" };
  if (u.blocked !== null) return { ok: false, reason: "this account is blocked" };
  // SPEC-Q-6: with two-step sign-in on, no session without the TOTP step. The two-factor plugin
  // guards password sign-in only, so an emailed link cannot sign such a user in.
  if (u.twoFactor && via !== null && via.startsWith("/magic-link"))
    return {
      ok: false,
      reason: "two-step sign-in is on: sign in with your password and authenticator code",
    };
  const [operator] = await db
    .select({ userId: platformOperator.userId })
    .from(platformOperator)
    .where(eq(platformOperator.userId, userId));
  if (operator !== undefined) return { ok: true, reason: "" };
  const [login] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(and(eq(householdUser.userId, userId), ne(householdUser.status, "blocked")))
    .limit(1);
  return login === undefined
    ? { ok: false, reason: "this login is blocked or has no household" }
    : { ok: true, reason: "" };
}

export function createAuth(options: AuthOptions) {
  const { db, mailer } = options;
  const appName = options.appName ?? "Mise";
  return betterAuth({
    appName,
    baseURL: options.appUrl,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: [options.appUrl],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification, twoFactor: twoFactorTable },
    }),
    advanced: {
      database: { generateId: () => newId() },
      useSecureCookies: options.appUrl.startsWith("https://"),
    },
    session: { cookieCache: { enabled: false } },
    emailAndPassword: {
      enabled: true,
      // Sign-up happens through /api/v1/signup and invite acceptance, which create the membership
      // first and then sign in (leaf-1.4.1 SPEC-Q-3).
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }) => {
        if (!mailer.configured) throw emailNotConfigured();
        await mailer.send({
          to: u.email,
          subject: `Reset your ${appName} password`,
          text: `Open this link to choose a new password: ${url}\n\nIf you did not ask for this, ignore this email.`,
        });
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (s, context) => {
            const verdict = await maySignIn(db, s.userId, context?.path ?? null);
            if (!verdict.ok) throw new APIError("FORBIDDEN", { message: verdict.reason });
          },
        },
      },
    },
    plugins: [
      twoFactor({ issuer: appName }),
      magicLink({
        expiresIn: 15 * 60,
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          if (!mailer.configured)
            throw new APIError("SERVICE_UNAVAILABLE", { message: "email is not configured" });
          await mailer.send({
            to: email,
            subject: `Your ${appName} sign-in link`,
            text: `Open this link to sign in (valid for 15 minutes): ${url}`,
          });
        },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
