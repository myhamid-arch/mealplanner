// GET /api/v1/jobs/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { jobsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { jobStatus } from "../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(jobsGet, ({ rt, caller, params }) => jobStatus(rt, caller, params.id));
