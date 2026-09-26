// GET /api/v1/dishes/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { dishesGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { getDish } from "../../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(dishesGet, ({ rt, caller, params }) => getDish(rt, caller, params.id));
