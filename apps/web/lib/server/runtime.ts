// The web process's shared services, built once from the environment (ARC-9): the PostgreSQL pool
// and Drizzle, Better Auth, the mailer, the job queue (pg-boss, send only) and the job-event
// listener. `useRuntime` installs a runtime built elsewhere (the tests build one per database;
// everything else calls `runtime()`).
import { randomBytes } from "node:crypto";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createAuth, type Auth } from "../auth/server";
import { JobEventHub } from "./events";
import { PgBossQueue, type JobQueue } from "./jobs";
import { mailerFromEnv, type Mailer } from "./mail";

export interface RuntimeConfig {
  appUrl: string;
  /** ARC-6: chat turns per household per hour (CHAT_TURNS_PER_HOUR). */
  chatTurnsPerHour: number;
  /** ARC-6: AI recipes per household per day (AI_RECIPE_DAILY_LIMIT). */
  aiRecipeDailyLimit: number;
}

export interface Runtime {
  pool: pg.Pool;
  db: NodePgDatabase;
  auth: Auth;
  mailer: Mailer;
  queue: JobQueue;
  events: JobEventHub;
  config: RuntimeConfig;
  close(): Promise<void>;
}

function intEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(n) && n > 0 ? n : fallback;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    appUrl: env.APP_URL ?? "http://localhost:3000",
    chatTurnsPerHour: intEnv(env.CHAT_TURNS_PER_HOUR, 30),
    aiRecipeDailyLimit: intEnv(env.AI_RECIPE_DAILY_LIMIT, 60),
  };
}

export function createRuntime(args: {
  databaseUrl: string;
  secret: string;
  mailer: Mailer;
  config: RuntimeConfig;
  queue?: JobQueue;
}): Runtime {
  const pool = new pg.Pool({ connectionString: args.databaseUrl, max: 10 });
  const db = drizzle(pool);
  const queue = args.queue ?? new PgBossQueue(args.databaseUrl);
  const events = new JobEventHub(args.databaseUrl);
  return {
    pool,
    db,
    auth: createAuth({ db, mailer: args.mailer, appUrl: args.config.appUrl, secret: args.secret }),
    mailer: args.mailer,
    queue,
    events,
    config: args.config,
    async close() {
      await events.close();
      await queue.close();
      await pool.end();
    },
  };
}

const KEY = Symbol.for("mealplanner.web.runtime");
type Holder = { [KEY]?: Runtime };

/** The runtime; built from the environment on first use (DATABASE_URL and AUTH_SECRET required). */
export function runtime(): Runtime {
  const holder = globalThis as Holder;
  const existing = holder[KEY];
  if (existing !== undefined) return existing;
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");
  const secret = process.env.AUTH_SECRET;
  if (secret === undefined || secret.length < 32)
    throw new Error("AUTH_SECRET must be set (at least 32 characters)");
  const built = createRuntime({
    databaseUrl,
    secret,
    mailer: mailerFromEnv(),
    config: configFromEnv(),
  });
  holder[KEY] = built;
  return built;
}

/**
 * The runtime, or null when this process has no database configured (DATABASE_URL unset), e.g.
 * the UI's own end-to-end tests. Only the shell's viewer lookup uses this: without a database
 * there is no session, and the shell renders signed out. API routes use `runtime()`, which fails.
 */
export function configuredRuntime(): Runtime | null {
  const holder = globalThis as Holder;
  if (holder[KEY] !== undefined) return holder[KEY];
  const url = process.env.DATABASE_URL;
  return url === undefined || url === "" ? null : runtime();
}

/** Installs a runtime (tests: one per database). Returns the previous one, if any. */
export function useRuntime(next: Runtime | undefined): Runtime | undefined {
  const holder = globalThis as Holder;
  const previous = holder[KEY];
  holder[KEY] = next;
  return previous;
}

/** A random AUTH_SECRET-grade secret (for tests and first-run tooling). */
export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}
