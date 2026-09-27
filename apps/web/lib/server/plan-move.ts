// Move a meal to another day (UX-4 drag to move, W-5 addendum; BLD-8 R-58, R-60): the move service
// (`@mealplanner/db/services/plans` moveMeal) with its conflicts as 409 (a locked meal, a day sent
// to the kitchen, a meal already cooked, skipped or reviewed). Refusals by the planner stay 422 and
// an unknown meal 404 (route.ts maps PlanServiceError).
import { moveMeal as moveService, PlanMoveError } from "@mealplanner/db/services/plans";
import type { CallerContext } from "../auth/context";
import { mealDto } from "./plans";
import { conflict } from "./problem";
import type { Runtime } from "./runtime";

export async function moveMeal(
  rt: Runtime,
  caller: CallerContext,
  planMealId: string,
  toDate: string,
) {
  let moved;
  try {
    moved = await moveService(rt.db, caller.ctx, {
      planMealId,
      toDate,
      by: { actor: "user", source: "ui" },
    });
  } catch (error) {
    if (error instanceof PlanMoveError) throw conflict(`move_${error.code}`, error.message);
    throw error;
  }
  const meals = [];
  for (const m of moved.meals) meals.push(await mealDto(rt, caller, m.id));
  return { changeSetId: moved.changeSetId, meals };
}
