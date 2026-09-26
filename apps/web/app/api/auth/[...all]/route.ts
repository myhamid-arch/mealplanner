// Better Auth's own endpoints under /api/auth (ARC-6, R2-ADM-1/5; leaf-1.4.1 ADR-1): sign-in with
// password, magic link, the two-factor step, sign-out, password reset. Sign-up here is refused:
// accounts are created only by POST /api/v1/signup and invite acceptance (SPEC-Q-3).
import { runtime as rt } from "../../../../lib/server/runtime";
import { ProblemError, problemResponse } from "../../../../lib/server/problem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/auth/sign-up"))
    return Promise.resolve(
      problemResponse(
        new ProblemError(404, "not_found", "sign up with POST /api/v1/signup or an invite"),
        path,
      ),
    );
  return rt().auth.handler(request);
}

export const GET = handle;
export const POST = handle;
