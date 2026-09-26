// GET, POST /api/v1/invites: thin handlers over contract endpoints (lib/server/route.ts).
import { invitesCreate, invitesList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { createInvite, listInvites } from "../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(invitesList, ({ rt, caller }) => listInvites(rt, caller));
export const POST = route(invitesCreate, ({ rt, caller, body }) => createInvite(rt, caller, body));
