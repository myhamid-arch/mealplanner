// Shared by the root-gate tests (R-79, R-80): the fresh compose stack that scripts/verify/root.mjs
// started for this gate (its web app, its database on a host port), the recorded model served to
// its containers through the relay, and JSON calls against the running app as a signed-up login.
import { writeFileSync } from "node:fs";
import pg from "pg";
import { startRecordedModel, type RecordedModel, type Recording } from "../node/recorded-model";
import { api, requiredEnv, type Api, type BuiltApp, type Login } from "../node/support";

export { waitForJob } from "../node/support";

/** The stack's web app (http://localhost:<port>). */
export const appUrl = (): string => requiredEnv("ROOT_APP_URL");
/** The stack's database, published on a free host port (read for the measures and controls). */
export const dbUrl = (): string => requiredEnv("ROOT_DB_URL");

/**
 * Starts the node gates' recorded-model server and names it to the relay, so the containers'
 * model calls reach it. Everything else about it is the node server's (answers, failures).
 */
export async function recordedModel(recordings: Recording[]): Promise<RecordedModel> {
  const model = await startRecordedModel(recordings);
  const port = Number(new URL(model.url).port);
  writeFileSync(requiredEnv("ROOT_MODEL_TARGET_FILE"), JSON.stringify({ port }));
  return model;
}

/** JSON calls as `login` against the stack (node support's `api`, which needs only the URL). */
export function apiAs(login: Pick<Login, "token" | "householdId">): Api {
  return api({ url: appUrl() } as BuiltApp, login);
}

export interface SignedUp extends Login {
  email: string;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${appUrl()}/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appUrl() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    // a non-JSON body stays text
  }
  return { status: res.status, json };
}

/** `POST /api/v1/signup`: a new user and household, the user its admin (ARC-6). */
export async function signup(
  email: string,
  name: string,
  householdName: string,
): Promise<SignedUp> {
  const r = await post("/signup", {
    email,
    password: "correct horse battery",
    name,
    householdName,
  });
  if (r.status !== 201)
    throw new Error(`signup ${email}: ${String(r.status)} ${JSON.stringify(r.json)}`);
  const s = r.json as { user: { id: string }; householdId: string; token: string };
  return { email, token: s.token, householdId: s.householdId, userId: s.user.id };
}

/** `POST /api/v1/invites/accept` with a signup: a new login joins through an invite code. */
export async function acceptInvite(code: string, email: string, name: string): Promise<SignedUp> {
  const r = await post("/invites/accept", {
    code,
    signup: { email, password: "correct horse battery", name },
  });
  if (r.status !== 200)
    throw new Error(`invite accept ${email}: ${String(r.status)} ${JSON.stringify(r.json)}`);
  const a = r.json as { householdId: string; userId: string; token: string | null };
  if (a.token === null) throw new Error(`invite accept ${email}: no session token`);
  return { email, token: a.token, householdId: a.householdId, userId: a.userId };
}

export function pool(max = 4): pg.Pool {
  return new pg.Pool({ connectionString: dbUrl(), max });
}

/** The job's outcome as the worker persisted it: the `done` event's payload is its result. */
export async function jobResult(
  db: pg.Pool,
  jobId: string,
  ms = 1_800_000,
): Promise<{ flags: unknown[] }> {
  const deadline = Date.now() + ms;
  for (;;) {
    const { rows } = await db.query<{ status: string; error: unknown }>(
      "SELECT status::text, error FROM job WHERE id = $1",
      [jobId],
    );
    const status = rows[0]?.status;
    if (status === "succeeded") {
      const { rows: done } = await db.query<{ payload: { flags?: unknown } }>(
        "SELECT payload FROM job_event WHERE job_id = $1 AND type = 'done' ORDER BY seq DESC LIMIT 1",
        [jobId],
      );
      const flags = done[0]?.payload.flags;
      if (!Array.isArray(flags)) throw new Error(`job ${jobId}: its result carries no flags list`);
      return { flags };
    }
    if (status === "failed" || status === "cancelled")
      throw new Error(`job ${jobId} ${status}: ${JSON.stringify(rows[0]?.error)}`);
    if (Date.now() > deadline) throw new Error(`job ${jobId} still ${String(status)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
