// Recipe generator: @mealplanner/ai/recipes (REC-1 … REC-6).
export {
  catalogContext,
  isIngredientCategory,
  newIngredientNutrients,
  type AtwaterFactors,
  type RecipeCatalogue,
  type RecipeIngredient,
} from "./catalogue.js";
export {
  ADULT_AGE,
  DEFAULT_DISH_COUNT,
  GenerationContextError,
  PREFERENCE_THRESHOLD,
  buildGenerationContext,
  scrubNames,
  type GenerationContext,
  type GenerationContextInput,
  type SolveTarget,
} from "./context.js";
export { RecipeGenerationError, type RecipeGenerationErrorCode } from "./errors.js";
export {
  generateRecipes,
  type AiGenerationRecord,
  type GenerationRun,
  type RecipeGeneratorDeps,
  type RecipeRequest,
  type Rejection,
  type SurvivingDish,
} from "./generate.js";
export {
  RECIPE_EFFORT,
  SYSTEM_PROMPT,
  buildFollowUpRequest,
  buildRecipeRequest,
  catalogueBlock,
  contextMessage,
  echoableContent,
  followUpMessage,
  systemBlocks,
  type RejectionNote,
} from "./prompt.js";
export {
  ComponentSchema,
  DishBatchSchema,
  DishSchema,
  NewIngredientSchema,
  VariantSchema,
  type DishBatch,
  type GeneratedComponent,
  type GeneratedDish,
  type GeneratedVariant,
  type NewIngredient,
} from "./schema.js";
export {
  coreIngredientSlugs,
  jaccard,
  trigramSimilarity,
  trigrams,
} from "./validate/duplication.js";
export { dishForSolve } from "./validate/feasibility.js";
export { ATWATER_TOLERANCE_PCT, variantAtwaterCheck, variantInput } from "./validate/nutrition.js";
export { validateBatch } from "./validate/pipeline.js";
export type {
  AcceptedDish,
  DefectCode,
  DishOutcome,
  ExistingDish,
  Reason,
  Step,
  ValidationEnv,
  VariantNutrition,
} from "./validate/types.js";
export { MIN_VARIANT_SHARE, coatingSlugs, variantShare } from "./validate/variants.js";
