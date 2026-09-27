// POST /api/v1/onboarding/parse (R2-ONB-3; BLD-8 R-55): thin handler over the contract endpoint.
import { onboardingParse } from "@mealplanner/api-contract/contract";
import { parseOnboarding } from "../../../../../lib/server/onboarding-parse";
import { route } from "../../../../../lib/server/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(onboardingParse, ({ rt, caller, body }) =>
  parseOnboarding(rt, caller, body),
);
