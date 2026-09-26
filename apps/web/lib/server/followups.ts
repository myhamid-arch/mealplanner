// After a change set is applied through the API: revoke the sessions of logins it blocked or
// removed (R2-ADM-4, whatever path applied it: the change log, an undo, an accepted proposal),
// queue its follow-up jobs (nutrition, graph, re-solve; see @mealplanner/db/services/plans
// followUpJobs) and send any job rows its ops queued (`recipe.*`, R-40). Sending is idempotent
// (pg-boss ignores a duplicate id).
import { and, eq } from "drizzle-orm";
import { changeSet, household, householdUser, job } from "@mealplanner/db/schema";
import { followUpJobs } from "@mealplanner/db/services/plans";
import { localDate } from "@mealplanner/db/services/proposals";
import { revokeAllSessions } from "./identity";
import { enqueueJob } from "./jobs";
import type { Runtime } from "./runtime";

export async function afterChangeSet(
  rt: Runtime,
  householdId: string,
  changeSetId: string,
  userId: string | null,
): Promise<string[]> {
  const [row] = await rt.db.select().from(changeSet).where(eq(changeSet.id, changeSetId));
  const [h] = await rt.db
    .select({ timezone: household.timezone })
    .from(household)
    .where(eq(household.id, householdId));
  if (row === undefined || h === undefined) return [];
  await revokeLostAccess(rt, householdId, row.inverse);
  const ids: string[] = [];
  for (const f of followUpJobs(row, safeLocalDate(h.timezone)))
    ids.push(
      await enqueueJob(rt.db, rt.queue, {
        kind: f.kind,
        householdId,
        payload: f.payload,
        createdByUserId: userId,
      }),
    );
  const queued = await rt.db
    .select({ id: job.id, kind: job.kind })
    .from(job)
    .where(and(eq(job.householdId, householdId), eq(job.status, "queued")));
  for (const q of queued)
    if (q.kind === "recipe.generate" || q.kind === "recipe.revise")
      await rt.queue.send(q.kind, q.id);
  return ids;
}

/** Today in the household's zone; UTC if the stored zone is not a valid IANA name. */
function safeLocalDate(timeZone: string): string {
  try {
    return localDate(new Date(), timeZone);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Users whose login in this household the change set touched and who now cannot use it. */
async function revokeLostAccess(rt: Runtime, householdId: string, inverse: unknown): Promise<void> {
  const userIds = new Set<string>();
  for (const op of Array.isArray(inverse) ? inverse : []) {
    const images = (op as { payload?: { images?: unknown } }).payload?.images;
    if (!Array.isArray(images)) continue;
    for (const img of images as Array<{ entity?: string; key?: { userId?: unknown } }>)
      if (img.entity === "household_user" && typeof img.key?.userId === "string")
        userIds.add(img.key.userId);
  }
  for (const userId of userIds) {
    const [login] = await rt.db
      .select({ status: householdUser.status })
      .from(householdUser)
      .where(and(eq(householdUser.householdId, householdId), eq(householdUser.userId, userId)));
    if (login === undefined || login.status === "blocked") await revokeAllSessions(rt, userId);
  }
}
