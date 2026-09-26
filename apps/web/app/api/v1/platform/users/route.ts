// GET /api/v1/platform/users: thin handlers over contract endpoints (lib/server/route.ts).
import { platformUsers } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { users } from "../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(platformUsers, ({ rt, query }) => users(rt, query.q));
