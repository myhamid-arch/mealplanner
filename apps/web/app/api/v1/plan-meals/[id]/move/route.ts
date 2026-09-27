// POST /api/v1/plan-meals/{id}/move: thin handlers over contract endpoints (lib/server/route.ts).
import { planMealsMove } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { moveMeal } from "../../../../../../lib/server/plan-move";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(planMealsMove, ({ rt, caller, params, body }) =>
  moveMeal(rt, caller, params.id, body.toDate),
);
