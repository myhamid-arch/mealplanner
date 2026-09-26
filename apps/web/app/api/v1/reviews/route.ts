// GET, POST /api/v1/reviews: thin handlers over contract endpoints (lib/server/route.ts).
import { reviewsCreate, reviewsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listReviews, writeReview } from "../../../../lib/server/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(reviewsList, ({ rt, caller, query }) => listReviews(rt, caller, query));
export const POST = route(reviewsCreate, ({ rt, caller, body }) => writeReview(rt, caller, body));
