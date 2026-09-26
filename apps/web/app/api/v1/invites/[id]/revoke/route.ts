// POST /api/v1/invites/{id}/revoke: thin handlers over contract endpoints (lib/server/route.ts).
import { invitesRevoke } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { revokeInvite } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(invitesRevoke, ({ rt, caller, params }) =>
  revokeInvite(rt, caller, params.id),
);
