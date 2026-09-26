// GET /api/v1/change-sets/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { changeSetsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { changeSetOne } from "../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(changeSetsGet, ({ rt, caller, params }) =>
  changeSetOne(rt, caller, params.id),
);
