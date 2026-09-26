// GET /api/v1/members: thin handlers over contract endpoints (lib/server/route.ts).
import { membersList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listMembers } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(membersList, ({ rt, caller }) => listMembers(rt, caller));
