// G1 (AGT-2): the loop with a scripted stub model. Parallel tool calls return in one user message,
// invalid tool JSON returns is_error, refusal / max_tokens / pause_turn are handled, and the
// iteration cap is enforced. Each check has a negative control on a known-bad transcript.
import Anthropic, { AnthropicError, APIError } from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { ClaudeCallError } from "../../src/client/index.js";
import {
  AgentAbortedError,
  MAX_MODEL_CALLS,
  ToolJsonError,
  classifyStreamError,
  createAgentModel,
  replay,
  runAgentTurn,
  type AgentPorts,
  type TurnArgs,
} from "../../src/agent/index.js";
import { assertAppendOnly, assertResultsInOneMessage } from "./assertions.js";
import {
  DIGEST,
  MemoryStore,
  ScriptedModel,
  collectingSink,
  message,
  recordingCalls,
  recordingPorts,
  text,
  thinking,
  toolUse,
  type Step,
} from "./support.js";

const PLAN = { from: "2026-09-28", to: "2026-09-29" };

async function turn(
  steps: Step[],
  opts: { ports?: AgentPorts; fallback?: Step; signal?: AbortSignal } = {},
) {
  const model = new ScriptedModel(steps, opts.fallback ?? null);
  const store = new MemoryStore();
  const ports = opts.ports ?? recordingPorts();
  const { events, sink } = collectingSink();
  const { records, recordCall } = recordingCalls();
  const args: TurnArgs = {
    model,
    ports,
    store,
    history: [],
    text: "Plan next week",
    screen: null,
    digest: DIGEST,
    sink,
    signal: opts.signal ?? new AbortController().signal,
    recordCall,
  };
  const outcome = await runAgentTurn(args);
  return { outcome, model, store, ports, events, records };
}

function toolResults(m: BetaMessageParam | undefined) {
  if (m === undefined || typeof m.content === "string") return [];
  return m.content.filter((b) => b.type === "tool_result") as {
    tool_use_id: string;
    is_error?: boolean;
    content: string;
  }[];
}

describe("G1 parallel tool calls", () => {
  it("G1 parallel tool calls run concurrently and all results return in one user message", async () => {
    // Each port waits until all three have started: only concurrent execution completes.
    let started = 0;
    let release!: () => void;
    const allStarted = new Promise<void>((r) => (release = r));
    const gate = async (port: string) => {
      started += 1;
      if (started === 3) release();
      await Promise.race([
        allStarted,
        new Promise((_, rej) =>
          setTimeout(() => {
            rej(new Error(`${port} ran alone`));
          }, 2000),
        ),
      ]);
      return { forModel: { port } };
    };
    const ports = recordingPorts({
      getPlan: () => gate("getPlan"),
      getHousehold: () => gate("getHousehold"),
      searchDishes: () => gate("searchDishes"),
    });
    const calls = [
      toolUse("get_plan", PLAN),
      toolUse("get_household", {}),
      toolUse("search_dishes", { query: "fish" }),
    ];
    const { outcome, model, store, events } = await turn(
      [
        message([thinking(), text("Let me look."), ...calls], "tool_use"),
        message([text("Done.")], "end_turn"),
      ],
      { ports },
    );
    expect(outcome.stopReason).toBe("end_turn");
    expect(model.calls).toBe(2);
    const second = model.requests[1]?.messages ?? [];
    const last = second.at(-1);
    expect(last?.role).toBe("user");
    const results = toolResults(last);
    expect(results.map((r) => r.tool_use_id)).toEqual(calls.map((c) => c.id));
    expect(results.every((r) => r.is_error !== true)).toBe(true);
    assertResultsInOneMessage(second);
    assertAppendOnly(model.wire);
    expect(store.rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(3);
    expect(events.filter((e) => e.type === "tool_done")).toHaveLength(3);
    expect(events.some((e) => e.type === "thinking")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn", modelCalls: 2 });
  });

  it("G1 negative control: results split over two user messages fail the one-message check", () => {
    const a = toolUse("get_plan", PLAN);
    const b = toolUse("get_household", {});
    const bad: BetaMessageParam[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [a, b] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: a.id, content: "{}" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: b.id, content: "{}" }] },
    ];
    expect(() => {
      assertResultsInOneMessage(bad);
    }).toThrow(/instead of/);
  });
});

