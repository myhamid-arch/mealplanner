// POST /api/v1/insights/run: thin handlers over contract endpoints (lib/server/route.ts).
import { insightsRun } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { runInsightsNow } from "../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(insightsRun, ({ rt, caller }) => runInsightsNow(rt, caller));
