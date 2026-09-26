// Claude client: @mealplanner/ai/client (REC-2).
export { DEFAULT_MODEL, FALLBACK_BETA, resolveClaudeConfig, type ClaudeConfig } from "./config.js";
export {
  ClaudeCallError,
  fromSdkError,
  type ClaudeCallErrorCode,
  type ClaudeUsage,
  type RefusalDetails,
} from "./errors.js";
export {
  MAX_OUTPUT_TOKENS,
  createClaudeClient,
  structuredParams,
  type Effort,
  type StructuredModel,
  type StructuredRequest,
  type StructuredResult,
} from "./structured.js";
