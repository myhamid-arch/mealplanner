// GET /api/v1/conversations/{id}/messages: thin handlers over contract endpoints (lib/server/route.ts).
import { conversationMessages } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { messages } from "../../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(conversationMessages, ({ rt, caller, params }) =>
  messages(rt, caller, params.id),
);
