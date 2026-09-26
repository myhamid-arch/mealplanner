// POST /api/v1/plan-meals/{id}/swap: thin handlers over contract endpoints (lib/server/route.ts).
import { planMealsSwap } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { swap } from "../../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(planMealsSwap, ({ rt, caller, params, body }) =>
  swap(rt, caller, params.id, body.dishId),
);
