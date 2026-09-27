// POST /api/v1/setup-followups/{key}/dismiss (R2-ONB-6; BLD-8 R-55): thin handler.
import { setupFollowupsDismiss } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { dismissFollowup } from "../../../../../../lib/server/setup-followups";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(setupFollowupsDismiss, ({ rt, caller, params }) =>
  dismissFollowup(rt, caller, params.key),
);
