// G3 (leaf 1.3.3): LLM synthesis output is Zod-validated; invalid kinds are dropped and logged
// (stubbed model). Also: pseudonymised requests (FBK-7), disabled without a credential with a
// stated reason, typed failures recorded (DM-7), and one run through the real SDK client with a
// recorded response.
import { describe, expect, it } from "vitest";
import {
  INSIGHTS_DISABLED_REASON,
  INSIGHT_KINDS,
  kindsBlock,
  pseudonyms,
  resolveInsightsModel,
  synthesizeInsights,
  validateProposals,
  evidenceIds,
  knownIds,
  synthesisContext,
} from "../../src/insights/index.js";
import { createClaudeClient, resolveClaudeConfig } from "../../src/client/index.js";
import { registry } from "@mealplanner/core/changes";
import { recordedClient } from "../recipes/support/recorded.js";
import {
  FREEKEH,
  LUNCH,
  OMAR,
  R1,
  R3,
  RICE_BOWL,
  SARA,
  ZAYD,
  recorder,
  stubModel,
  synthesisInput,
  validPreference,
  wireOp,
  wireProposal,
  wireResponse,
} from "./support.js";

const input = synthesisInput();

/** The G3 invalid-kind outputs: an R-10 kind, a protected kind, a registered but not allowed kind, an unknown kind. */
const INVALID_KINDS = ["access.block", "role.set", "plan.swap_dish", "recipe.teleport"];

/** Payloads that are valid for their kind, so only the kind check can drop them. */
const INVALID_KIND_PAYLOADS: Record<string, unknown> = {
  "access.block": { userId: OMAR },
  "role.set": { userId: OMAR, role: "member" },
  "plan.swap_dish": { planMealId: RICE_BOWL, dishId: RICE_BOWL, scoreBreakdown: {}, plates: [] },
  "recipe.teleport": { dishId: RICE_BOWL },
};

function invalidKindOutput() {
  return {
    proposals: [
      wireProposal([validPreference], { title: "valid" }),
      ...INVALID_KINDS.map((kind) =>
        wireProposal([wireOp(kind, INVALID_KIND_PAYLOADS[kind])], { title: `bad ${kind}` }),
      ),
    ],
  };
}

