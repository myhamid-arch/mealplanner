// GET /api/v1/platform/households/{id}/support/change-log: thin handlers over contract endpoints (lib/server/route.ts).
import { supportChangeLog } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../../lib/server/route";
import { supportChangeLogView, withSupport } from "../../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(supportChangeLog, ({ rt, session, params, request }) =>
  withSupport(rt, request, session, params.id, (c) => supportChangeLogView(rt, c)),
);
