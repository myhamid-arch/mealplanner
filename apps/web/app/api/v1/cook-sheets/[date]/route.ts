// GET /api/v1/cook-sheets/{date}: thin handlers over contract endpoints (lib/server/route.ts).
import { cookSheetsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { cookSheet } from "../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(cookSheetsGet, ({ rt, caller, params }) =>
  cookSheet(rt, caller, params.date),
);
