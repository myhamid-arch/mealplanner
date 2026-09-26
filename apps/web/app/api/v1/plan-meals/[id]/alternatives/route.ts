// GET /api/v1/plan-meals/{id}/alternatives: thin handlers over contract endpoints (lib/server/route.ts).
import { planMealsAlternatives } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { alternatives } from "../../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(planMealsAlternatives, ({ rt, caller, params }) =>
  alternatives(rt, caller, params.id),
);
