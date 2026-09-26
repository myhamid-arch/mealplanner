// Worker configuration from the environment (ARC-9).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkerEnv {
  databaseUrl: string;
  /** The catalogue data directory (R-22 energy factors, substitutes CSV). */
  dataDir: string;
  /** ARC-6: AI recipes per household per day. */
  aiRecipeDailyLimit: number;
  /** Jobs run in parallel per queue. */
  concurrency: number;
}

/** The repository's `data/` from dist/src or src. */
const DEFAULT_DATA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  ...(import.meta.url.includes("/dist/") ? ["..", "..", "..", ".."] : ["..", "..", ".."]),
  "data",
);

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(n) && n > 0 ? n : fallback;
}

export function workerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");
  return {
    databaseUrl,
    dataDir: env.DATA_DIR ?? DEFAULT_DATA_DIR,
    aiRecipeDailyLimit: positiveInt(env.AI_RECIPE_DAILY_LIMIT, 60),
    concurrency: positiveInt(env.WORKER_CONCURRENCY, 2),
  };
}
