// POST /api/v1/plans/{date}/publish: thin handlers over contract endpoints (lib/server/route.ts).
import { plansPublish } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { publishDay } from "../../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(plansPublish, ({ rt, caller, params }) =>
  publishDay(rt, caller, params.date),
);
