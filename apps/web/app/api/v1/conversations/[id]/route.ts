// GET /api/v1/conversations/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { conversationsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { conversationOne } from "../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(conversationsGet, ({ rt, caller, params }) =>
  conversationOne(rt, caller, params.id),
);
