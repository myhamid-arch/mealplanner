// Job rows and progress events (ARC-7; BLD-8 R-40, leaf-1.4.1 SPEC-Q-8, ADR-2). A job row is created
// `queued` (by the API, or by a `recipe.*` change op), claimed atomically by the worker, and ends
// `succeeded`, `failed` or `cancelled`. Status updates are operational writes outside DM-6 (R-40).
// Each event is one `job_event` row plus `pg_notify('job_event', '<job id>:<seq>')` in the same
// statement, so an SSE reader either replays it or is notified of it.
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { HouseholdContext, Json } from "@mealplanner/core/types";
import type { Executor } from "../../repos/index.js";
import { job, jobEvent } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";

/** Every job kind the worker runs (ARC-7; `reviews.extract` belongs to 1.3.5, R-40). */
export const JOB_KINDS = [
  "plan.generate",
  "nutrition.recompute",
  "plates.resolve",
  "plates.substitute",
  "insights.run",
  "kg.sync",
  "kg.nightly",
  "recipe.generate",
  "recipe.revise",
  "household.purge",
  "recipe.draft",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_EVENT_CHANNEL = "job_event";

/**
 * pg-boss options of every job queue (ADR-2), shared by the web (sender) and the worker. A pg-boss
 * job carries the `job` row id as its `singletonKey` under the `exclusive` policy: at most one
 * pg-boss job per row is queued or active, so re-sends are dropped while one is outstanding, and a
 * row sent again after its pg-boss job finished (a redo) is accepted. pg-boss does not retry: the
 * runner retries idempotent kinds itself, and a failure is recorded on the row.
 */
export const QUEUE_OPTIONS = {
  policy: "exclusive",
  retryLimit: 0,
  expireInSeconds: 2 * 3600,
} as const;

/** A job still `running` this long after it started lost its worker (stop, crash): it is failed. */
export const RUNNING_TIMEOUT_MS = 2 * 3600_000 + 10 * 60_000;

export function sendOptions(jobId: string): { singletonKey: string } {
  return { singletonKey: jobId };
}

/** Terminal event types: an SSE stream closes after one of them. */
export const TERMINAL_EVENTS: ReadonlySet<string> = new Set(["done", "failed", "cancelled"]);

export type JobRow = typeof job.$inferSelect;
export type JobEventRow = typeof jobEvent.$inferSelect;

export async function createJob(
  db: Executor,
  args: {
    kind: JobKind;
    householdId: string | null;
    payload: Json;
    createdByUserId?: string | null;
    id?: string;
  },
): Promise<JobRow> {
  const [row] = await db
    .insert(job)
    .values({
      id: args.id ?? newId(),
      householdId: args.householdId,
      kind: args.kind,
      payload: args.payload,
      status: "queued",
      error: null,
      createdByUserId: args.createdByUserId ?? null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    })
    .returning();
  if (row === undefined) throw new Error("job insert returned nothing");
  return row;
}

/**
 * R-40: the worker's atomic claim. Returns the job when this call moved it from `queued` to
 * `running`, null when it was already claimed or withdrawn (a `recipe.*` undo deleted it).
 */
export async function claimJob(
  db: Executor,
  jobId: string,
  now = new Date(),
): Promise<JobRow | null> {
  const [row] = await db
    .update(job)
    .set({ status: "running", startedAt: now })
    .where(and(eq(job.id, jobId), eq(job.status, "queued")))
    .returning();
  return row ?? null;
}

export async function finishJob(
  db: Executor,
  jobId: string,
  outcome:
    | { status: "succeeded" }
    | { status: "failed"; error: Json }
    | { status: "cancelled"; error?: Json },
  now = new Date(),
): Promise<void> {
  await db
    .update(job)
    .set({
      status: outcome.status,
      error: outcome.status === "succeeded" ? null : (outcome.error ?? null),
      finishedAt: now,
    })
    .where(eq(job.id, jobId));
}

/** Appends one event (next seq) and notifies listeners, atomically. Returns the seq. */
export async function appendJobEvent(
  db: Executor,
  jobId: string,
  type: string,
  payload: Json,
): Promise<number> {
  const result = await db.execute<{ seq: number }>(sql`
    WITH next AS (
      SELECT j.id, j.household_id,
             coalesce((SELECT max(e.seq) FROM job_event e WHERE e.job_id = j.id), 0) + 1 AS seq
      FROM job j WHERE j.id = ${jobId} FOR UPDATE
    ), ins AS (
      INSERT INTO job_event (job_id, seq, household_id, type, payload, created_at)
      SELECT id, seq, household_id, ${type}, ${JSON.stringify(payload)}::jsonb, now() FROM next
      RETURNING job_id, seq
    )
    SELECT seq, pg_notify(${JOB_EVENT_CHANNEL}, job_id::text || ':' || seq::text) FROM ins`);
  const seq = result.rows[0]?.seq;
  if (seq === undefined) throw new Error(`job ${jobId} not found`);
  return seq;
}

/** The job, only if it belongs to the household (other households' jobs read as absent, DM-1). */
export async function jobOf(
  db: Executor,
  ctx: HouseholdContext,
  jobId: string,
): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.householdId, ctx.householdId)));
  return row ?? null;
}

/** Events of a job after `afterSeq`, in order. The caller has checked the job's household. */
export async function jobEventsAfter(
  db: Executor,
  jobId: string,
  afterSeq: number,
): Promise<JobEventRow[]> {
  return db
    .select()
    .from(jobEvent)
    .where(and(eq(jobEvent.jobId, jobId), gt(jobEvent.seq, afterSeq)))
    .orderBy(asc(jobEvent.seq));
}

/** ARC-12 / R2-ADM-8: failed jobs, newest first (one household, or every household when null). */
export async function failedJobs(
  db: Executor,
  scope: { householdId: string } | { since: Date },
  limit = 100,
): Promise<JobRow[]> {
  return db
    .select()
    .from(job)
    .where(
      "householdId" in scope
        ? and(eq(job.status, "failed"), eq(job.householdId, scope.householdId))
        : and(eq(job.status, "failed"), gt(job.createdAt, scope.since)),
    )
    .orderBy(desc(job.createdAt))
    .limit(limit);
}

/** Jobs still queued (for re-sending to the queue after a restart). */
export async function queuedJobs(
  db: Executor,
  kinds: readonly JobKind[] = JOB_KINDS,
): Promise<JobRow[]> {
  return db
    .select()
    .from(job)
    .where(and(eq(job.status, "queued"), inArray(job.kind, [...kinds])))
    .orderBy(asc(job.createdAt));
}

/**
 * Fails jobs left `running` past RUNNING_TIMEOUT_MS (their worker stopped mid-run), appending the
 * terminal `failed` event so their streams close. Returns the ids.
 */
export async function reapStaleJobs(db: Executor, now = new Date()): Promise<string[]> {
  const error = {
    name: "WorkerLost",
    message: "the worker stopped while running this job; start it again",
  };
  const rows = await db
    .update(job)
    .set({ status: "failed", error, finishedAt: now })
    .where(
      and(
        eq(job.status, "running"),
        lt(job.startedAt, new Date(now.getTime() - RUNNING_TIMEOUT_MS)),
      ),
    )
    .returning({ id: job.id });
  for (const r of rows) await appendJobEvent(db, r.id, "failed", error);
  return rows.map((r) => r.id);
}
