// POST /api/v1/access/{userId}/block: thin handlers over contract endpoints (lib/server/route.ts).
import { accessBlock } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { blockLogin } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accessBlock, ({ rt, caller, params, body }) =>
  blockLogin(rt, caller, params.userId, body.reason),
);
