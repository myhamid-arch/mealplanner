// POST /api/v1/plates/{id}/override: thin handlers over contract endpoints (lib/server/route.ts).
import { platesOverride } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { overridePlate } from "../../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(platesOverride, ({ rt, caller, params, body }) =>
  overridePlate(rt, caller, params.id, body.items),
);
