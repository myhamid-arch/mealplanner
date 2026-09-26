// GET /api/v1/weights: thin handlers over contract endpoints (lib/server/route.ts).
import { weightsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { getWeights } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(weightsGet, ({ rt, caller }) => getWeights(rt, caller));
