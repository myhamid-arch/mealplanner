// GET /api/v1/exclusions: thin handlers over contract endpoints (lib/server/route.ts).
import { exclusionsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listExclusions } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(exclusionsList, ({ rt, caller, query }) =>
  listExclusions(rt, caller, query.kind),
);
