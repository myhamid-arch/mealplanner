// POST /api/v1/access/{userId}/password-reset: thin handlers over contract endpoints (lib/server/route.ts).
import { accessPasswordReset } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { sendPasswordReset } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accessPasswordReset, ({ rt, caller, params }) =>
  sendPasswordReset(rt, caller, params.userId),
);
