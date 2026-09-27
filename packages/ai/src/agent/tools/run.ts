// Runs the tool calls of one assistant message (AGT-2, AGT-4, AGT-5). Every input is validated with
// its Zod schema before anything runs (an invalid one is an `is_error` INVALID_JSON result; SPEC-Q-4);
// the calls of one message run concurrently and all results go back in one user message. Change
// ops go through the registry's schema and the change-set service only (AGT-6); a protected op sent
// through `apply_change` becomes a proposal because the server refused it (SPEC-Q-8).
import type {
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ChangeOpSchema } from "@mealplanner/core/changes";
import type { Card, Json } from "../cards.js";
import type { ChatSink } from "../stream.js";
import {
  ToolError,
  type AgentPorts,
  type ProposeInput,
  type ToolCall,
  type ToolOutput,
} from "../types.js";
import { toolLabel } from "./labels.js";
import { TOOL_SCHEMAS, isToolName, type ToolInput, type ToolName } from "./schemas.js";

type WireOp = ProposeInput["ops"][number];

/** Ops whose endpoints also revoke sessions or check operators (SPEC-Q-7). */
const DEDICATED_PREFIXES = ["access.", "support."] as const;

export interface ToolRun {
  result: BetaToolResultBlockParam;
  cards: Card[];
  ok: boolean;
  name: string;
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function okResult(id: string, forModel: Json): BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, content: JSON.stringify(forModel) };
}

export function errorResult(id: string, error: Json): BetaToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: id,
    is_error: true,
    content: JSON.stringify(error),
  };
}

/** AGT-2: the input failed its schema; the tool did not run. Built with JSON.stringify. */
export function invalidJsonResult(
  id: string,
  input: unknown,
  issues: Json,
): BetaToolResultBlockParam {
  return errorResult(id, { INVALID_JSON: JSON.stringify(input ?? null), issues });
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validates each op against the registry (AGT-6) and applies the agent-specific rules. */
async function checkOps(ops: readonly WireOp[], ports: AgentPorts): Promise<void> {
  for (const [index, op] of ops.entries()) {
    const dedicated = DEDICATED_PREFIXES.find((p) => op.kind.startsWith(p));
    if (dedicated !== undefined)
      throw new ToolError(
        `${op.kind} is not available to the assistant: use People & access in the app`,
        { index },
      );
    const parsed = ChangeOpSchema.safeParse(op);
    if (!parsed.success)
      throw new ToolError(`ops[${String(index)}] is not a valid ${op.kind} op`, {
        index,
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
          message: i.message,
        })),
      });
    const p = parsed.data;
    // As on POST /change-sets: the scheduler and follow-ups compute local dates from it.
    if (
      p.kind === "household.update" &&
      p.payload.timezone !== undefined &&
      !validTimeZone(p.payload.timezone)
    )
      throw new ToolError(
        `ops[${String(index)}]: "${p.payload.timezone}" is not an IANA time zone`,
        {
          index,
        },
      );
    // R-36: an ingredient exclusion's key is the ingredient slug.
    if (p.kind === "exclusion.add" && p.payload.kind === "ingredient") {
      const key = await ports.ingredientKey(p.payload.key);
      if (key.status === "id")
        throw new ToolError(
          `ops[${String(index)}]: an ingredient exclusion's key is the ingredient slug "${key.slug}", not its id`,
          { index, slug: key.slug },
        );
      if (key.status === "unknown")
        throw new ToolError(
          `ops[${String(index)}]: "${p.payload.key}" is not a catalogue ingredient slug`,
          { index },
        );
    }
  }
}

async function applyChange(
  input: ToolInput<"apply_change">,
  ports: AgentPorts,
  call: ToolCall,
): Promise<ToolOutput> {
  const ops = input.ops as WireOp[];
  await checkOps(ops, ports);
  const outcome = await ports.applyChange({ summary: input.summary, ops }, call);
  if (outcome.status === "applied")
    return {
      forModel: {
        status: "applied",
        changeSetId: outcome.changeSetId,
        changes: outcome.descriptions.map((d) => d.title),
      },
      cards: [
        {
          type: "applied_change",
          changeSetId: outcome.changeSetId,
          summary: input.summary,
          descriptions: outcome.descriptions,
          appliedAt: outcome.appliedAt,
        },
      ],
    };
  // AGT-5: the server refused to apply; the same ops become a proposal for the admin.
  const why =
    outcome.reason === "agent_may_apply_off"
      ? "The household setting lets the assistant propose changes only."
      : `This change needs your confirmation (protected: ${outcome.kinds.join(", ")}).`;
  const proposed = await ports.proposeChange(
    {
      title: input.summary,
      rationale: `You asked for this in chat. ${why}`,
      evidence: { requestedInChat: true },
      ops,
    },
    call,
  );
  if (proposed.status === "dropped")
    return {
      forModel: {
        status: "not_applied",
        reason: outcome.reason,
        protectedKinds: outcome.kinds,
        proposal: { status: "dropped", reason: proposed.reason },
      },
    };
  return {
    forModel: {
      status: "proposed",
      reason: outcome.reason,
      protectedKinds: outcome.kinds,
      proposalId: proposed.proposalId,
    },
    cards: [
      {
        type: "proposal",
        proposalId: proposed.proposalId,
        title: proposed.title,
        rationale: proposed.rationale,
        descriptions: proposed.descriptions,
        evidence: proposed.evidence,
        status: "pending",
      },
    ],
  };
}

