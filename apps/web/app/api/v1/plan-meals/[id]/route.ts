// GET /api/v1/plan-meals/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { planMealsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { mealDto } from "../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(planMealsGet, ({ rt, caller, params }) => mealDto(rt, caller, params.id));
