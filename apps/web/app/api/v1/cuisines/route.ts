// GET /api/v1/cuisines: thin handlers over contract endpoints (lib/server/route.ts).
import { cuisinesList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listCuisines } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(cuisinesList, ({ rt }) => listCuisines(rt));
