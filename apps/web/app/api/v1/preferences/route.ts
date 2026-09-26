// GET, PUT /api/v1/preferences: thin handlers over contract endpoints (lib/server/route.ts).
import { preferencesList, preferencesSet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listPreferences } from "../../../../lib/server/reads";
import { setPreference } from "../../../../lib/server/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(preferencesList, ({ rt, caller, query }) =>
  listPreferences(rt, caller, query.memberId),
);
export const PUT = route(preferencesSet, ({ rt, caller, body }) => setPreference(rt, caller, body));
