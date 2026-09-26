// POST /api/v1/preferences/reset: thin handlers over contract endpoints (lib/server/route.ts).
import { preferencesReset } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { resetPreference } from "../../../../../lib/server/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(preferencesReset, ({ rt, caller, body }) =>
  resetPreference(rt, caller, body),
);
