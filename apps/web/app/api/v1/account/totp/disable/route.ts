// POST /api/v1/account/totp/disable: thin handlers over contract endpoints (lib/server/route.ts).
import { accountTotpDisable } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { disableTotp } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accountTotpDisable, ({ rt, session, body, request }) =>
  disableTotp(rt, request, session, body.password),
);