async function proposeChange(
  input: ToolInput<"propose_change">,
  ports: AgentPorts,
  call: ToolCall,
): Promise<ToolOutput> {
  const ops = input.ops as WireOp[];
  await checkOps(ops, ports);
  const proposed = await ports.proposeChange(
    {
      title: input.title,
      rationale: input.rationale,
      evidence: asJson(input.evidence ?? {}),
      ops,
    },
    call,
  );
  if (proposed.status === "dropped")
    return { forModel: { status: "dropped", reason: proposed.reason } };
  return {
    forModel: { status: "proposed", proposalId: proposed.proposalId },
    cards: [
      {
        type: "proposal",
        proposalId: proposed.proposalId,
        title: proposed.title,
        rationale: proposed.rationale,
        descriptions: proposed.descriptions,
        evidence: proposed.evidence,
        status: "pending",
      },
    ],
  };
}

async function dispatch<N extends ToolName>(
  name: N,
  input: ToolInput<N>,
  ports: AgentPorts,
  call: ToolCall,
): Promise<ToolOutput> {
  // Each branch narrows `input` by the tool name.
  const i = input as never;
  switch (name) {
    case "get_household":
      return ports.getHousehold(i, call);
    case "get_plan":
      return ports.getPlan(i, call);
    case "explain_meal":
      return ports.explainMeal(i, call);
    case "search_dishes":
      return ports.searchDishes(i, call);
    case "get_dish":
      return ports.getDish(i, call);
    case "get_reviews":
      return ports.getReviews(i, call);
    case "get_preferences":
      return ports.getPreferences(i, call);
    case "get_proposals":
      return ports.getProposals(i, call);
    case "get_change_log":
      return ports.getChangeLog(i, call);
    case "generate_plan":
      return ports.generatePlan(i, call);
    case "suggest_alternatives":
      return ports.suggestAlternatives(i, call);
    case "create_recipe":
      return ports.createRecipe(i, call);
    case "run_insights":
      return ports.runInsights(i, call);
    case "apply_change":
      return applyChange(i, ports, call);
    case "propose_change":
      return proposeChange(i, ports, call);
    case "undo_change":
      return ports.undoChange(i, call);
  }
  throw new Error(`unhandled tool ${String(name)}`);
}

/** Runs one tool call. Never throws: every outcome is a tool_result (history stays valid). */
export async function runTool(
  block: BetaToolUseBlock,
  ports: AgentPorts,
  assistantMessageId: string,
  onUnexpected: (error: unknown, tool: string) => void,
): Promise<ToolRun> {
  const { id, name } = block;
  if (!isToolName(name))
    return {
      name,
      ok: false,
      cards: [],
      result: errorResult(id, { error: `unknown tool ${name}` }),
    };
  const parsed = TOOL_SCHEMAS[name].safeParse(block.input);
  if (!parsed.success)
    return {
      name,
      ok: false,
      cards: [],
      result: invalidJsonResult(
        id,
        block.input,
        parsed.error.issues.map((i) => ({
          path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
          message: i.message,
        })),
      ),
    };
  try {
    const out = await dispatch(name, parsed.data as ToolInput<typeof name>, ports, {
      toolUseId: id,
      assistantMessageId,
    });
    return { name, ok: true, cards: out.cards ?? [], result: okResult(id, out.forModel) };
  } catch (error) {
    if (error instanceof ToolError)
      return {
        name,
        ok: false,
        cards: [],
        result: errorResult(id, {
          error: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }),
      };
    onUnexpected(error, name);
    return {
      name,
      ok: false,
      cards: [],
      result: errorResult(id, { error: `${name} failed unexpectedly; nothing was changed by it` }),
    };
  }
}

/**
 * Runs every tool call of one assistant message concurrently; results keep the calls' order and
 * go back together in one user message (AGT-2).
 */
export async function runTools(
  blocks: readonly BetaToolUseBlock[],
  ports: AgentPorts,
  assistantMessageId: string,
  sink: ChatSink,
  onUnexpected: (error: unknown, tool: string) => void,
): Promise<ToolRun[]> {
  return Promise.all(
    blocks.map(async (block) => {
      const run = await runTool(block, ports, assistantMessageId, onUnexpected);
      sink({
        type: "tool_done",
        toolUseId: block.id,
        name: block.name,
        ok: run.ok,
        cards: run.cards,
      });
      return run;
    }),
  );
}

/** A result for a call that was not run (refusal, max_tokens, the iteration cap; SPEC-Q-5/6). */
export function notRunResult(block: BetaToolUseBlock, why: string): BetaToolResultBlockParam {
  return errorResult(block.id, { error: `not run: ${why}` });
}

export { toolLabel };
