// POST /api/v1/access/{userId}/role: thin handlers over contract endpoints (lib/server/route.ts).
import { accessRole } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { changeRole } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accessRole, ({ rt, caller, params, body }) =>
  changeRole(rt, caller, params.userId, body.role),
);
