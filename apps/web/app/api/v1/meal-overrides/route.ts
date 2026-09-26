// GET /api/v1/meal-overrides: thin handlers over contract endpoints (lib/server/route.ts).
import { mealOverridesList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listMealOverrides } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(mealOverridesList, ({ rt, caller, query }) =>
  listMealOverrides(rt, caller, query.from, query.to),
);
