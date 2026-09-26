// POST /api/v1/change-sets/{id}/undo: thin handlers over contract endpoints (lib/server/route.ts).
import { changeSetsUndo } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { undo } from "../../../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(changeSetsUndo, ({ rt, caller, params }) => undo(rt, caller, params.id));
