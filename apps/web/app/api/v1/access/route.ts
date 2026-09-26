// GET /api/v1/access: thin handlers over contract endpoints (lib/server/route.ts).
import { accessList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listAccess } from "../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(accessList, ({ rt, caller }) => listAccess(rt, caller));