describe("G1 invalid tool JSON", () => {
  it("G1 an input that fails its schema returns is_error INVALID_JSON and the tool does not run", async () => {
    const ports = recordingPorts();
    const bad = toolUse("get_plan", { from: "next monday", to: 7 });
    const good = toolUse("get_household", {});
    const { outcome, model } = await turn(
      [message([bad, good], "tool_use"), message([text("Sorry.")], "end_turn")],
      { ports },
    );
    expect(outcome.stopReason).toBe("end_turn");
    const results = toolResults(model.requests[1]?.messages.at(-1));
    const r0 = results[0];
    expect(r0?.is_error).toBe(true);
    const parsed = JSON.parse(r0?.content ?? "{}") as { INVALID_JSON?: string };
    expect(JSON.parse(parsed.INVALID_JSON ?? "null")).toEqual({ from: "next monday", to: 7 });
    expect(results[1]?.is_error).toBeUndefined();
    expect(ports.calls.map((c) => c.port)).toEqual(["getHousehold"]);
  });

  it("G1 unknown tools and extra fields are refused before any port runs", async () => {
    const ports = recordingPorts();
    const { model } = await turn(
      [
        message(
          [toolUse("drop_tables", {}), toolUse("get_household", { householdId: "x" })],
          "tool_use",
        ),
        message([text("ok")], "end_turn"),
      ],
      { ports },
    );
    const results = toolResults(model.requests[1]?.messages.at(-1));
    expect(results.map((r) => r.is_error)).toEqual([true, true]);
    expect(ports.calls).toEqual([]);
  });

  it("G1 the SDK's tool-JSON parse error re-issues the request (≤ 2) and then ends the turn", async () => {
    const jsonError = () => new ToolJsonError("Unable to parse tool parameter JSON from model.");
    const retried = await turn([jsonError(), jsonError(), message([text("ok")], "end_turn")]);
    expect(retried.outcome.stopReason).toBe("end_turn");
    expect(retried.model.calls).toBe(3);
    expect(retried.store.rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(retried.records.map((r) => r.stopReason)).toEqual([
      "invalid_tool_json",
      "invalid_tool_json",
      "end_turn",
    ]);
    const failed = await turn([jsonError(), jsonError(), jsonError()]);
    expect(failed.outcome.stopReason).toBe("invalid_tool_json");
    expect(failed.model.calls).toBe(3);
    expect(failed.store.rows.map((r) => r.role)).toEqual(["user"]);
  });

  it("G1 only the SDK's parse error is caught; typed API errors end the turn as errors", () => {
    const signal = new AbortController().signal;
    const parse = new AnthropicError(
      "Unable to parse tool parameter JSON from model. Error: x. JSON: {",
    );
    expect(classifyStreamError(parse, signal)).toBeInstanceOf(ToolJsonError);
    const other = new AnthropicError("stream ended without producing a Message");
    expect(classifyStreamError(other, signal)).not.toBeInstanceOf(ToolJsonError);
    const api = APIError.generate(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "slow" } },
      "slow",
      new Headers(),
    );
    const mapped = classifyStreamError(api, signal);
    expect(mapped).toBeInstanceOf(ClaudeCallError);
    expect((mapped as ClaudeCallError).code).toBe("rate_limited");
    const aborted = new AbortController();
    aborted.abort();
    expect(classifyStreamError(api, aborted.signal)).toBeInstanceOf(AgentAbortedError);
  });

  it("G1 the real SDK stream: malformed tool JSON on the wire becomes ToolJsonError", async () => {
    const sse = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "m",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_x", name: "get_plan", input: {} },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"from": "2026-09-28", "to": 2026-09-29"}}',
          },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 5 },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    ]
      .map(([event, data]) => `event: ${event as string}\ndata: ${JSON.stringify(data)}\n\n`)
      .join("");
    const bodies: unknown[] = [];
    const anthropic = new Anthropic({
      apiKey: "test-key-not-real",
      maxRetries: 0,
      fetch: (_url, init) => {
        bodies.push(JSON.parse(init?.body as string));
        return Promise.resolve(
          new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
        );
      },
    });
    const model = createAgentModel({ enabled: true, model: "claude-test" }, "high", { anthropic });
    if (model === null) throw new Error("no model");
    const ev: string[] = [];
    let thrown: unknown = null;
    try {
      await model.stream(
        { system: [], tools: [], messages: [{ role: "user", content: "hi" }] },
        (e) => ev.push(e.type),
        new AbortController().signal,
      );
    } catch (error) {
      thrown = error;
    }
    // This fragment is not parseable even tolerantly: the SDK raises, and the port classifies it.
    expect(thrown).toBeInstanceOf(ToolJsonError);
    expect(ev).toContain("content_block_start");
    const body = bodies[0] as Record<string, unknown>;
    expect(body.fallbacks).toBe("default");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.stream).toBe(true);
  });
});

