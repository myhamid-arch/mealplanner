// Runs one job (ARC-7; R-40): atomic claim of the `job` row (a withdrawn or already-claimed job is
// skipped), a `started` event, the handler, then `done` with the handler's result or `failed`
// with the error, and the row's final status. Events are appended in order (one chain per job).
// Durations are logged (ARC-12).
import type { HouseholdContext, Json } from "@mealplanner/core/types";
import { appendJobEvent, claimJob, finishJob, type JobRow } from "@mealplanner/db/services/plans";
import type { Logger } from "./log.js";
import type { WorkerRuntime } from "./runtime.js";

export interface JobContext {
  rt: WorkerRuntime;
  job: JobRow;
  log: Logger;
  /** Appends a progress event (ordered; awaited before the terminal event). */
  emit(type: string, payload: Json): void;
  /** The household context the job acts in: its creator when set (a UI request), else system. */
  household(): HouseholdContext;
}

export type JobHandler = (ctx: JobContext) => Promise<Json>;

export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function errorJson(error: unknown): Json {
  const e = error as { name?: unknown; message?: unknown; code?: unknown } | null;
  return {
    name: typeof e?.name === "string" ? e.name : "Error",
    message: typeof e?.message === "string" ? e.message.slice(0, 2000) : String(error),
    ...(typeof e?.code === "string" ? { code: e.code } : {}),
  };
}

export async function runJob(rt: WorkerRuntime, jobId: string, handler: JobHandler): Promise<void> {
  const job = await claimJob(rt.db, jobId);
  if (job === null) {
    rt.log.info({ jobId }, "job not claimable (already claimed or withdrawn)");
    return;
  }
  const log = rt.log.child({ jobId, kind: job.kind, householdId: job.householdId });
  const started = performance.now();
  let chain: Promise<unknown> = Promise.resolve();
  const emit = (type: string, payload: Json) => {
    chain = chain.then(() => appendJobEvent(rt.db, jobId, type, payload));
  };
  const ctx: JobContext = {
    rt,
    job,
    log,
    emit,
    household: () => {
      if (job.householdId === null) throw new Error(`${job.kind} needs a household`);
      return job.createdByUserId === null
        ? { householdId: job.householdId, userId: null, role: "system" }
        : { householdId: job.householdId, userId: job.createdByUserId, role: "admin" };
    },
  };
  emit("started", { kind: job.kind });
  try {
    const result = await handler(ctx);
    await chain;
    await appendJobEvent(rt.db, jobId, "done", result);
    await finishJob(rt.db, jobId, { status: "succeeded" });
    log.info({ ms: Math.round(performance.now() - started) }, "job succeeded");
  } catch (error) {
    await chain.catch(() => undefined);
    const err = errorJson(error);
    log.error({ err: error, ms: Math.round(performance.now() - started) }, "job failed");
    await appendJobEvent(rt.db, jobId, "failed", err).catch(() => undefined);
    await finishJob(rt.db, jobId, { status: "failed", error: err });
  }
}
