// The agent's ports (R-2: database services reach `ai` by dependency injection, wired in apps/web;
// SPEC-Q-1) and the stored-message shapes (AGT-8; SPEC-Q-3).
import type { ChangeDescription } from "@mealplanner/core/changes";
import type { ChatRole } from "@mealplanner/core/types";
import type { Card, Json } from "./cards.js";
import type { ToolInput } from "./tools/schemas.js";

export type { Json };

/** A tool's result: what the model reads (serialised as JSON text) and the UI's cards. */
export interface ToolOutput {
  forModel: Json;
  cards?: Card[];
}

/** A refusal the admin should see (not found, invalid op, over a limit): an `is_error` result. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly details?: Json,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/** Which tool call a port runs for (proposals link to the assistant message; 02 §7). */
export interface ToolCall {
  toolUseId: string;
  assistantMessageId: string;
}

export type ApplyOutcome =
  | {
      status: "applied";
      changeSetId: string;
      appliedAt: string;
      descriptions: ChangeDescription[];
    }
  /** AGT-5, decided by the change-set service (`ProtectedOperationError`); nothing was written. */
  | { status: "refused"; reason: "protected" | "agent_may_apply_off"; kinds: string[] };

export type ProposeOutcome =
  | {
      status: "stored";
      proposalId: string;
      title: string;
      rationale: string;
      descriptions: ChangeDescription[];
      evidence: Json;
    }
  /** FBK-8 guardrails dropped it (duplicate pending, recent rejection, already satisfied …). */
  | { status: "dropped"; reason: string };

export interface ProposeInput {
  title: string;
  rationale: string;
  evidence: Json;
  ops: { kind: string; payload: Record<string, unknown> }[];
}

export type IngredientKey =
  | { status: "slug"; slug: string }
  /** The key is an ingredient id; the slug to use instead (R-36). */
  | { status: "id"; slug: string }
  | { status: "unknown" };

/** One function per AGT-4 tool, household-scoped by the server session. */
export interface AgentPorts {
  getHousehold(input: ToolInput<"get_household">, call: ToolCall): Promise<ToolOutput>;
  getPlan(input: ToolInput<"get_plan">, call: ToolCall): Promise<ToolOutput>;
  explainMeal(input: ToolInput<"explain_meal">, call: ToolCall): Promise<ToolOutput>;
  searchDishes(input: ToolInput<"search_dishes">, call: ToolCall): Promise<ToolOutput>;
  getDish(input: ToolInput<"get_dish">, call: ToolCall): Promise<ToolOutput>;
  getReviews(input: ToolInput<"get_reviews">, call: ToolCall): Promise<ToolOutput>;
  getPreferences(input: ToolInput<"get_preferences">, call: ToolCall): Promise<ToolOutput>;
  getProposals(input: ToolInput<"get_proposals">, call: ToolCall): Promise<ToolOutput>;
  getChangeLog(input: ToolInput<"get_change_log">, call: ToolCall): Promise<ToolOutput>;
  generatePlan(input: ToolInput<"generate_plan">, call: ToolCall): Promise<ToolOutput>;
  suggestAlternatives(
    input: ToolInput<"suggest_alternatives">,
    call: ToolCall,
  ): Promise<ToolOutput>;
  createRecipe(input: ToolInput<"create_recipe">, call: ToolCall): Promise<ToolOutput>;
  runInsights(input: ToolInput<"run_insights">, call: ToolCall): Promise<ToolOutput>;
  undoChange(input: ToolInput<"undo_change">, call: ToolCall): Promise<ToolOutput>;
  /** `applyChangeSet` with `source: agent_apply` (AGT-5 enforced there). */
  applyChange(
    input: { summary: string; ops: ProposeInput["ops"] },
    call: ToolCall,
  ): Promise<ApplyOutcome>;
  /** `createProposals` with origin `agent_chat` (FBK-8 guardrails, budget-exempt; R-33). */
  proposeChange(input: ProposeInput, call: ToolCall): Promise<ProposeOutcome>;
  /** Resolves an ingredient exclusion key against the catalogue (R-36). */
  ingredientKey(key: string): Promise<IngredientKey>;
}

/** A `chat_message` row as the loop sees it (AGT-8). */
export interface StoredMessage {
  id: string;
  role: ChatRole;
  /** Exactly as stored (and as read back): the source of every replayed request (SPEC-Q-3). */
  content: Json;
  createdAt: string;
}

/** Appends one row and returns it as stored (read back from the database). */
export interface ChatStore {
  append(role: ChatRole, content: Json): Promise<StoredMessage>;
}

/** One `ai_generation` row per model call (DM-7; SPEC-Q-13). */
export interface ChatCallRecord {
  purpose: "chat";
  model: string;
  requestSummary: Json;
  responseRaw: Json;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  validationErrors: Json | null;
}
