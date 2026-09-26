// PATCH /api/v1/reviews/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { reviewsEdit } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { changeReview } from "../../../../../lib/server/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = route(reviewsEdit, ({ rt, caller, params, body }) =>
  changeReview(rt, caller, params.id, body),
);
