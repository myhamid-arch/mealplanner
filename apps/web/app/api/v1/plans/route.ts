// GET /api/v1/plans: thin handlers over contract endpoints (lib/server/route.ts).
import { plansList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { planDays } from "../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(plansList, ({ rt, caller, query }) =>
  planDays(rt, caller, query.from, query.to),
);
