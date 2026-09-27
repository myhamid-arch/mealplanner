// @mealplanner/ai/agent: the admin agent (07; AGT-2 … AGT-8). Database services reach it through
// `AgentPorts` and `ChatStore`, wired in apps/web (R-2; SPEC-Q-1).
export {
  AGENT_EFFORTS,
  AGENT_MAX_TOKENS,
  COMPACTION_BETA,
  COMPACTION_EDIT,
  DEFAULT_AGENT_EFFORT,
  JSON_REISSUE_LIMIT,
  MAX_MODEL_CALLS,
  agentEffort,
} from "./config.js";
export {
  AgentAbortedError,
  ToolJsonError,
  agentParams,
  classifyStreamError,
  createAgentModel,
  type AgentModel,
  type AgentRequest,
  type AgentStreamEvent,
} from "./model.js";
export { CARD_TYPES, cardJson, type Card, type CardType } from "./cards.js";
export {
  displayText,
  eventRowContent,
  messageOf,
  replay,
  toolRowContent,
  userContent,
  type EventRowContent,
  type ToolRowContent,
} from "./history.js";
export {
  SYSTEM_PROMPT,
  householdDigest,
  opReference,
  screenContextText,
  systemBlocks,
  type DigestSnapshot,
} from "./prompt.js";
export { requestPrefix, runAgentTurn, type TurnArgs, type TurnOutcome } from "./loop.js";
export {
  digestHasNews,
  insightDigestEvent,
  jobCompletionEvent,
  type InsightDigestLike,
  type JobLike,
} from "./events.js";
export type { ChatSink, ChatStreamEvent, TurnStopReason } from "./stream.js";
export {
  MAX_PLAN_RANGE_DAYS,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  WireChangeOp,
  isToolName,
  toolDefinitions,
  type ToolInput,
  type ToolName,
} from "./tools/schemas.js";
export { TOOL_LABELS, toolLabel } from "./tools/labels.js";
export { errorResult, invalidJsonResult, notRunResult, runTool, runTools } from "./tools/run.js";
export {
  ToolError,
  type AgentPorts,
  type ApplyOutcome,
  type ChatCallRecord,
  type ChatStore,
  type IngredientKey,
  type Json,
  type ProposeInput,
  type ProposeOutcome,
  type StoredMessage,
  type ToolCall,
  type ToolOutput,
} from "./types.js";
