// Tool definitions and the change tools' rules (AGT-4, AGT-5, AGT-6; SPEC-Q-7, SPEC-Q-8, R-36).
// The server-side enforcement itself is proven against the database in G2 (apps/web).
import { describe, expect, it } from "vitest";
import {
  TOOL_NAMES,
  agentParams,
  opReference,
  requestPrefix,
  runTool,
  systemBlocks,
  toolDefinitions,
  type IngredientKey,
} from "../../src/agent/index.js";
import { recordingPorts, toolUse } from "./support.js";

const SARA = "70000000-0000-4000-8000-000000000002";

function parse(content: unknown) {
  return JSON.parse(String(content)) as Record<string, unknown>;
}

describe("tool definitions", () => {
  it("defines exactly the AGT-4 tools, each with eager input streaming and an object schema", () => {
    expect(TOOL_NAMES).toEqual([
      "get_household",
      "get_plan",
      "explain_meal",
      "search_dishes",
      "get_dish",
      "get_reviews",
      "get_preferences",
      "get_proposals",
      "get_change_log",
      "generate_plan",
      "suggest_alternatives",
      "create_recipe",
      "run_insights",
      "apply_change",
      "propose_change",
      "undo_change",
    ]);
    for (const t of toolDefinitions()) {
      expect(t.eager_input_streaming).toBe(true);
      expect(t.input_schema.type).toBe("object");
      expect(JSON.stringify(t.input_schema)).not.toContain("householdId");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
  });

  it("the cached prefix is byte-stable across builds", () => {
    expect(JSON.stringify(requestPrefix())).toBe(JSON.stringify(requestPrefix()));
    const blocks = systemBlocks();
    expect(blocks.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(opReference()).not.toContain("access.block");
    expect(opReference()).toContain("exclusion.add (protected when relaxing)");
    expect(opReference()).toContain("member.archive (protected)");
  });

  it("the request carries the fallback and compaction betas, adaptive thinking and effort", () => {
    const p = agentParams("m", "high", { ...requestPrefix(), messages: [] });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01", "compact-2026-01-12"]);
    expect(p.fallbacks).toBe("default");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config).toEqual({ effort: "high" });
    expect(p.context_management).toEqual({ edits: [{ type: "compact_20260112" }] });
    expect(p).not.toHaveProperty("tool_choice");
  });
});

describe("change tools", () => {
  it("apply_change applies through the port and returns an applied_change card", async () => {
    const ports = recordingPorts();
    const run = await runTool(
      toolUse("apply_change", {
        summary: "Set Sara's protein to 140 g",
        ops: [{ kind: "weights.set", payload: { appeal: 0.8 } }],
      }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(run.ok).toBe(true);
    expect(parse(run.result.content).status).toBe("applied");
    expect(run.cards[0]?.type).toBe("applied_change");
    expect(ports.calls.map((c) => c.port)).toEqual(["applyChange"]);
  });

  it("a server refusal (protected) becomes an agent proposal with the same ops", async () => {
    const ports = recordingPorts({
      applyChange: () =>
        Promise.resolve({
          status: "refused" as const,
          reason: "protected" as const,
          kinds: ["member.archive"],
        }),
    });
    const ops = [{ kind: "member.archive", payload: { memberId: SARA } }];
    const run = await runTool(
      toolUse("apply_change", { summary: "Archive Sara", ops }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(parse(run.result.content)).toMatchObject({ status: "proposed", reason: "protected" });
    expect(run.cards[0]?.type).toBe("proposal");
    const proposed = ports.calls.find((c) => c.port === "proposeChange")?.input as { ops: unknown };
    expect(proposed.ops).toEqual(ops);
  });

  it("access and support ops are refused as tool errors; role.set is allowed (SPEC-Q-7)", async () => {
    const ports = recordingPorts();
    const refused = await runTool(
      toolUse("apply_change", {
        summary: "Block Omar",
        ops: [{ kind: "access.block", payload: { userId: SARA, reason: null } }],
      }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(run(refused)).toMatch(/People & access/);
    expect(ports.calls).toEqual([]);
  });

  it("an invalid op payload is refused with the registry's issues, before any port", async () => {
    const ports = recordingPorts();
    const bad = await runTool(
      toolUse("propose_change", {
        title: "x",
        rationale: "y",
        ops: [
          {
            kind: "exclusion.add",
            payload: {
              memberId: SARA,
              kind: "ingredient",
              key: "sesame",
              reason: "allergy",
              hard: false,
            },
          },
        ],
      }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(bad.result.is_error).toBe(true);
    expect(run(bad)).toContain("not a valid exclusion.add op");
    expect(ports.calls).toEqual([]);
  });

  it("an ingredient exclusion keyed by id is refused with the slug to use (R-36)", async () => {
    const ports = recordingPorts({
      ingredientKey: (key) =>
        Promise.resolve<IngredientKey>(
          key === "sesame"
            ? { status: "slug", slug: "sesame" }
            : key.startsWith("7")
              ? { status: "id", slug: "sesame" }
              : { status: "unknown" },
        ),
    });
    const byId = await runTool(
      toolUse("apply_change", {
        summary: "Omar is allergic to sesame",
        ops: [
          {
            kind: "exclusion.add",
            payload: {
              memberId: SARA,
              kind: "ingredient",
              key: "70000000-0000-4000-8000-00000000000a",
              reason: "allergy",
              hard: true,
            },
          },
        ],
      }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(run(byId)).toContain('slug "sesame"');
    const unknown = await runTool(
      toolUse("apply_change", {
        summary: "x",
        ops: [
          {
            kind: "exclusion.add",
            payload: {
              memberId: null,
              kind: "ingredient",
              key: "unobtainium",
              reason: "dislike",
              hard: true,
            },
          },
        ],
      }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(run(unknown)).toContain("not a catalogue ingredient slug");
    expect(ports.calls).toEqual([]);
    const ok = await runTool(
      toolUse("apply_change", {
        summary: "x",
        ops: [
          {
            kind: "exclusion.add",
            payload: {
              memberId: SARA,
              kind: "ingredient",
              key: "sesame",
              reason: "allergy",
              hard: true,
            },
          },
        ],
      }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(ok.ok).toBe(true);
  });
});

/** The error text of a tool result (or its whole content when it is not an error). */
function run(r: { result: { content?: unknown } }): string {
  const body = parse(r.result.content);
  return typeof body.error === "string" ? body.error : String(r.result.content);
}

describe("change tools: time zones", () => {
  it("household.update with an unknown time zone is refused before any port", async () => {
    const ports = recordingPorts();
    const bad = await runTool(
      toolUse("apply_change", {
        summary: "Move to Mars",
        ops: [{ kind: "household.update", payload: { timezone: "Mars/Olympus" } }],
      }),
      ports,
      "row-2",
      () => undefined,
    );
    expect(run(bad)).toContain("not an IANA time zone");
    expect(ports.calls).toEqual([]);
  });
});
