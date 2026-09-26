// POST /api/v1/access/{userId}/remove: thin handlers over contract endpoints (lib/server/route.ts).
import { accessRemove } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { removeLogin } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accessRemove, ({ rt, caller, params, body }) =>
  removeLogin(rt, caller, params.userId, body),
);
