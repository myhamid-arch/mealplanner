// POST /api/v1/plans/preview (UX-4; BLD-8 R-55): thin handler over the contract endpoint.
import { plansPreview } from "@mealplanner/api-contract/contract";
import { previewPlan } from "../../../../../lib/server/plan-preview";
import { route } from "../../../../../lib/server/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(plansPreview, ({ rt, caller, body }) => previewPlan(rt, caller, body));
