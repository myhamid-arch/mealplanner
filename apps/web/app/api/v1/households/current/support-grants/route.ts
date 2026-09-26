// GET, POST /api/v1/households/current/support-grants: thin handlers over contract endpoints (lib/server/route.ts).
import { supportGrantsCreate, supportGrantsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { createGrant, listGrants } from "../../../../../../lib/server/household";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(supportGrantsList, ({ rt, caller }) => listGrants(rt, caller));
export const POST = route(supportGrantsCreate, ({ rt, caller, body }) =>
  createGrant(rt, caller, body),
);
