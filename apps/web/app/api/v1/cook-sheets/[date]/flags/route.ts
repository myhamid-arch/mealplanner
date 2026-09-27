// POST /api/v1/cook-sheets/{date}/flags: thin handlers over contract endpoints (lib/server/route.ts).
import { cookSheetsFlag, cookSheetsFlags } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { kitchenFlag } from "../../../../../../lib/server/plans";
import { listKitchenFlags } from "../../../../../../lib/server/kitchen-flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(cookSheetsFlag, ({ rt, caller, params, body }) =>
  kitchenFlag(rt, caller, params.date, body),
);

export const GET = route(cookSheetsFlags, ({ rt, caller, params }) =>
  listKitchenFlags(rt, caller, params.date),
);
