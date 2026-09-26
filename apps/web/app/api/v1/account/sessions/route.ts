// GET /api/v1/account/sessions: thin handlers over contract endpoints (lib/server/route.ts).
import { accountSessions } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { listSessions } from "../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(accountSessions, ({ rt, session }) => listSessions(rt, session));
