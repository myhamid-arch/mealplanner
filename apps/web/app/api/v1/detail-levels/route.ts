// GET, PUT /api/v1/detail-levels (R2-DL-1; BLD-8 R-47): thin handlers over contract endpoints.
import { detailLevelsList, detailLevelsSet } from "@mealplanner/api-contract/contract";
import { listDetailLevels, setDetailLevel } from "../../../../lib/server/detail-levels";
import { route } from "../../../../lib/server/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(detailLevelsList, ({ rt, caller }) => listDetailLevels(rt, caller));
export const PUT = route(detailLevelsSet, ({ rt, caller, body }) =>
  setDetailLevel(rt, caller, body),
);
