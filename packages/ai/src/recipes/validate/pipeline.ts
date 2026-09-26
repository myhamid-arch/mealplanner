// REC-5 steps 2–7 for each dish of a parsed batch, in order; the first failing step rejects the dish
// (leaf-1.3.1 ADR-2). Step 7 marks a dish infeasible but keeps it (SPEC-Q-6).
import { catalogContext, type AtwaterFactors } from "../catalogue.js";
import type { DishBatch, NewIngredient } from "../schema.js";
import { coreIngredientSlugs, checkDuplication } from "./duplication.js";
import { checkExclusions } from "./exclusions.js";
import { checkFeasibility, dishForSolve } from "./feasibility.js";
import { checkNutrition } from "./nutrition.js";
import { checkReferences } from "./references.js";
import type { DishOutcome, ExistingDish, Reason, ValidationEnv } from "./types.js";
import { checkVariants, type CategoryOf } from "./variants.js";

/**
 * Validates every dish of `batch`. `earlier` are dishes that already survived in this generation
 * (a first call's survivors during the follow-up); they count for duplication, as does every
 * dish of this batch that survives before the one being checked.
 */
export async function validateBatch(
  batch: DishBatch,
  env: ValidationEnv,
  earlier: readonly ExistingDish[] = [],
): Promise<DishOutcome[]> {
  const { catalogue } = env;
  const newBySlug = new Map<string, NewIngredient>();
  const declaredTwice = new Set<string>();
  for (const n of batch.newIngredients) {
    if (newBySlug.has(n.slug)) declaredTwice.add(n.slug);
    else newBySlug.set(n.slug, n);
  }
  const ctx = catalogContext(catalogue, [...newBySlug.values()]);
  const knownCategory = new Map(catalogue.ingredients.map((i) => [i.slug, i.category as string]));
  const categoryOf: CategoryOf = (slug) => knownCategory.get(slug) ?? newBySlug.get(slug)?.category;
  const factors = new Map<string, AtwaterFactors>();
  for (const i of catalogue.ingredients)
    if (i.atwaterFactors !== null) factors.set(i.slug, i.atwaterFactors);

  const survivors: ExistingDish[] = [...env.existingDishes, ...earlier];
  const outcomes: DishOutcome[] = [];
  for (const dish of batch.dishes) {
    const reject = (reasons: Reason[]) => outcomes.push({ status: "rejected", dish, reasons });
    const used = new Set(
      dish.components.flatMap((c) => c.variants.flatMap((v) => v.ingredients.map((l) => l.slug))),
    );

    const step2 = checkReferences(dish, catalogue, env.slotKeys, newBySlug);
    for (const slug of used)
      if (declaredTwice.has(slug))
        step2.push({
          step: 2,
          code: "bad_new_ingredient",
          message: `new ingredient "${slug}" is declared more than once`,
        });
    if (step2.length > 0) {
      reject(step2);
      continue;
    }
    const step3 = checkExclusions(dish, catalogue, env.exclusions, newBySlug);
    if (step3.length > 0) {
      reject(step3);
      continue;
    }
    const step4 = checkVariants(dish.components, categoryOf);
    if (step4.length > 0) {
      reject(step4);
      continue;
    }
    const usedNew = [...used].flatMap((slug) => {
      const n = newBySlug.get(slug);
      return n === undefined ? [] : [n];
    });
    const step5 = checkNutrition(dish, ctx, factors, usedNew);
    if (step5.reasons.length > 0) {
      reject(step5.reasons);
      continue;
    }
    const core = coreIngredientSlugs(dish.components, categoryOf);
    const step6 = checkDuplication(dish.name, core, survivors);
    if (step6.length > 0) {
      reject(step6);
      continue;
    }
    const solveDish = dishForSolve(dish, step5.nutrition, catalogue, newBySlug);
    const step7 = await checkFeasibility(solveDish, env.solveTargets, env.adjusters);
    const errors = step7.reasons.filter((r) => r.code === "solver_error");
    if (errors.length > 0) {
      reject(errors);
      continue;
    }
    survivors.push({ name: dish.name, coreIngredients: core });
    const accepted = {
      dish,
      newIngredients: usedNew,
      nutrition: step5.nutrition,
      coreIngredients: core,
      plates: step7.plates,
    };
    outcomes.push(
      step7.reasons.length > 0
        ? { status: "infeasible", reasons: step7.reasons, ...accepted }
        : { status: "candidate", ...accepted },
    );
  }
  return outcomes;
}
