// `GET /api/v1/jobs/:id/events` (ARC-5, ARC-7): the job must belong to the caller's household
// (another household's job reads as absent, 404); `Last-Event-ID` (header, or `lastEventId` query
// for clients that cannot set headers) resumes after that event.
import { jobOf } from "@mealplanner/db/services/plans";
import type { CallerContext } from "../auth/context";
import { notFound } from "./problem";
import type { Runtime } from "./runtime";
import { jobEventStream } from "./sse";

export async function jobEvents(
  rt: Runtime,
  caller: CallerContext,
  request: Request,
  jobId: string,
): Promise<Response> {
  const job = await jobOf(rt.db, caller.ctx, jobId);
  if (job === null) throw notFound("job");
  const raw =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("lastEventId");
  const after = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0;
  return jobEventStream({
    db: rt.db,
    hub: rt.events,
    jobId,
    afterSeq: after,
    signal: request.signal,
  });
}
