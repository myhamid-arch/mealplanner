// GET /api/v1/ingredients: thin handlers over contract endpoints (lib/server/route.ts).
import { ingredientsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listIngredients } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(ingredientsList, ({ rt, caller, query }) =>
  listIngredients(rt, caller, query),
);
