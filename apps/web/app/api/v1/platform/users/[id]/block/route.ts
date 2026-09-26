// POST /api/v1/platform/users/{id}/block: thin handlers over contract endpoints (lib/server/route.ts).
import { platformBlock } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../lib/server/route";
import { blockUser } from "../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(platformBlock, ({ rt, session, params }) =>
  blockUser(rt, session, params.id),
);
