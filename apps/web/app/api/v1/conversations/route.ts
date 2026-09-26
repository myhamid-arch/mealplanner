// GET, POST /api/v1/conversations: thin handlers over contract endpoints (lib/server/route.ts).
import { conversationsCreate, conversationsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { conversations, createConversation } from "../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(conversationsList, ({ rt, caller }) => conversations(rt, caller));
export const POST = route(conversationsCreate, ({ rt, caller, body }) =>
  createConversation(rt, caller, body.title),
);
