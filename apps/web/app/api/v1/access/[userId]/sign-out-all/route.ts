// POST /api/v1/access/{userId}/sign-out-all: thin handlers over contract endpoints (lib/server/route.ts).
import { accessSignOutAll } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { signOutEverywhere } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accessSignOutAll, ({ rt, caller, params }) =>
  signOutEverywhere(rt, caller, params.userId),
);
