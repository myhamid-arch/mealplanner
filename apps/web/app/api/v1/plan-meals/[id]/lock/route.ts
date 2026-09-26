// POST /api/v1/plan-meals/{id}/lock: thin handlers over contract endpoints (lib/server/route.ts).
import { planMealsLock } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { setLock } from "../../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(planMealsLock, ({ rt, caller, params }) =>
  setLock(rt, caller, params.id, true),
);
