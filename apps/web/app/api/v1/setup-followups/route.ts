// GET /api/v1/setup-followups (R2-ONB-6; BLD-8 R-55): thin handler over the contract endpoint.
import { setupFollowupsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { getFollowups } from "../../../../lib/server/setup-followups";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(setupFollowupsGet, ({ rt, caller }) => getFollowups(rt, caller));
