// GET /api/v1/platform/jobs/failed: thin handlers over contract endpoints (lib/server/route.ts).
import { platformFailedJobs } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { failed } from "../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(platformFailedJobs, ({ rt, query }) => failed(rt, query.hours));
