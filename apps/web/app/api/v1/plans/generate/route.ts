// POST /api/v1/plans/generate: thin handlers over contract endpoints (lib/server/route.ts).
import { plansGenerate } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { generate } from "../../../../../lib/server/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(plansGenerate, ({ rt, caller, body }) => generate(rt, caller, body));
