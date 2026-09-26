// GET /api/v1/platform/households: thin handlers over contract endpoints (lib/server/route.ts).
import { platformHouseholds } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { households } from "../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(platformHouseholds, ({ rt }) => households(rt));
