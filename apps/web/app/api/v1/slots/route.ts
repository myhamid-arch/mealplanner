// GET /api/v1/slots: thin handlers over contract endpoints (lib/server/route.ts).
import { slotsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listSlots } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(slotsList, ({ rt, caller }) => listSlots(rt, caller));
