// GET /api/v1/diagnostics: thin handlers over contract endpoints (lib/server/route.ts).
import { diagnosticsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { diagnostics } from "../../../../lib/server/changes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(diagnosticsGet, ({ rt, caller }) => diagnostics(rt, caller));
