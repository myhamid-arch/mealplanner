// POST /api/v1/households/current/support-grants/{id}/revoke: thin handlers over contract endpoints (lib/server/route.ts).
import { supportGrantsRevoke } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../../lib/server/route";
import { revokeGrant } from "../../../../../../../../lib/server/household";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(supportGrantsRevoke, ({ rt, caller, params }) =>
  revokeGrant(rt, caller, params.id),
);
