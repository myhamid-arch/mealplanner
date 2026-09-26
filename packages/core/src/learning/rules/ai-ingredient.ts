// FBK-7 rule 5: an AI-estimated, unverified ingredient used in ≥ 3 planned meals → propose
// verifying its nutrition (SPEC-Q-16).
import { AI_ESTIMATE_SOURCE, AI_INGREDIENT_MIN_MEALS, PRIORITY } from "./config.js";
import type { RuleContext } from "./context.js";
import type { ProposalDraft } from "./types.js";

export function aiIngredient(ctx: RuleContext): ProposalDraft[] {
  const candidates = ctx.input.ingredients.filter(
    (i) => i.nutritionSource === AI_ESTIMATE_SOURCE && !i.verified && i.householdPrivate,
  );
  if (candidates.length === 0) return [];
  const upcoming = ctx.input.meals.filter(
    (m) => m.status === "planned" && m.date >= ctx.input.today,
  );
  const out: ProposalDraft[] = [];
  for (const ingredient of candidates) {
    const meals = upcoming.filter((meal) =>
      ctx.dishes
        .get(meal.dishId)
        ?.components.some((c) => c.variants.some((v) => v.ingredientIds.includes(ingredient.id))),
    );
    if (meals.length < AI_INGREDIENT_MIN_MEALS) continue;
    out.push({
      origin: "rule",
      rule: "ai_ingredient",
      title: `Verify the nutrition of ${ingredient.name}`,
      rationale: `${ingredient.name} has AI-estimated nutrition and is in ${meals.length.toString()} planned meals. Check it against a label or a trusted source and confirm it.`,
      ops: [{ kind: "ingredient.verify", payload: { ingredientId: ingredient.id } }],
      evidence: { reviewIds: [], count: meals.length, metrics: { plannedMeals: meals.length } },
      priority: PRIORITY.aiIngredient,
    });
  }
  return out;
}
