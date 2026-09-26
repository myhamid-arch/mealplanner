// GET /api/v1/platform/ai-usage: thin handlers over contract endpoints (lib/server/route.ts).
import { platformAiUsage } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { aiUsage } from "../../../../../lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(platformAiUsage, ({ rt, query }) => aiUsage(rt, query.days));
