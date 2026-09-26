// GET /api/v1/households/current/export: thin handlers over contract endpoints (lib/server/route.ts).
import { householdExport } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { exportJson } from "../../../../../../lib/server/household";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(householdExport, ({ rt, caller }) => exportJson(rt, caller));
