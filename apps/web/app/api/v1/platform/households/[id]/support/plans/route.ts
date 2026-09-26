// GET /api/v1/platform/households/{id}/support/plans: thin handlers over contract endpoints (lib/server/route.ts).
import { supportPlans } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../../lib/server/route";
import { supportPlansView, withSupport } from "../../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(supportPlans, ({ rt, session, params, query, request }) =>
  withSupport(rt, request, session, params.id, (c) =>
    supportPlansView(rt, c, query.from, query.to),
  ),
);
