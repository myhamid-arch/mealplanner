// Stage 1 of the insights engine (FBK-7): every deterministic rule over one household's input.
import { aiIngredient } from "./ai-ingredient.js";
import { RuleContext } from "./context.js";
import { plateMisses, targetedQuantity } from "./distribution.js";
import { dishDislike, ingredientDislike, variantDislike } from "./dislikes.js";
import { moreOrLessOften, neverAgain, observedFrequency } from "./frequency.js";
import { recipeNotes, recipeRevisionProposals } from "./recipe-notes.js";
import { RECIPE_REVISION_OP } from "./config.js";
import type { InsightInput, ProposalDraft, RuleOutput } from "./types.js";

/** `member|dish` of a dish-level preference proposal. */
function memberDishKey(d: ProposalDraft): string {
  const p = d.ops[0]?.payload as { memberId?: unknown; entityKey?: unknown } | undefined;
  return `${String(p?.memberId)}|${String(p?.entityKey)}`;
}

export function runRules(input: InsightInput): RuleOutput {
  const ctx = new RuleContext(input);
  const never = neverAgain(ctx);
  const neverKeys = new Set(never.map(memberDishKey));
  const candidates = [
    ...never,
    ...plateMisses(ctx),
    ...variantDislike(ctx),
    // A "never again" for the same member and dish already says more than a dislike.
    ...dishDislike(ctx).filter((d) => !neverKeys.has(memberDishKey(d))),
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
