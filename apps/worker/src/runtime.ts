// The worker's shared services: PostgreSQL pool and Drizzle, pg-boss, the knowledge graph store
// and source, the Claude model (null without a credential, REC-2) and the catalogue factors.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  createClaudeClient,
  resolveClaudeConfig,
  type StructuredModel,
} from "@mealplanner/ai/client";
import type { AtwaterFactors } from "@mealplanner/core/nutrition";
import type { Json } from "@mealplanner/core/types";
import { PostgresGraphStore } from "@mealplanner/graph/store";
import { PostgresKgSource } from "@mealplanner/graph/sync";
import { atwaterFactorsBySlug, readCatalogueFiles } from "@mealplanner/db/seed";
import { createJob, sendOptions, type JobKind } from "@mealplanner/db/services/plans";
import { join } from "node:path";
import type { WorkerEnv } from "./env.js";
import { logger, type Logger } from "./log.js";

export interface WorkerRuntime {
  env: WorkerEnv;
  pool: pg.Pool;
  db: NodePgDatabase;
  boss: PgBoss;
  graph: PostgresGraphStore;
  kgSource: PostgresKgSource;
  model: StructuredModel | null;
  modelName: string;
  modelDisabledReason: string | null;
  factorsBySlug: ReadonlyMap<string, AtwaterFactors>;
  log: Logger;
  /** Creates a job row and queues it (the worker's own follow-ups and schedules). */
  enqueue(
    kind: JobKind,
    householdId: string | null,
    payload: Json,
    createdByUserId?: string | null,
  ): Promise<string>;
  close(): Promise<void>;
}

export async function createWorkerRuntime(
  env: WorkerEnv,
  options: { model?: StructuredModel | null } = {},
): Promise<WorkerRuntime> {
  const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 8 });
  const db = drizzle(pool);
  const boss = new PgBoss({ connectionString: env.databaseUrl, max: 4 });
  boss.on("error", (err: unknown) => {
    logger.error({ err }, "pg-boss error");
  });
  await boss.start();
  const kgSource = new PostgresKgSource(pool, {
    substitutes: join(env.dataDir, "substitutes.csv"),
  });
  const graph = new PostgresGraphStore(pool, { exclusions: (hh) => kgSource.exclusions(hh) });
  const config = resolveClaudeConfig();
  const model = options.model !== undefined ? options.model : createClaudeClient(config);
  const factorsBySlug = atwaterFactorsBySlug(readCatalogueFiles(env.dataDir).ingredients);
  const rt: WorkerRuntime = {
    env,
    pool,
    db,
    boss,
    graph,
    kgSource,
    model,
    modelName: config.model,
    modelDisabledReason: model === null ? (config.enabled ? "no model" : config.reason) : null,
    factorsBySlug,
    log: logger,
    async enqueue(kind, householdId, payload, createdByUserId = null) {
      const row = await createJob(db, { kind, householdId, payload, createdByUserId });
      await boss.send(kind, { jobId: row.id }, sendOptions(row.id));
      return row.id;
    },
    async close() {
      await boss.stop({ graceful: true, close: true, timeout: 20_000 });
      await pool.end();
    },
  };
  return rt;
}
