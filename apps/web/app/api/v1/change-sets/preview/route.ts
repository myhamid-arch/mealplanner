// POST /api/v1/change-sets/preview: thin handlers over contract endpoints (lib/server/route.ts).
import { changeSetsPreview } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { previewOps } from "../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(changeSetsPreview, ({ rt, caller, body }) =>
  previewOps(rt, caller, body.ops),
);
