// GET /api/v1/plates/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { platesGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { getPlate } from "../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(platesGet, ({ rt, caller, params }) => getPlate(rt, caller, params.id));
