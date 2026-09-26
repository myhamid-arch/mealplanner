// GET /api/v1/members/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { membersGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { getMember } from "../../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(membersGet, ({ rt, caller, params }) => getMember(rt, caller, params.id));
