// POST /api/v1/platform/households/{id}/delete: thin handlers over contract endpoints (lib/server/route.ts).
import { platformDelete } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../lib/server/route";
import { startDeletion } from "../../../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(platformDelete, ({ rt, session, params }) =>
  startDeletion(rt, session, params.id),
);