describe("G3 validation of synthesised proposals", () => {
  it("G3 a valid proposal is kept, with the member label mapped back to the member id", async () => {
    const log = recorder();
    const result = await synthesizeInsights(
      {
        model: stubModel({ proposals: [wireProposal([validPreference])] }),
        recordGeneration: log.recordGeneration,
      },
      input,
    );
    expect(result.status).toBe("ok");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      origin: "insights",
      priority: 3,
      ops: [
        { kind: "preference.set", payload: { memberId: OMAR, entityKey: RICE_BOWL, score: -0.8 } },
      ],
      evidence: { reviewIds: [R1], count: 1 },
    });
    expect(result.dropped).toEqual([]);
    expect(log.records[0]?.validationErrors).toBeNull();
  });

  it("G3 invalid kinds are dropped and logged: R-10, protected, not allowed, and unknown kinds", async () => {
    const log = recorder();
    const result = await synthesizeInsights(
      { model: stubModel(invalidKindOutput()), recordGeneration: log.recordGeneration },
      input,
    );
    expect(result.status).toBe("ok");
    expect(result.proposals.map((p) => p.title)).toEqual(["valid"]);
    expect(result.dropped.map((d) => [d.kind, d.reason])).toEqual(
      INVALID_KINDS.map((k) => [k, "invalid_kind"]),
    );
    // Logged in the ai_generation record (DM-7) as well as returned.
    expect(log.records).toHaveLength(1);
    const logged = log.records[0]?.validationErrors as { kind: string; reason: string }[];
    expect(logged.map((d) => [d.kind, d.reason])).toEqual(
      INVALID_KINDS.map((k) => [k, "invalid_kind"]),
    );
    expect(result.generationId).toMatch(/^70000000-/);
  });

  it("G3 every other Zod or reference failure is dropped with its reason", async () => {
    const cases: [string, ReturnType<typeof wireProposal>][] = [
      ["invalid_json", wireProposal([{ kind: "preference.set", payloadJson: "{not json" }])],
      [
        "invalid_payload",
        wireProposal([
          wireOp("preference.set", {
            memberId: "Adult A",
            entityType: "dish",
            entityKey: RICE_BOWL,
            score: 3,
          }),
        ]),
      ],
      [
        "invalid_payload",
        wireProposal([
          wireOp("frequency.set", {
            memberId: null,
            entityType: "planet",
            entityKey: RICE_BOWL,
            minGapDays: 3,
            maxPerWeek: null,
          }),
        ]),
      ],
      [
        "unknown_member",
        wireProposal([
          wireOp("preference.set", {
            memberId: "Adult Z",
            entityType: "dish",
            entityKey: RICE_BOWL,
            score: -0.5,
          }),
        ]),
      ],
      [
        "unknown_reference",
        wireProposal([
          wireOp("ingredient.verify", { ingredientId: "6fffffff-0000-4000-8000-000000000009" }),
        ]),
      ],
      [
        "unknown_evidence",
        wireProposal([validPreference], { evidence: ["64000000-0000-4000-8000-000000000099"] }),
      ],
      ["invalid_proposal", wireProposal([validPreference], { priority: 9 })],
      ["invalid_proposal", wireProposal([])],
    ];
    const log = recorder();
    const result = await synthesizeInsights(
      {
        model: stubModel({ proposals: cases.map(([, p]) => p) }),
        recordGeneration: log.recordGeneration,
      },
      input,
    );
    expect(result.proposals).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual(cases.map(([reason]) => reason));
    expect(result.dropped.map((d) => d.index)).toEqual(cases.map((_, i) => i));
    expect(log.records[0]?.validationErrors).toHaveLength(cases.length);
  });

  it("G3 a proposal with one invalid op among valid ones is dropped whole", async () => {
    const mixed = wireProposal([validPreference, wireOp("access.remove", { userId: OMAR })]);
    const result = await synthesizeInsights(
      { model: stubModel({ proposals: [mixed] }), recordGeneration: recorder().recordGeneration },
      input,
    );
    expect(result.proposals).toEqual([]);
    expect(result.dropped[0]).toMatchObject({ reason: "invalid_kind", kind: "access.remove" });
  });

  it("G3 the allowed kinds exclude every R-10 and statically protected kind, and each has a schema in the prompt", () => {
    for (const kind of INSIGHT_KINDS) {
      expect(registry.get(kind)?.protected).not.toBe(true);
      expect([
        "access.block",
        "access.remove",
        "access.link_member",
        "support.grant",
      ]).not.toContain(kind);
    }
    const block = kindsBlock();
    for (const kind of INSIGHT_KINDS) expect(block).toContain(`${kind}: {`);
    expect(kindsBlock()).toBe(block);
  });
});

describe("G3 request: pseudonymised, cached, fed back with rejections", () => {
  it("G3 no member name reaches the model; labels, rejected notes and rule candidates do", async () => {
    const model = stubModel({ proposals: [] });
    await synthesizeInsights({ model, recordGeneration: recorder().recordGeneration }, input);
    const request = JSON.stringify(model.requests[0]);
    for (const name of ["Omar", "Sara", "Haddad", "Zayd"]) expect(request).not.toContain(name);
    expect(request).toContain("Adult A");
    expect(request).toContain("Child A");
    expect(request).toContain("keep it weekly");
    expect(request).toContain("bored of rice at lunch");
    expect(request).not.toContain(OMAR);
    expect(request).not.toContain(SARA);
    expect(request).not.toContain(ZAYD);
  });

  it("G3 the system blocks are byte-stable across runs and carry a cache breakpoint", async () => {
    const a = stubModel({ proposals: [] });
    const b = stubModel({ proposals: [] });
    await synthesizeInsights({ model: a, recordGeneration: recorder().recordGeneration }, input);
    await synthesizeInsights(
      { model: b, recordGeneration: recorder().recordGeneration },
      { ...input, reviews: input.reviews.slice(1) },
    );
    expect(JSON.stringify(a.requests[0]?.system)).toBe(JSON.stringify(b.requests[0]?.system));
    expect(a.requests[0]?.system.some((block) => block.cache_control !== undefined)).toBe(true);
    expect(a.requests[0]?.effort).toBe("high");
  });

  it("G3 the ids a proposal may name are exactly those shown to the model", () => {
    const names = pseudonyms(input);
    const context = synthesisContext(input, names);
    const ids = knownIds(context, input);
    for (const id of [RICE_BOWL, FREEKEH, LUNCH, R1, R3]) expect(ids.has(id)).toBe(true);
    expect(evidenceIds(input).has(R1)).toBe(true);
  });
});

