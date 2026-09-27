// Server-side page guard for the signed-in screens of this leaf (leaf-1.4.6 ADR-1): without a
// usable session the page redirects to sign-in and comes back afterwards. Authorisation (role,
// household, operator) stays the API's; the screens show its answer.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, type SessionInfo } from "../../lib/auth/context";
import { configuredRuntime } from "../../lib/server/runtime";

export async function currentSession(): Promise<SessionInfo | null> {
  const rt = configuredRuntime();
  if (rt === null) return null;
  const h = await headers();
  return readSession(rt, new Request("http://guard.invalid/", { headers: h }));
}

/** The session, or a redirect to `/sign-in?next=<path>`. */
export async function requirePageSession(path: string): Promise<SessionInfo> {
  const session = await currentSession();
  if (session === null) redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  return session;
}
