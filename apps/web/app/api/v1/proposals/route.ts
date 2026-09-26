// GET /api/v1/proposals: thin handlers over contract endpoints (lib/server/route.ts).
import { proposalsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { proposals } from "../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(proposalsList, ({ rt, caller, query }) =>
  proposals(rt, caller, query.status),
);
