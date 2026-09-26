// POST /api/v1/proposals/{id}/reject: thin handlers over contract endpoints (lib/server/route.ts).
import { proposalsReject } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { reject } from "../../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(proposalsReject, ({ rt, caller, params, body }) =>
  reject(rt, caller, params.id, body.note),
);
