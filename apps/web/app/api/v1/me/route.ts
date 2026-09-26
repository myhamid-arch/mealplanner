// GET /api/v1/me: thin handlers over contract endpoints (lib/server/route.ts).
import { me } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { meView } from "../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(me, ({ rt, session }) => meView(rt, session));
