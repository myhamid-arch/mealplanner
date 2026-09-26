// GET /api/v1/jobs/{id}/events: thin handlers over contract endpoints (lib/server/route.ts).
import { jobsEvents } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { jobEvents } from "../../../../../../lib/server/job-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(jobsEvents, ({ rt, caller, params, request }) =>
  jobEvents(rt, caller, request, params.id),
);
