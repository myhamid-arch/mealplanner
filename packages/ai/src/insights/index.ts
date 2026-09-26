// @mealplanner/ai/insights: FBK-7 stage 2, LLM synthesis of insight proposals (leaf-1.3.3 ADR-2).
// The db service receives `synthesizeInsights` by dependency injection (R-2), wired in apps/*.
export {
  INSIGHTS_DISABLED_REASON,
  resolveInsightsModel,
  synthesizeInsights,
  type InsightsGenerationRecord,
  type SynthesisDeps,
} from "./synthesize.js";
export {
  INSIGHTS_EFFORT,
  INSIGHT_KINDS,
  SYSTEM_PROMPT,
  buildSynthesisRequest,
  kindsBlock,
  systemBlocks,
} from "./prompt.js";
export {
  SynthesisOutputSchema,
  WireOpSchema,
  WireProposalSchema,
  type SynthesisOutput,
  type WireProposal,
} from "./schema.js";
export {
  evidenceIds,
  knownIds,
  mapMemberIds,
  pseudonyms,
  synthesisContext,
  type Pseudonyms,
  type SynthesisContext,
} from "./context.js";
export { validateProposals, type ValidationEnv } from "./validate.js";
