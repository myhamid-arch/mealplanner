// POST /api/v1/platform/households/{id}/reactivate: thin handlers over contract endpoints (lib/server/route.ts).
import { platformReactivate } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../lib/server/route";
import { reactivate } from "../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(platformReactivate, ({ rt, params }) => reactivate(rt, params.id));
