// GET /api/v1/presets: thin handlers over contract endpoints (lib/server/route.ts).
import { presetsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listPresets } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(presetsList, ({ rt, caller }) => listPresets(rt, caller));
