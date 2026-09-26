// GET, POST /api/v1/change-sets: thin handlers over contract endpoints (lib/server/route.ts).
import { changeSetsApply, changeSetsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { applyOps, changeLog } from "../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(changeSetsList, ({ rt, caller, query }) =>
  changeLog(rt, caller.ctx, query),
);
export const POST = route(changeSetsApply, ({ rt, caller, body }) => applyOps(rt, caller, body));
