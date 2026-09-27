// POST /api/v1/plan-meals/{id}/status: thin handlers over contract endpoints (lib/server/route.ts).
import { planMealsStatus } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { setMealStatus } from "../../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(planMealsStatus, ({ rt, caller, params, body }) =>
  setMealStatus(rt, caller, params.id, body.status),
);
