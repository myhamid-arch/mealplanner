// The worker process (ARC-7; leaf-1.4.1 ADR-2): pg-boss queues for every job kind, each handled by
// the claim/run/events runner, plus the per-minute scheduler tick. SIGTERM/SIGINT stop gracefully.
import { fileURLToPath } from "node:url";
import { JOB_KINDS } from "@mealplanner/db/services/plans";
import { workerEnv } from "./env.js";
import { HANDLERS } from "./jobs/handlers.js";
import { logger } from "./log.js";
import { runJob } from "./runner.js";
import { createWorkerRuntime, type WorkerRuntime } from "./runtime.js";
import { TICK_QUEUE, tick } from "./schedule.js";

/** Retries for jobs safe to repeat; a plan or AI job is re-run only when asked (ADR-2). */
const RETRIES: Partial<Record<(typeof JOB_KINDS)[number], number>> = {
  "nutrition.recompute": 2,
  "plates.resolve": 2,
  "kg.sync": 2,
  "kg.nightly": 2,
};

export async function startWorker(rt: WorkerRuntime): Promise<void> {
  for (const kind of JOB_KINDS) {
    await rt.boss.createQueue(kind, { retryLimit: RETRIES[kind] ?? 0, retryBackoff: true });
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
    if (r.resent > 0 || r.enqueued.length > 0) rt.log.info(r, "scheduler tick");
  });
  await rt.boss.schedule(TICK_QUEUE, "* * * * *");
  rt.log.info(
    { queues: JOB_KINDS.length, model: rt.model === null ? null : rt.modelName },
    "worker started",
  );
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
