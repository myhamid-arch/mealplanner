// Runs one job (ARC-7; R-40): atomic claim of the `job` row (a withdrawn or already-claimed job is
// skipped), a `started` event, the handler, then `done` with the handler's result or `failed`
// with the error, and the row's final status. Events are appended in order (one chain per job).
// Durations are logged (ARC-12).
import type { HouseholdContext, Json } from "@mealplanner/core/types";
import {
  TERMINAL_EVENTS,
  appendJobEvent,
  claimJob,
  finishJob,
  type JobRow,
} from "@mealplanner/db/services/plans";
import { postJobCompletion } from "./jobs/chat-events.js";
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

/**
 * Kinds that are safe to run again (ADR-2): a failed attempt is retried in the same run after
 * each delay, with a `retrying` event; other kinds (plans, AI, purge) fail at once and are re-run
 * only when asked.
 */
const RETRYABLE: ReadonlySet<string> = new Set([
  "kg.sync",
  "kg.nightly",
  "nutrition.recompute",
  "plates.resolve",
]);
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

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
    // Terminal events close the stream; only the runner appends them, after the handler.
    if (TERMINAL_EVENTS.has(type))
      throw new Error(`a handler cannot emit the terminal event ${type}`);
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
  let outcome: { ok: true; result: Json } | { ok: false; error: unknown };
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await handler(ctx);
      await chain;
      outcome = { ok: true, result };
      break;
    } catch (error) {
      await chain.catch(() => undefined);
      chain = Promise.resolve();
      const delay = RETRYABLE.has(job.kind) ? RETRY_DELAYS_MS[attempt] : undefined;
      if (delay === undefined) {
        outcome = { ok: false, error };
        break;
      }
      log.warn({ err: error, attempt: attempt + 1 }, "job attempt failed; retrying");
      emit("retrying", { attempt: attempt + 1, error: errorJson(error) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  const ms = Math.round(performance.now() - started);
  // leaf 1.3.5 (R-46): a job the agent started reports back into its conversation (SPEC-Q-9).
  await postJobCompletion(
    rt,
    job,
    outcome.ok
      ? { ok: true, result: outcome.result }
      : { ok: false, error: errorJson(outcome.error) },
  ).catch((error: unknown) => {
    log.error({ err: error }, "the job's chat message could not be posted");
  });
  if (outcome.ok) {
    try {
      // W-20: the terminal event and the status commit together, so a client that sees `done`
      // (its pg_notify is delivered at commit) reads the job as succeeded.
      await rt.db.transaction(async (tx) => {
        await appendJobEvent(tx, jobId, "done", outcome.result);
        await finishJob(tx, jobId, { status: "succeeded" });
      });
      log.info({ ms }, "job succeeded");
    } catch (error) {
      // The work is done; only its record failed. No `failed` after a `done`.
      log.error({ err: error, ms }, "job succeeded but its completion could not be stored");
    }
    return;
  }
  const err = errorJson(outcome.error);
  log.error({ err: outcome.error, ms }, "job failed");
  // W-20: `failed` and the status commit together; if that cannot be stored, the status alone is
  // still written, so the job never stays running.
  await rt.db
    .transaction(async (tx) => {
      await appendJobEvent(tx, jobId, "failed", err);
      await finishJob(tx, jobId, { status: "failed", error: err });
    })
    .catch(async (error: unknown) => {
      log.error({ err: error }, "job failed and its failed event could not be stored");
      await finishJob(rt.db, jobId, { status: "failed", error: err }).catch((e: unknown) => {
        log.error({ err: e }, "job failed and its status could not be stored");
      });
    });
}
