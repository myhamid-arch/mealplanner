// Scheduled work (ARC-7, FBK-7, KG-3, R2-ADM-6), from one pg-boss cron tick per minute:
// - every minute: fail jobs left `running` by a lost worker (RUNNING_TIMEOUT_MS), and re-send
//   `job` rows still queued after 30 s (a send lost to a restart; the atomic claim runs each job
//   once);
// - per household not suspended, from 02:00 household time (until 06:00), once a day:
//   `insights.run` when `insight_frequency` is `nightly`, or on Mondays when `weekly`;
// - from 01:00 UTC: `kg.nightly`; from 03:00 UTC: `household.purge` (each once a day).
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { household, job } from "@mealplanner/db/schema";
import {
  JOB_KINDS,
  reapStaleJobs,
  sendOptions,
  type JobKind,
} from "@mealplanner/db/services/plans";
import type { WorkerRuntime } from "./runtime.js";

export const TICK_QUEUE = "scheduler.tick";
export const RESEND_AFTER_MS = 30_000;

function localParts(at: Date, timeZone: string): { hour: number; weekday: string; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    hour: Number(part("hour") || "-1"),
    weekday: part("weekday"),
    date: `${part("year")}-${part("month")}-${part("day")}`,
  };
}

/** True when a job of `kind` (for the household, or global) was already queued for `day`. */
async function queuedFor(
  rt: WorkerRuntime,
  kind: JobKind,
  householdId: string | null,
  day: string,
): Promise<boolean> {
  const [row] = await rt.db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.kind, kind),
        householdId === null ? isNull(job.householdId) : eq(job.householdId, householdId),
        sql`${job.payload} ->> 'day' = ${day}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function tick(
  rt: WorkerRuntime,
  now = new Date(),
): Promise<{ resent: number; reaped: string[]; enqueued: string[]; errors: string[] }> {
  const reaped = await reapStaleJobs(rt.db, now);
  const stale = await rt.db
    .select({ id: job.id, kind: job.kind })
    .from(job)
    .where(
      and(eq(job.status, "queued"), lt(job.createdAt, new Date(now.getTime() - RESEND_AFTER_MS))),
    );
  let resent = 0;
  for (const s of stale)
    if ((JOB_KINDS as readonly string[]).includes(s.kind)) {
      // Dropped by pg-boss while one for the same row is outstanding (sendOptions).
      await rt.boss.send(s.kind, { jobId: s.id }, sendOptions(s.id));
      resent += 1;
    }
  const enqueued: string[] = [];
  const errors: string[] = [];
  const add = async (
    kind: JobKind,
    householdId: string | null,
    payload: Record<string, string>,
  ) => {
    enqueued.push(await rt.enqueue(kind, householdId, payload, null));
  };
  // Daily jobs: the first tick in their window, once per (local or UTC) day, keyed by the day in
  // the payload (a late or missed tick, and a daylight-saving change that repeats or skips a local
  // hour, neither skip nor double them).
  const households = await rt.db
    .select({ id: household.id, tz: household.timezone, freq: household.insightFrequency })
    .from(household)
    .where(and(isNull(household.suspendedAt), isNull(household.deletionConfirmedAt)));
  for (const h of households) {
    try {
      const local = localParts(now, h.tz);
      if (local.hour < 2 || local.hour > 5) continue;
      const due = h.freq === "nightly" || (h.freq === "weekly" && local.weekday === "Mon");
      if (due && !(await queuedFor(rt, "insights.run", h.id, local.date)))
        await add("insights.run", h.id, { trigger: h.freq, day: local.date });
    } catch (error) {
      // One household's bad setting (an invalid time zone) must not stop the others.
      errors.push(`${h.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const hour = now.getUTCHours();
  const utcDay = now.toISOString().slice(0, 10);
  if (hour >= 1 && hour < 3 && !(await queuedFor(rt, "kg.nightly", null, utcDay)))
    await add("kg.nightly", null, { trigger: "nightly", day: utcDay });
  if (hour >= 3 && hour < 5 && !(await queuedFor(rt, "household.purge", null, utcDay)))
    await add("household.purge", null, { trigger: "daily", day: utcDay });
  return { resent, reaped, enqueued, errors };
}
