// POST /api/v1/platform/households/{id}/suspend: thin handlers over contract endpoints (lib/server/route.ts).
import { platformSuspend } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../lib/server/route";
import { suspend } from "../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(platformSuspend, ({ rt, params }) => suspend(rt, params.id));
