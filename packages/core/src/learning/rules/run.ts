// Stage 1 of the insights engine (FBK-7): every deterministic rule over one household's input.
import { aiIngredient } from "./ai-ingredient.js";
import { RuleContext } from "./context.js";
import { plateMisses, targetedQuantity } from "./distribution.js";
import { dishDislike, ingredientDislike, variantDislike } from "./dislikes.js";
import { moreOrLessOften, neverAgain, observedFrequency } from "./frequency.js";
import { recipeNotes, recipeRevisionProposals } from "./recipe-notes.js";
import { RECIPE_REVISION_OP } from "./config.js";
import type { InsightInput, RuleOutput } from "./types.js";

export function runRules(input: InsightInput): RuleOutput {
  const ctx = new RuleContext(input);
  const candidates = [
    ...neverAgain(ctx),
    ...plateMisses(ctx),
    ...variantDislike(ctx),
    ...dishDislike(ctx),
    ...moreOrLessOften(ctx),
    ...observedFrequency(ctx),
    ...ingredientDislike(ctx),
    ...aiIngredient(ctx),
    ...targetedQuantity(ctx),
    ...recipeRevisionProposals(ctx, RECIPE_REVISION_OP),
  ];
  const notes = RECIPE_REVISION_OP === null ? recipeNotes(ctx) : [];
  return { candidates, notes };
}
