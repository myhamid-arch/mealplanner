// POST /api/v1/access/{userId}/unblock: thin handlers over contract endpoints (lib/server/route.ts).
import { accessUnblock } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { unblockLogin } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accessUnblock, ({ rt, caller, params }) =>
  unblockLogin(rt, caller, params.userId),
);
