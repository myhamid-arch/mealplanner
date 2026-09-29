// Shared by the web node-gate tests (R-69): the built web app (`next start` from the gate's own
// build directory) and the real worker as child processes, an F1 admin who signs in over HTTP
// (SPEC-Q-3), and JSON calls against the running app.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { account, household, householdUser, newId, user } from "@mealplanner/db/schema";
import { createAuth } from "../../lib/auth/server";
import type { Mailer } from "../../lib/server/mail";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const WEB_DIR = join(ROOT, "apps/web");
export const WORKER_MAIN = join(ROOT, "apps/worker/dist/src/main.js");
const NEXT_BIN = join(WEB_DIR, "node_modules/next/dist/bin/next");

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is not set: run this test through its node verify script`);
  return value;
}

/** Environment for a child: no model credential unless a test passes a recorded endpoint. */
const DROPPED = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "VITEST",
  "VITEST_WORKER_ID",
  "VITEST_POOL_ID",
  "TEST",
  "NODE_ENV",
]);

/** The caller's environment without the test runner's and model variables, as production runs. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !DROPPED.has(key)) env[key] = value;
  // Only the heap size of the caller's NODE_OPTIONS is kept (no preloads).
  const heap = (process.env.NODE_OPTIONS ?? "")
    .split(/\s+/)
    .filter((o) => /^--max-old-space-size=\d+$/.test(o))
    .join(" ");
  return { ...env, NODE_ENV: "production", NODE_OPTIONS: heap, LOG_LEVEL: "warn", ...extra };
}

export interface Child {
  child: ChildProcess;
  output(): string;
  alive(): boolean;
  stop(): Promise<void>;
}

function watch(child: ChildProcess): Child {
  let out = "";
  child.stdout?.on("data", (c: Buffer) => (out = (out + c.toString()).slice(-40_000)));
  child.stderr?.on("data", (c: Buffer) => (out = (out + c.toString()).slice(-40_000)));
  return {
    child,
    output: () => out,
    alive: () => child.exitCode === null && child.signalCode === null,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      }),
  };
}

async function waitFor(
  what: string,
  c: Child,
  ready: () => Promise<boolean> | boolean,
  ms = 120_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ready()) return;
    if (!c.alive()) throw new Error(`${what} exited:\n${c.output()}`);
    if (Date.now() > deadline) throw new Error(`${what} did not become ready:\n${c.output()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The real worker (`apps/worker/dist/src/main.js`) on `databaseUrl`. */
export async function startWorker(
  databaseUrl: string,
  extra: Record<string, string> = {},
): Promise<Child> {
  if (!existsSync(WORKER_MAIN)) throw new Error(`${WORKER_MAIN} is not built`);
  const c = watch(
    spawn(process.execPath, [WORKER_MAIN], {
      env: childEnv({
        DATABASE_URL: databaseUrl,
        DATA_DIR: join(ROOT, "data"),
        LOG_LEVEL: "info",
        ...extra,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  await waitFor("the worker", c, () => c.output().includes("worker started"));
  return c;
}

export interface BuiltApp extends Child {
  url: string;
  secret: string;
}

/** `next start` from the gate's build directory (NODE_DIST_DIR) on NODE_PORT. */
export async function startBuiltApp(
  databaseUrl: string,
  extra: Record<string, string> = {},
): Promise<BuiltApp> {
  const port = requiredEnv("NODE_PORT");
  const url = `http://localhost:${port}`;
  const secret = randomBytes(32).toString("base64url");
  const c = watch(
    spawn(process.execPath, [NEXT_BIN, "start", "--port", port], {
      cwd: WEB_DIR,
      env: childEnv({
        MISE_NEXT_DIST_DIR: requiredEnv("NODE_DIST_DIR"),
        DATABASE_URL: databaseUrl,
        AUTH_SECRET: secret,
        APP_URL: url,
        NEXT_TELEMETRY_DISABLED: "1",
        ...extra,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  await waitFor("next start", c, async () => {
    try {
      return (await fetch(`${url}/offline`)).ok;
    } catch {
      return false;
    }
  });
  return { ...c, url, secret };
}

const noMail: Mailer = { configured: false, send: () => Promise.resolve() };

type Auth = ReturnType<typeof createAuth>;

/**
 * Gives a login of the seeded household a password through Better Auth's own hashing (SPEC-Q-3:
 * `loadFixture` creates users without a credential).
 */
export async function giveCredential(
  db: NodePgDatabase,
  auth: Auth,
  email: string,
): Promise<{ password: string; householdId: string; userId: string }> {
  const password = `node-${randomBytes(9).toString("base64url")}`;
  const ctx = await auth.$context;
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (u === undefined) throw new Error(`no user ${email}`);
  const [hh] = await db
    .select({ id: household.id })
    .from(householdUser)
    .innerJoin(household, eq(household.id, householdUser.householdId))
    .where(eq(householdUser.userId, u.id));
  if (hh === undefined) throw new Error(`${email} has no household`);
  const hash = await ctx.password.hash(password);
  await db
    .delete(account)
    .where(and(eq(account.userId, u.id), eq(account.providerId, "credential")));
  const now = new Date();
  await db.insert(account).values({
    id: newId(),
    userId: u.id,
    accountId: u.id,
    providerId: "credential",
    password: hash,
    createdAt: now,
    updatedAt: now,
  });
  return { password, householdId: hh.id, userId: u.id };
}

export interface Login {
  token: string;
  householdId: string;
  userId: string;
}

/** Signs a seeded login in to the built app over HTTP (`POST /api/auth/sign-in/email`). */
export async function signIn(app: BuiltApp, databaseUrl: string, email: string): Promise<Login> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool);
    const auth = createAuth({ db, mailer: noMail, appUrl: app.url, secret: app.secret });
    const { password, householdId, userId } = await giveCredential(db, auth, email);
    const res = await fetch(`${app.url}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: app.url },
      body: JSON.stringify({ email, password }),
    });
    const token = res.headers.get("set-auth-token");
    if (!res.ok || token === null)
      throw new Error(`sign-in failed (${String(res.status)}): ${await res.text()}`);
    return { token, householdId, userId };
  } finally {
    await pool.end();
  }
}

/** Signs a seeded login in through an in-process runtime's Better Auth API. */
export async function signInInProcess(
  rt: { db: NodePgDatabase; auth: Auth },
  email: string,
): Promise<Login> {
  const { password, householdId, userId } = await giveCredential(rt.db, rt.auth, email);
  const signed = await rt.auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const token = signed.headers.get("set-auth-token") ?? signed.response.token;
  return { token, householdId, userId };
}

export interface Api {
  (method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }>;
}

/** JSON calls to the running app as the signed-in login. */
export function api(app: BuiltApp, login: { token: string; householdId: string }): Api {
  return async (method, path, body) => {
    const res = await fetch(`${app.url}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${login.token}`,
        "x-household-id": login.householdId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      // a non-JSON body stays text
    }
    return { status: res.status, json };
  };
}

/** Polls `GET /jobs/{id}` until the job succeeded or failed. */
export async function waitForJob(call: Api, jobId: string, ms = 600_000): Promise<unknown> {
  const deadline = Date.now() + ms;
  for (;;) {
    const r = await call("GET", `/jobs/${jobId}`);
    if (r.status !== 200)
      throw new Error(`GET /jobs/${jobId}: ${String(r.status)} ${JSON.stringify(r.json)}`);
    const status = (r.json as { status?: string }).status;
    if (status === "succeeded") return r.json;
    if (status === "failed") throw new Error(`job ${jobId} failed: ${JSON.stringify(r.json)}`);
    if (Date.now() > deadline) throw new Error(`job ${jobId} still ${String(status)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
