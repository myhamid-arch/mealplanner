// POST /api/v1/account/password: thin handlers over contract endpoints (lib/server/route.ts).
import { accountPassword } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { changePassword } from "../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accountPassword, ({ rt, body, request }) =>
  changePassword(rt, request, body),
);
