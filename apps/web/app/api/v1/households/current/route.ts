// GET /api/v1/households/current: thin handlers over contract endpoints (lib/server/route.ts).
import { householdGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { householdDto } from "../../../../../lib/server/household";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(householdGet, ({ caller }) =>
  Promise.resolve(householdDto(caller.household)),
);
