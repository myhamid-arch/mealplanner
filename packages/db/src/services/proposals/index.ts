// @mealplanner/db/services/proposals: the insights run (FBK-7), proposal storage through the
// FBK-8 guardrails, and accept/reject (FBK-9). Synthesis is injected (R-2; leaf-1.3.3 ADR-1).
export {
  runInsights,
  insightsDue,
  SYNTHESIS_NOT_WIRED,
  type InsightDigest,
  type RunInsightsOptions,
} from "./insights.js";
export {
  createProposals,
  expireProposals,
  listProposals,
  type CreateProposalsOptions,
  type CreateProposalsResult,
  type ProposalRow,
} from "./store.js";
export {
  acceptProposal,
  rejectProposal,
  MAX_DECISION_NOTE_LENGTH,
  type AcceptResult,
  type DecisionOptions,
} from "./decide.js";
export { loadInsightInput, localDate, type LoadedInsightInput } from "./load.js";
export * from "./errors.js";
