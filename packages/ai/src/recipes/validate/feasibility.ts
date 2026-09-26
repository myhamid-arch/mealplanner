// REC-5 step 7: solver feasibility for every targeted attendee (leaf-1.3.1 ADR-2, SPEC-Q-6/7/11).
import {
  SolverError,
  loadPortionSolver,
  solvePlate,
  type DishForSolve,
  type MacroKey,
} from "@mealplanner/core/planner/solver";
import { isIngredientCategory, type RecipeCatalogue } from "../catalogue.js";
import type { SolveTarget } from "../context.js";
import type { GeneratedDish, NewIngredient } from "../schema.js";
import type { Reason, VariantNutrition } from "./types.js";

/** `component.step_g` default (02 §4; SPEC-Q-11). */
export const GENERATED_STEP_G = 5;

const MACROS: readonly MacroKey[] = ["kcal", "protein", "carbs", "fat"];

/** The solver's view of a validated dish. Ids are positional: `c<i>` and `c<i>v<j>`. */
export function dishForSolve(
  dish: GeneratedDish,
  nutrition: readonly VariantNutrition[][],
  catalogue: RecipeCatalogue,
  newIngredients: ReadonlyMap<string, NewIngredient>,
): DishForSolve {
  const bySlug = new Map(catalogue.ingredients.map((i) => [i.slug, i]));
  return {
    id: dish.name,
    isPackable: dish.isPackable,
    servedColdOk: dish.servedColdOk,
    components: dish.components.map((c, ci) => ({
      id: `c${String(ci)}`,
      role: c.role,
      portioning: c.portioning,
      minServingG: c.minServingG,
      maxServingG: c.maxServingG,
      defaultServingG: c.defaultServingG,
      stepG: GENERATED_STEP_G,
      // REC-4 has no unit weight: one unit is the default serving (SPEC-Q-7).
      unitWeightG: c.portioning === "unit" ? c.defaultServingG : null,
      required: c.required,
      variants: c.variants.map((v, vi) => {
        const n = nutrition[ci]?.[vi];
        if (n === undefined) throw new Error(`no nutrition for c${String(ci)}v${String(vi)}`);
        return {
          id: `c${String(ci)}v${String(vi)}`,
          isDefault: v.isDefault,
          per100g: n.per100g,
          ingredients: v.ingredients.map((line) => {
            const known = bySlug.get(line.slug);
            const category = known?.category ?? newIngredients.get(line.slug)?.category;
            return {
              id: line.slug,
              // Step 2 has rejected any slug without a valid category before this runs.
              category:
                category !== undefined && isIngredientCategory(category) ? category : "other",
              dietaryFlags: known?.dietaryFlags ?? [],
            };
          }),
        };
      }),
    })),
  };
}

function missSummary(deviation: Record<MacroKey, number>, target: SolveTarget["target"]): string {
  const parts = MACROS.filter((m) => Math.abs(deviation[m]) > target.tol[m]).map((m) => {
    const unit = m === "kcal" ? " kcal" : " g";
    const sign = deviation[m] > 0 ? "+" : "";
    return `${m} ${sign}${deviation[m].toFixed(0)}${unit} (tolerance ±${String(target.tol[m])})`;
  });
  return parts.length > 0 ? parts.join(", ") : "saturated-fat cap exceeded";
}

export async function checkFeasibility(
  solveDish: DishForSolve,
  solveTargets: readonly SolveTarget[],
  adjusters: readonly DishForSolve[],
): Promise<{
  reasons: Reason[];
  plates: Array<{ label: string; status: string; explain: string[] }>;
}> {
  const reasons: Reason[] = [];
  const plates: Array<{ label: string; status: string; explain: string[] }> = [];
  if (solveTargets.length === 0) return { reasons, plates };
  await loadPortionSolver();
  for (const t of solveTargets) {
    try {
      const plate = solvePlate({
        dish: solveDish,
        target: t.target,
        member: t.member,
        adjusters: [...adjusters],
      });
      plates.push({ label: t.label, status: plate.status, explain: plate.explain });
      if (plate.status === "infeasible")
        reasons.push({
          step: 7,
          code: "infeasible",
          message: `no plate for ${t.label} reaches the ${String(t.target.kcal)} kcal / ${String(t.target.protein)} P / ${String(t.target.carbs)} C / ${String(t.target.fat)} F target within tolerance; the closest misses by ${missSummary(plate.deviation, t.target)}`,
        });
    } catch (error) {
      // A bad dish is a rejection; a solver that cannot run is not the dish's fault.
      if (!(error instanceof SolverError) || error.code !== "invalid_input") throw error;
      plates.push({ label: t.label, status: "error", explain: [error.message] });
      reasons.push({ step: 7, code: "solver_error", message: `${t.label}: ${error.message}` });
    }
  }
  return { reasons, plates };
}
