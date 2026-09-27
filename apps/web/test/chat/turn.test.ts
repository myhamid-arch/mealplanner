// AGT-7 / AGT-8: chat items derived from the stored rows, and the SSE events folded into them.
import { describe, expect, it } from "vitest";
import {
  buildItems,
  IDLE,
  reduce,
  stopNotice,
  userText,
  type Row,
} from "../../components/chat/turn";

const at = (s: number) => new Date(Date.UTC(2026, 8, 27, 9, 0, s)).toISOString();
const LABELS = { get_plan: "Checking the plan…", apply_change: "Applying the change…" };

const rows: Row[] = [
  {
    id: "u1",
    role: "user",
    createdAt: at(0),
    content: [
      { type: "text", text: "Plan tomorrow" },
      { type: "text", text: "Looking at: Plan" },
      { type: "text", text: "<digest>" },
    ],
  },
  {
    id: "a1",
    role: "assistant",
    createdAt: at(1),
    content: [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "On it." },
      { type: "tool_use", id: "t1", name: "get_plan", input: {} },
      { type: "tool_use", id: "t2", name: "apply_change", input: {} },
    ],
  },
  {
    id: "r1",
    role: "tool",
    createdAt: at(2),
    content: {
      results: [
        { type: "tool_result", tool_use_id: "t1", content: "{}" },
        { type: "tool_result", tool_use_id: "t2", content: "{}", is_error: true },
      ],
      cards: [{ type: "job_progress", jobId: "j1", kind: "plan.generate", status: "queued" }],
    },
  },
  { id: "a2", role: "assistant", createdAt: at(3), content: [{ type: "text", text: "Done." }] },
  {
    id: "e1",
    role: "event",
    createdAt: at(4),
    content: {
      text: "The plan is ready.",
      cards: [{ type: "job_progress", jobId: "j1", kind: "plan.generate", status: "succeeded" }],
    },
  },
];

describe("buildItems", () => {
  it("shows what the admin typed, the turn's steps, text and cards in order, and events", () => {
    const items = buildItems(rows, LABELS);
    expect(items.map((i) => i.kind)).toEqual(["user", "turn", "event"]);
    expect(userText(rows[0] as Row)).toBe("Plan tomorrow");
    const turn = items[1];
    if (turn?.kind !== "turn") throw new Error("no turn");
    expect(turn.steps).toEqual([
      { id: "t1", name: "get_plan", label: "Checking the plan…", ok: true },
      { id: "t2", name: "apply_change", label: "Applying the change…", ok: false },
    ]);
    expect(turn.parts.map((p) => p.kind)).toEqual(["text", "cards", "text"]);
    expect(turn.live).toBe(false);
  });

  it("merges a live turn into the last one", () => {
    const live = {
      ...IDLE,
      running: true,
      text: "Look",
      steps: [{ id: "t9", name: "get_plan", label: "Checking the plan…", ok: null }],
    };
    const items = buildItems(rows.slice(0, 1), LABELS, live);
    const turn = items.at(-1);
    if (turn?.kind !== "turn") throw new Error("no live turn");
    expect(turn.live).toBe(true);
    expect(turn.steps).toHaveLength(1);
    expect(turn.parts).toEqual([{ kind: "text", text: "Look", key: "live-text" }]);
  });
});

describe("reduce", () => {
  it("folds a streamed turn: rows, text, tool steps, cards, the end", () => {
    let s = { rows: [] as Row[], live: { ...IDLE, running: true } };
    s = reduce(s, { type: "message", message: rows[0] as Row });
    s = reduce(s, { type: "thinking" });
    expect(s.live.thinking).toBe(true);
    s = reduce(s, { type: "text_delta", text: "On " });
    s = reduce(s, { type: "text_delta", text: "it." });
    expect(s.live.text).toBe("On it.");
    s = reduce(s, { type: "message", message: rows[1] as Row });
    expect(s.live.text).toBe("");
    s = reduce(s, {
      type: "tool_start",
      toolUseId: "t1",
      name: "get_plan",
      label: "Checking the plan…",
    });
    s = reduce(s, {
      type: "tool_done",
      toolUseId: "t1",
      name: "get_plan",
      ok: true,
      cards: [{ type: "x" }],
    });
    expect(s.live.steps).toEqual([
      { id: "t1", name: "get_plan", label: "Checking the plan…", ok: true },
    ]);
    expect(s.live.cards).toHaveLength(1);
    s = reduce(s, { type: "message", message: rows[2] as Row });
    expect(s.live.cards).toHaveLength(0);
    s = reduce(s, { type: "message", message: rows[2] as Row });
    expect(s.rows).toHaveLength(3);
    s = reduce(s, { type: "done", stopReason: "refusal", modelCalls: 1 });
    expect(s.live.running).toBe(false);
    expect(s.live.notice).toBe(stopNotice("refusal"));
    expect(stopNotice("end_turn")).toBeNull();
  });
});
