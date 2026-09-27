// Test doubles for the agent loop (leaf 1.3.5 G1–G3): a scripted stub model that records every
// request, an in-memory chat store that stores content the way PostgreSQL jsonb does (keys
// re-ordered), and ports that record their calls.
import type {
  BetaContentBlock,
  BetaMessage,
  BetaStopReason,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Effort } from "../../src/client/index.js";
import type {
  AgentModel,
  AgentRequest,
  AgentStreamEvent,
  AgentPorts,
  ChatCallRecord,
  ChatStore,
  ChatStreamEvent,
  Json,
  StoredMessage,
  ToolOutput,
} from "../../src/agent/index.js";
import { AgentAbortedError } from "../../src/agent/index.js";

export const MODEL = "claude-test-model";

let seq = 0;
export function toolUse(name: string, input: unknown, id?: string): BetaToolUseBlock {
  seq += 1;
  return {
    type: "tool_use",
    id: id ?? `toolu_${String(seq).padStart(4, "0")}`,
    name,
    input,
  };
}

export function text(t: string): BetaContentBlock {
  return { type: "text", text: t, citations: null };
}

export function thinking(): BetaContentBlock {
  return { type: "thinking", thinking: "", signature: "sig-abc" };
}

export function message(
  content: BetaContentBlock[],
  stop: BetaStopReason,
  extra: Partial<BetaMessage> = {},
): BetaMessage {
  seq += 1;
  return {
    id: `msg_${String(seq)}`,
    type: "message",
    role: "assistant",
    model: MODEL,
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 0,
    },
    ...extra,
  } as unknown as BetaMessage;
}

/** One scripted step: a response, an error to throw, or a function of the request. */
export type Step = BetaMessage | Error | ((request: AgentRequest) => BetaMessage | Error);

/** Stream events a real stream would emit for a message (starts and text deltas). */
function eventsOf(m: BetaMessage): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  m.content.forEach((block, index) => {
    events.push({
      type: "content_block_start",
      index,
      content_block: block.type === "text" ? { ...block, text: "" } : block,
    });
    if (block.type === "text")
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    events.push({ type: "content_block_stop", index });
  });
  return events;
}

export class ScriptedModel implements AgentModel {
  readonly model = MODEL;
  readonly effort: Effort = "high";
  /** Every request, serialised exactly as it would go on the wire. */
  readonly wire: string[] = [];
  readonly requests: AgentRequest[] = [];
  #steps: Step[];
  #fallback: Step | null;

  constructor(steps: Step[], fallback: Step | null = null) {
    this.#steps = [...steps];
    this.#fallback = fallback;
  }

  get calls(): number {
    return this.requests.length;
  }

  async stream(
    request: AgentRequest,
    onEvent: (event: AgentStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<BetaMessage> {
    this.requests.push(request);
    this.wire.push(JSON.stringify(request.messages));
    const step = this.#steps.shift() ?? this.#fallback;
    if (step === null) throw new Error("the scripted model ran out of steps");
    const out = typeof step === "function" ? step(request) : step;
    if (out instanceof Error) throw out;
    for (const e of eventsOf(out)) {
      if (signal.aborted) throw new AgentAbortedError();
      onEvent(e);
      await Promise.resolve();
    }
    if (signal.aborted) throw new AgentAbortedError();
    return out;
  }
}

/** Serialises like jsonb: object keys by length, then bytewise (PostgreSQL's order). */
export function jsonbOrder(value: unknown): Json {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort(
      (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
    );
    const out: Record<string, Json> = {};
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = jsonbOrder(v);
    }
    return out;
  }
  return value as Json;
}

export class MemoryStore implements ChatStore {
  readonly rows: StoredMessage[] = [];
  #t = Date.parse("2026-09-26T10:00:00Z");

  async append(role: StoredMessage["role"], content: Json): Promise<StoredMessage> {
    await Promise.resolve();
    this.#t += 1;
    const row: StoredMessage = {
      id: `row-${String(this.rows.length + 1)}`,
      role,
      content: jsonbOrder(content),
      createdAt: new Date(this.#t).toISOString(),
    };
    this.rows.push(row);
    return row;
  }
}

export type PortCall = { port: string; input: unknown };

/** Ports that record calls; each can be overridden. */
export function recordingPorts(
  overrides: Partial<AgentPorts> = {},
): AgentPorts & { calls: PortCall[] } {
  const calls: PortCall[] = [];
  const rec =
    (port: string) =>
    async (input: unknown): Promise<ToolOutput> => {
      calls.push({ port, input });
      await Promise.resolve();
      return { forModel: { port, input: input as Json } };
    };
  const base: AgentPorts = {
    getHousehold: rec("getHousehold"),
    getPlan: rec("getPlan"),
    explainMeal: rec("explainMeal"),
    searchDishes: rec("searchDishes"),
    getDish: rec("getDish"),
    getReviews: rec("getReviews"),
    getPreferences: rec("getPreferences"),
    getProposals: rec("getProposals"),
    getChangeLog: rec("getChangeLog"),
    generatePlan: rec("generatePlan"),
    suggestAlternatives: rec("suggestAlternatives"),
    createRecipe: rec("createRecipe"),
    runInsights: rec("runInsights"),
    undoChange: rec("undoChange"),
    applyChange: (input) => {
      calls.push({ port: "applyChange", input });
      return Promise.resolve({
        status: "applied",
        changeSetId: "cs-1",
        appliedAt: "2026-09-26T10:00:00.000Z",
        descriptions: [],
      });
    },
    proposeChange: (input) => {
      calls.push({ port: "proposeChange", input });
      return Promise.resolve({
        status: "stored",
        proposalId: "p-1",
        title: input.title,
        rationale: input.rationale,
        descriptions: [],
        evidence: input.evidence,
      });
    },
    ingredientKey: (key) => Promise.resolve({ status: "slug", slug: key }),
  };
  const ports = { ...base, ...overrides, calls };
  return ports;
}

export function collectingSink() {
  const events: ChatStreamEvent[] = [];
  return { events, sink: (e: ChatStreamEvent) => events.push(e) };
}

export function recordingCalls() {
  const records: ChatCallRecord[] = [];
  return {
    records,
    recordCall: (r: ChatCallRecord) => {
      records.push(r);
      return Promise.resolve();
    },
  };
}

export const DIGEST = "Household digest (test): 2 members";
