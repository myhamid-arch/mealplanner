// POST /api/v1/cook-sheets/{date}/flags: thin handlers over contract endpoints (lib/server/route.ts).
import { cookSheetsFlag } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { kitchenFlag } from "../../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(cookSheetsFlag, ({ rt, caller, params, body }) =>
  kitchenFlag(rt, caller, params.date, body),
);
