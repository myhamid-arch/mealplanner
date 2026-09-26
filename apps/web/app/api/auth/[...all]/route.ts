// Better Auth's own endpoints under /api/auth (ARC-6, R2-ADM-1/5; leaf-1.4.1 ADR-1): sign-in with
// password, magic link, the two-factor step, sign-out, password reset. Sign-up here is refused:
// accounts are created only by POST /api/v1/signup and invite acceptance (SPEC-Q-3); password
// change and two-step sign-in set-up go through /api/v1/account, which enforce the household rules.
import { eq } from "drizzle-orm";
import { PASSWORD_REMOVED } from "@mealplanner/api-contract/contract";
import { user } from "@mealplanner/db/schema";
import { authRequestFlags } from "../../../../lib/auth/request-flags";
import { runtime as rt } from "../../../../lib/server/runtime";
import { ProblemError, problemResponse } from "../../../../lib/server/problem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Library endpoints replaced by /api/v1 ones that add the household rules around them. */
const REPLACED: ReadonlyArray<[string, string]> = [
  ["/api/auth/sign-up", "sign up with POST /api/v1/signup or an invite"],
  // Password change must sign out other sessions; TOTP cannot be turned off while required.
  ["/api/auth/change-password", "change the password with POST /api/v1/account/password"],
  [
    "/api/auth/two-factor/disable",
    "turn two-step sign-in off with POST /api/v1/account/totp/disable",
  ],
  ["/api/auth/two-factor/enable", "turn two-step sign-in on with POST /api/v1/account/totp/enable"],
];

function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const replaced = REPLACED.find(([prefix]) => path.startsWith(prefix));
  if (replaced !== undefined)
    return Promise.resolve(problemResponse(new ProblemError(404, "not_found", replaced[1]), path));
  if (path.startsWith("/api/auth/sign-in/magic-link")) return magicLinkRequest(request);
  if (path.startsWith("/api/auth/magic-link/verify")) return magicLinkVerify(request);
  return rt().auth.handler(request);
}

/**
 * SPEC-Q-6: no link is sent to a user with two-step sign-in on (the link would bypass the TOTP
 * step, and the library would remove the password on use). The reply is the same success either
 * way, so the endpoint does not reveal which accounts use two-step sign-in.
 */
async function magicLinkRequest(request: Request): Promise<Response> {
  let email: unknown;
  try {
    email = ((await request.clone().json()) as { email?: unknown }).email;
  } catch {
    return rt().auth.handler(request);
  }
  if (typeof email === "string") {
    const [u] = await rt()
      .db.select({ twoFactor: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()));
    if (u?.twoFactor === true)
      return new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
  }
  return rt().auth.handler(request);
}

/** R-42: runs the verification and reports a removed password on the redirect and a header. */
async function magicLinkVerify(request: Request): Promise<Response> {
  const flags = { passwordRemoved: false };
  const response = await authRequestFlags.run(flags, () => rt().auth.handler(request));
  if (!flags.passwordRemoved) return response;
  const headers = new Headers(response.headers);
  headers.set(PASSWORD_REMOVED.header, "1");
  const location = headers.get("location");
  if (location !== null) {
    const url = new URL(location, new URL(request.url).origin);
    url.searchParams.set(PASSWORD_REMOVED.query, "1");
    headers.set("location", url.toString());
  }
  return new Response(response.body, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
