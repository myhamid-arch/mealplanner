// GET /api/v1/frequency-rules: thin handlers over contract endpoints (lib/server/route.ts).
import { frequencyRulesList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listFrequencyRules } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(frequencyRulesList, ({ rt, caller }) => listFrequencyRules(rt, caller));
