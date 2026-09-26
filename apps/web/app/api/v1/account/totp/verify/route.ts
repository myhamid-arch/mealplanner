// POST /api/v1/account/totp/verify: thin handlers over contract endpoints (lib/server/route.ts).
import { accountTotpVerify } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { verifyTotp } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accountTotpVerify, ({ rt, body, request }) =>
  verifyTotp(rt, request, body.code),
);
