// POST /api/v1/reviews/{id}/replies: thin handlers over contract endpoints (lib/server/route.ts).
import { reviewsReply } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { reply } from "../../../../../../lib/server/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(reviewsReply, ({ rt, caller, params, body }) =>
  reply(rt, caller, params.id, body.comment),
);
