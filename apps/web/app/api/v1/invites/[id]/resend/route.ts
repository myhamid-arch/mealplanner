// POST /api/v1/invites/{id}/resend: thin handlers over contract endpoints (lib/server/route.ts).
import { invitesResend } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { resendInvite } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(invitesResend, ({ rt, caller, params, body }) =>
  resendInvite(rt, caller, params.id, body),
);
