// Better Auth's own endpoints under /api/auth (ARC-6, R2-ADM-1/5; leaf-1.4.1 ADR-1): sign-in with
// password, magic link, the two-factor step, sign-out, password reset. Sign-up here is refused:
// accounts are created only by POST /api/v1/signup and invite acceptance (SPEC-Q-3); password
// change and two-step sign-in set-up go through /api/v1/account, which enforce the household rules.
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
  return rt().auth.handler(request);
}

export const GET = handle;
export const POST = handle;
