// GET /api/v1/dishes: thin handlers over contract endpoints (lib/server/route.ts).
import { dishesList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listDishes } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(dishesList, ({ rt, caller, query }) => listDishes(rt, caller, query));
