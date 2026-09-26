// GET /api/v1/ingredients/{id}: thin handlers over contract endpoints (lib/server/route.ts).
import { ingredientsGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { getIngredient } from "../../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(ingredientsGet, ({ rt, caller, params }) =>
  getIngredient(rt, caller, params.id),
);
