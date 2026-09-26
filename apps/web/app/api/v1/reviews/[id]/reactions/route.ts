// POST /api/v1/reviews/{id}/reactions: thin handlers over contract endpoints (lib/server/route.ts).
import { reviewsReact } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { react } from "../../../../../../lib/server/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(reviewsReact, ({ rt, caller, params, body }) =>
  react(rt, caller, params.id, body.kind),
);
