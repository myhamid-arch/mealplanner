// POST /api/v1/platform/users/{id}/unblock: thin handlers over contract endpoints (lib/server/route.ts).
import { platformUnblock } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../lib/server/route";
import { unblockUser } from "../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(platformUnblock, ({ rt, params }) => unblockUser(rt, params.id));
