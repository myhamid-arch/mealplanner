// POST /api/v1/proposals/{id}/accept: thin handlers over contract endpoints (lib/server/route.ts).
import { proposalsAccept } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { accept } from "../../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(proposalsAccept, ({ rt, caller, params }) =>
  accept(rt, caller, params.id),
);
