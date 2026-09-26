// GET /api/v1/platform/households/{id}/support/summary: thin handlers over contract endpoints (lib/server/route.ts).
import { supportSummary } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../../lib/server/route";
import { supportSummaryView, withSupport } from "../../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(supportSummary, ({ rt, session, params, request }) =>
  withSupport(rt, request, session, params.id, (c) => supportSummaryView(rt, c)),
);