describe("G1 stop reasons", () => {
  it("G1 refusal: no tool runs, the unrun calls are answered, the turn ends with a refusal event", async () => {
    const ports = recordingPorts();
    const call = toolUse("apply_change", { summary: "x", ops: [] });
    const { outcome, store, events, model } = await turn(
      [
        message([text("I"), call], "refusal", {
          stop_details: { type: "refusal", category: "cyber", explanation: null },
        } as never),
      ],
      { ports },
    );
    expect(outcome.stopReason).toBe("refusal");
    expect(ports.calls).toEqual([]);
    expect(model.calls).toBe(1);
    expect(store.rows.map((r) => r.role)).toEqual(["user", "assistant", "tool"]);
    assertResultsInOneMessage(replay(store.rows));
    expect(
      events.some((e) => e.type === "error" && e.code === "refusal" && e.message.includes("cyber")),
    ).toBe(true);
  });

  it("G1 max_tokens with a tool_use: the cut-off call does not run; without one the text is kept", async () => {
    const ports = recordingPorts();
    const cut = await turn([message([toolUse("get_plan", PLAN)], "max_tokens")], { ports });
    expect(cut.outcome.stopReason).toBe("max_tokens");
    expect(ports.calls).toEqual([]);
    const results = toolResults(replay(cut.store.rows).at(-1));
    expect(results[0]?.is_error).toBe(true);
    expect(results[0]?.content).toContain("max_tokens");
    const plain = await turn([message([text("A long answer")], "max_tokens")]);
    expect(plain.store.rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(plain.outcome.stopReason).toBe("max_tokens");
  });

  it("G1 pause_turn is resumed by sending the paused response back, with no extra user message", async () => {
    const paused = message([text("Working")], "pause_turn");
    const { outcome, model } = await turn([paused, message([text("Done")], "end_turn")]);
    expect(outcome.stopReason).toBe("end_turn");
    expect(model.calls).toBe(2);
    const second = model.requests[1]?.messages ?? [];
    expect(second.at(-1)?.role).toBe("assistant");
    expect(second.filter((m) => m.role === "user")).toHaveLength(1);
    assertAppendOnly(model.wire);
  });

  it("G1 typed API errors end the turn with an error event and an audit record", async () => {
    const err = new ClaudeCallError("rate_limited", "the Anthropic API rate limit was reached", {
      status: 429,
    });
    const { outcome, events, records, store } = await turn([err]);
    expect(outcome.stopReason).toBe("error");
    expect(events.some((e) => e.type === "error" && e.code === "rate_limited")).toBe(true);
    expect(records[0]?.stopReason).toBe("rate_limited");
    expect(store.rows.map((r) => r.role)).toEqual(["user"]);
  });

  it("G1 an unexpected port failure answers is_error and the turn continues", async () => {
    const ports = recordingPorts({
      getHousehold: () => Promise.reject(new Error("connection reset")),
    });
    const seen: string[] = [];
    const model = new ScriptedModel([
      message([toolUse("get_household", {})], "tool_use"),
      message([text("ok")], "end_turn"),
    ]);
    const store = new MemoryStore();
    const outcome = await runAgentTurn({
      model,
      ports,
      store,
      history: [],
      text: "hi",
      screen: null,
      digest: DIGEST,
      sink: () => undefined,
      signal: new AbortController().signal,
      recordCall: () => Promise.resolve(),
      onUnexpected: (_e, tool) => {
        seen.push(tool);
      },
    });
    expect(outcome.stopReason).toBe("end_turn");
    expect(seen).toEqual(["get_household"]);
    const results = toolResults(model.requests[1]?.messages.at(-1));
    expect(results[0]?.is_error).toBe(true);
    expect(results[0]?.content).not.toContain("connection reset");
  });

  it("G1 an abort mid-stream ends the turn without storing a partial response", async () => {
    const controller = new AbortController();
    const step: Step = () => {
      controller.abort();
      return message([text("partial")], "end_turn");
    };
    const { outcome, store } = await turn([step], { signal: controller.signal });
    expect(outcome.stopReason).toBe("aborted");
    expect(store.rows.map((r) => r.role)).toEqual(["user"]);
  });
});

describe("G1 iteration cap", () => {
  it(`G1 the cap: exactly ${String(MAX_MODEL_CALLS)} model calls, the last call's tools are not run, and a report is stored`, async () => {
    const ports = recordingPorts();
    const always: Step = () => message([toolUse("get_household", {})], "tool_use");
    const { outcome, model, store, events } = await turn([], { ports, fallback: always });
    expect(outcome.stopReason).toBe("iteration_limit");
    expect(model.calls).toBe(MAX_MODEL_CALLS);
    expect(ports.calls).toHaveLength(MAX_MODEL_CALLS - 1);
    const roles = store.rows.map((r) => r.role);
    expect(roles.filter((r) => r === "assistant")).toHaveLength(MAX_MODEL_CALLS);
    expect(roles.filter((r) => r === "tool")).toHaveLength(MAX_MODEL_CALLS);
    expect(roles.at(-1)).toBe("event");
    const last = store.rows.at(-1)?.content as {
      text: string;
      cards: { type: string; ran: unknown[]; notRun: unknown[] }[];
    };
    expect(last.cards[0]?.type).toBe("iteration_limit");
    expect(last.cards[0]?.ran).toHaveLength(MAX_MODEL_CALLS - 1);
    expect(last.cards[0]?.notRun).toEqual([{ name: "get_household" }]);
    assertResultsInOneMessage(replay(store.rows));
    assertAppendOnly(model.wire);
    expect(events.at(-1)).toEqual({
      type: "done",
      stopReason: "iteration_limit",
      modelCalls: MAX_MODEL_CALLS,
    });
  });

  it("G1 negative control: a transcript with an unanswered tool_use fails the history check", () => {
    const a = toolUse("get_household", {});
    expect(() => {
      assertResultsInOneMessage([
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [a] },
      ]);
    }).toThrow(/not answered/);
  });
});
