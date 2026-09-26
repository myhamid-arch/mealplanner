// GET /api/v1/households/current/export/{table}: thin handlers over contract endpoints (lib/server/route.ts).
import { householdExportCsv } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../lib/server/route";
import { exportCsv } from "../../../../../../../lib/server/household";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(householdExportCsv, ({ rt, caller, params }) =>
  exportCsv(rt, caller, params.table),
);
