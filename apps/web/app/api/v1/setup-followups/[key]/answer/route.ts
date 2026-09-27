// POST /api/v1/setup-followups/{key}/answer (R2-ONB-6; BLD-8 R-55): thin handler.
import { setupFollowupsAnswer } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { answerFollowup } from "../../../../../../lib/server/setup-followups";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(setupFollowupsAnswer, ({ rt, caller, params, body }) =>
  answerFollowup(rt, caller, params.key, body),
);
