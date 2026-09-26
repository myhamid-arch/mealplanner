// DELETE /api/v1/account/sessions/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { accountSessionRevoke } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { revokeSession } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const DELETE = route(accountSessionRevoke, ({ rt, session, params }) =>
  revokeSession(rt, session, params.id).then(() => undefined),
);