describe("G3 disabled and failed synthesis", () => {
  it("G3 without a credential synthesis is disabled with a stated reason and no call or record", async () => {
    const resolved = resolveInsightsModel({});
    expect(resolved.model).toBeNull();
    expect(resolved.disabledReason).toBe(INSIGHTS_DISABLED_REASON);
    expect(INSIGHTS_DISABLED_REASON).toContain("ANTHROPIC_API_KEY");
    const log = recorder();
    const result = await synthesizeInsights(
      { model: null, recordGeneration: log.recordGeneration },
      input,
    );
    expect(result).toEqual({
      status: "disabled",
      reason: INSIGHTS_DISABLED_REASON,
      proposals: [],
      dropped: [],
      generationId: null,
    });
    expect(log.records).toEqual([]);
    expect(resolveInsightsModel({ ANTHROPIC_API_KEY: "sk-ant-test" }).model).not.toBeNull();
  });

  it("G3 a refusal is a typed failure, recorded, with no proposals", async () => {
    const rec = recordedClient([wireResponse({ proposals: [] }, "refusal")]);
    const model = createClaudeClient(resolveClaudeConfig({ ANTHROPIC_API_KEY: "x" }), {
      anthropic: rec.anthropic,
    });
    const log = recorder();
    const result = await synthesizeInsights(
      { model, recordGeneration: log.recordGeneration },
      input,
    );
    expect(result).toMatchObject({ status: "failed", code: "refusal", proposals: [] });
    expect(log.records[0]).toMatchObject({ purpose: "insights", stopReason: "refusal" });
  });
});

describe("G3 through the real SDK client (recorded response)", () => {
  it("G3 the SDK parses the structured output, invalid kinds are dropped and logged, and usage is recorded", async () => {
    const rec = recordedClient([wireResponse(invalidKindOutput())]);
    const model = createClaudeClient(resolveClaudeConfig({ ANTHROPIC_API_KEY: "x" }), {
      anthropic: rec.anthropic,
    });
    const log = recorder();
    const result = await synthesizeInsights(
      { model, recordGeneration: log.recordGeneration },
      input,
    );
    expect(result.status).toBe("ok");
    expect(result.proposals.map((p) => p.title)).toEqual(["valid"]);
    expect(result.dropped.map((d) => d.reason)).toEqual(INVALID_KINDS.map(() => "invalid_kind"));
    expect(log.records[0]).toMatchObject({
      inputTokens: 3000,
      outputTokens: 900,
      cacheReadTokens: 2500,
    });
    const body = rec.requests[0]?.body as {
      output_config: { effort: string; format: { type: string } };
    };
    expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format.type).toBe("json_schema");
    for (const name of ["Omar", "Sara", "Zayd"]) expect(rec.requests[0]?.raw).not.toContain(name);
  });
});

describe("negative controls", () => {
  it("G3 negative control: a validator that allows every kind keeps the invalid kinds, so the drop assertion fails on it", () => {
    const names = pseudonyms(input);
    const context = synthesisContext(input, names);
    const permissive = validateProposals(invalidKindOutput().proposals, {
      pseudonyms: names,
      knownIds: knownIds(context, input),
      evidenceIds: evidenceIds(input),
      allowedKinds: [...registry.keys(), "recipe.teleport"],
    });
    const dropsAllInvalidKinds = INVALID_KINDS.every((k) =>
      permissive.dropped.some((d) => d.kind === k && d.reason === "invalid_kind"),
    );
    expect(dropsAllInvalidKinds).toBe(false);
    // access.block for a known member id passes the registry's own schema when kinds are not checked.
    expect(permissive.proposals.map((p) => p.ops[0]?.kind)).toContain("access.block");
  });

  it("G3 negative control: without scrubbing, the same context leaks names, so the pseudonymisation assertion measures the scrub", () => {
    const names = pseudonyms(input);
    const unscrubbed = JSON.stringify(synthesisContext(input, { ...names, scrub: (text) => text }));
    expect(["Omar", "Sara", "Haddad", "Zayd"].some((n) => unscrubbed.includes(n))).toBe(true);
  });
});
