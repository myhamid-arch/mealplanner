// GET /api/v1/reviews/{id}/revisions: thin handlers over contract endpoints (lib/server/route.ts).
import { reviewsRevisions } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { revisions } from "../../../../../../lib/server/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(reviewsRevisions, ({ rt, caller, params }) =>
  revisions(rt, caller, params.id),
);
