// POST /api/v1/account/totp/enable: thin handlers over contract endpoints (lib/server/route.ts).
import { accountTotpEnable } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { enableTotp } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accountTotpEnable, ({ rt, body, request }) =>
  enableTotp(rt, request, body.password),
);
