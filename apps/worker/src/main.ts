// The worker process (ARC-7; leaf-1.4.1 ADR-2): pg-boss queues for every job kind, each handled by
// the claim/run/events runner, plus the per-minute scheduler tick. SIGTERM/SIGINT stop gracefully.
import { fileURLToPath } from "node:url";
import { isNull } from "drizzle-orm";
import { dish } from "@mealplanner/db/schema";
import { JOB_KINDS, QUEUE_OPTIONS } from "@mealplanner/db/services/plans";
import { workerEnv } from "./env.js";
import { HANDLERS } from "./jobs/handlers.js";
import { logger } from "./log.js";
import { runJob } from "./runner.js";
import { createWorkerRuntime, type WorkerRuntime } from "./runtime.js";
import { TICK_QUEUE, tick } from "./schedule.js";

export async function startWorker(rt: WorkerRuntime): Promise<void> {
  for (const kind of JOB_KINDS) {
    await rt.boss.createQueue(kind, QUEUE_OPTIONS);
    const handler = HANDLERS[kind];
    if (handler === undefined) throw new Error(`no handler for ${kind}`);
    await rt.boss.work<{ jobId: string }>(
      kind,
      { localConcurrency: rt.env.concurrency },
      async (jobs) => {
        for (const j of jobs) await runJob(rt, j.data.jobId, handler);
      },
    );
  }
  await rt.boss.createQueue(TICK_QUEUE, { retryLimit: 0 });
  await rt.boss.work(TICK_QUEUE, async () => {
    const r = await tick(rt);
    if (r.errors.length > 0)
      rt.log.error({ errors: r.errors }, "scheduler tick: households skipped");
    if (r.resent > 0 || r.enqueued.length > 0 || r.reaped.length > 0)
      rt.log.info(r, "scheduler tick");
  });
  await rt.boss.schedule(TICK_QUEUE, "* * * * *");
  await syncCatalogueGraph(rt);
  rt.log.info(
    { queues: JOB_KINDS.length, model: rt.model === null ? null : rt.modelName },
    "worker started",
  );
}

/**
 * KG-3: the global catalogue and the seed library in the graph. The catalogue loader runs before
 * the worker starts (deploy step) and may have changed them; the sync is idempotent (1.3.4 G1), so
 * it is queued on every start.
 */
export async function syncCatalogueGraph(rt: WorkerRuntime): Promise<string[]> {
  const seed = await rt.db.select({ id: dish.id }).from(dish).where(isNull(dish.householdId));
  const ids = [await rt.enqueue("kg.sync", null, { request: { kind: "catalogue" } })];
  if (seed.length > 0)
    ids.push(
      await rt.enqueue("kg.sync", null, {
        request: { kind: "dish", householdId: null, dishIds: seed.map((d) => d.id).sort() },
      }),
    );
  return ids;
}

async function main(): Promise<void> {
  const rt = await createWorkerRuntime(workerEnv());
  await startWorker(rt);
  const stop = (signal: string) => {
    logger.info({ signal }, "stopping");
    rt.close().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, "stop failed");
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", () => {
    stop("SIGTERM");
  });
  process.once("SIGINT", () => {
    stop("SIGINT");
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, "worker failed to start");
    process.exit(1);
  });
}
