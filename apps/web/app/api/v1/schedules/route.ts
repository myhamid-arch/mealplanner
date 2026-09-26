// GET /api/v1/schedules: thin handlers over contract endpoints (lib/server/route.ts).
import { schedulesGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { getSchedules } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(schedulesGet, ({ rt, caller }) => getSchedules(rt, caller));
