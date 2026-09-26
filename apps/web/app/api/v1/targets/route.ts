// GET /api/v1/targets: thin handlers over contract endpoints (lib/server/route.ts).
import { targetsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listTargets } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(targetsList, ({ rt, caller }) => listTargets(rt, caller));
