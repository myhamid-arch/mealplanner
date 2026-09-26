// POST /api/v1/invites/accept: thin handlers over contract endpoints (lib/server/route.ts).
import { invitesAccept } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { acceptInvite } from "../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(invitesAccept, ({ rt, session, body }) =>
  acceptInvite(rt, body, session),
);
