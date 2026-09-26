// After a change set is applied through the API: queue its follow-up jobs (nutrition, graph,
// re-solve; see @mealplanner/db/services/plans followUpJobs) and send any job rows its ops queued
// (`recipe.*`, R-40). Sending is idempotent (pg-boss ignores a duplicate id).
import { and, eq } from "drizzle-orm";
import { changeSet, household, job } from "@mealplanner/db/schema";
import { followUpJobs } from "@mealplanner/db/services/plans";
import { localDate } from "@mealplanner/db/services/proposals";
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
  const ids: string[] = [];
  for (const f of followUpJobs(row, localDate(new Date(), h.timezone)))
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
