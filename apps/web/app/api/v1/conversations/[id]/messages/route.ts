// GET, POST /api/v1/conversations/{id}/messages: thin handlers over contract endpoints
// (lib/server/route.ts). POST streams the agent's turn as Server-Sent Events (AGT-2, AGT-7).
import { conversationMessages, conversationsSend } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { messages } from "../../../../../../lib/server/changes";
import { sendMessage } from "../../../../../../lib/server/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(conversationMessages, ({ rt, caller, params }) =>
  messages(rt, caller, params.id),
);

export const POST = route(conversationsSend, ({ rt, caller, params, body, request }) =>
  sendMessage(rt, caller, params.id, body, request),
);
