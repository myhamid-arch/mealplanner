// @mealplanner/ai/reviews: `reviews.extract` (ARC-7; R-40, R-46). The worker job wires the database.
export {
  EXTRACTION_DISABLED_REASON,
  EXTRACTION_EFFORT,
  ExtractionOutputSchema,
  SYSTEM_PROMPT,
  extractReviewTags,
  extractionRequest,
  newTags,
  scrubNames,
  systemBlocks,
  type ExtractionDeps,
  type ExtractionGenerationRecord,
  type ExtractionInput,
  type ExtractionOutput,
  type ExtractionResult,
} from "./extract.js";
export { OPPOSITES, REVIEW_TAGS, TAG_GROUPS } from "./vocabulary.js";
