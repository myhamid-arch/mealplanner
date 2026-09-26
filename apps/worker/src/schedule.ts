// Scheduled work (ARC-7, FBK-7, KG-3, R2-ADM-6), from one pg-boss cron tick per minute:
// - every minute: re-send `job` rows still queued after 30 s (a send lost to a restart; pg-boss
//   ignores a duplicate id, and the atomic claim runs each job once);
// - hourly, per household not suspended, at 02:00 household time: `insights.run` when
//   `insight_frequency` is `nightly`, or on Mondays when `weekly`;
// - daily at 01:00 UTC: `kg.nightly`; at 03:00 UTC: `household.purge`.
import { and, eq, isNull, lt } from "drizzle-orm";
import { household, job } from "@mealplanner/db/schema";
import { JOB_KINDS, type JobKind } from "@mealplanner/db/services/plans";
import type { WorkerRuntime } from "./runtime.js";

export const TICK_QUEUE = "scheduler.tick";
export const RESEND_AFTER_MS = 30_000;

function localParts(at: Date, timeZone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? "-1"),
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
  };
}

export async function tick(
  rt: WorkerRuntime,
  now = new Date(),
): Promise<{ resent: number; enqueued: string[] }> {
  const stale = await rt.db
    .select({ id: job.id, kind: job.kind })
    .from(job)
    .where(
      and(eq(job.status, "queued"), lt(job.createdAt, new Date(now.getTime() - RESEND_AFTER_MS))),
    );
  let resent = 0;
  for (const s of stale)
    if ((JOB_KINDS as readonly string[]).includes(s.kind)) {
      await rt.boss.send(s.kind, { jobId: s.id }, { id: s.id });
      resent += 1;
    }
  const enqueued: string[] = [];
  if (now.getUTCMinutes() !== 0) return { resent, enqueued };
  const add = async (
    kind: JobKind,
    householdId: string | null,
    payload: Record<string, string>,
  ) => {
    enqueued.push(await rt.enqueue(kind, householdId, payload, null));
  };
  const households = await rt.db
    .select({ id: household.id, tz: household.timezone, freq: household.insightFrequency })
    .from(household)
    .where(and(isNull(household.suspendedAt), isNull(household.deletionConfirmedAt)));
  for (const h of households) {
    const local = localParts(now, h.tz);
    if (local.hour !== 2) continue;
    if (h.freq === "nightly" || (h.freq === "weekly" && local.weekday === "Mon"))
      await add("insights.run", h.id, { trigger: h.freq });
  }
  if (now.getUTCHours() === 1) await add("kg.nightly", null, { trigger: "nightly" });
  if (now.getUTCHours() === 3) await add("household.purge", null, { trigger: "daily" });
  return { resent, enqueued };
}
