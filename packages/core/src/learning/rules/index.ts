// @mealplanner/core/learning/rules: the insights engine's deterministic stage and guardrails
// (FBK-5 targeted, FBK-6, FBK-7, FBK-8; leaf-1.3.3 ADR-1). Pure; packages/db does the I/O.
export * from "./config.js";
export * from "./types.js";
export { RuleContext, addDays } from "./context.js";
export {
  variantDislike,
  dishDislike,
  ingredientDislike,
  isNegativeComponentReview,
} from "./dislikes.js";
export {
  recipeNotes,
  recipeNoteFindings,
  recipeRevisionProposals,
  type RecipeNoteFinding,
} from "./recipe-notes.js";
export { aiIngredient } from "./ai-ingredient.js";
export { moreOrLessOften, neverAgain, observedFrequency } from "./frequency.js";
export {
  plateMisses,
  targetedQuantity,
  shiftShare,
  type ShareShift,
  type ShiftDirection,
} from "./distribution.js";
export { opFingerprint, fingerprintOf } from "./fingerprint.js";
export { isSatisfied, type SatisfactionState } from "./satisfied.js";
export {
  selectProposals,
  proposalExpiry,
  isExpired,
  isEngineOrigin,
  DROP_REASONS,
  type DropReason,
  type CheckedDraft,
  type DroppedDraft,
  type ExistingProposal,
  type GuardrailInput,
  type GuardrailResult,
} from "./guardrails.js";
export { runRules } from "./run.js";
