// Fixtures for the insight-synthesis tests (leaf 1.3.3 G3): a household with named members, a
// synthesis input, a stubbed StructuredModel, and wire responses for the recorded SDK client.
import type {
  StructuredModel,
  StructuredRequest,
  StructuredResult,
} from "../../src/client/index.js";
import { DEFAULT_MODEL } from "../../src/client/index.js";
import type { InsightsGenerationRecord } from "../../src/insights/index.js";
import type { SynthesisInput } from "@mealplanner/core/learning/rules";
import type { SynthesisOutput } from "../../src/insights/index.js";
import type { z } from "zod";

export const OMAR = "60000000-0000-4000-8000-000000000001";
export const SARA = "60000000-0000-4000-8000-000000000002";
export const ZAYD = "60000000-0000-4000-8000-000000000003";
export const RICE_BOWL = "61000000-0000-4000-8000-000000000001";
export const SALAD = "61000000-0000-4000-8000-000000000002";
export const FREEKEH = "62000000-0000-4000-8000-000000000001";
export const LUNCH = "63000000-0000-4000-8000-000000000001";
export const R1 = "64000000-0000-4000-8000-000000000001";
export const R2 = "64000000-0000-4000-8000-000000000002";
export const R3 = "64000000-0000-4000-8000-000000000003";

/** A synthesis input with member names in every free-text field, to test pseudonymisation. */
export function synthesisInput(): SynthesisInput {
  return {
    referenceDate: "2026-09-26",
    members: [
      { id: OMAR, displayName: "Omar Haddad", birthYear: 1985, isTargeted: true },
      { id: SARA, displayName: "Sara Haddad", birthYear: 1987, isTargeted: true },
      { id: ZAYD, displayName: "Zayd", birthYear: 2016, isTargeted: false },
    ],
    candidates: [
      {
        origin: "rule",
        rule: "dish_dislike",
        title: "Omar Haddad dislikes Rice bowl",
        rationale: "Omar Haddad rated Rice bowl 2 times with a mean of 1.",
        ops: [
          {
            kind: "preference.set",
            payload: {
              memberId: OMAR,
              entityType: "dish",
              entityKey: RICE_BOWL,
              score: -0.8,
              locked: true,
              source: "proposal",
            },
          },
        ],
        evidence: { reviewIds: [R1, R2], count: 2, metrics: { meanRating: 1 } },
        priority: 3,
      },
    ],
    notes: [],
    reviews: [
      {
        id: R1,
        memberId: OMAR,
        about: "Rice bowl",
        rating: 1,
        tags: [],
        comment: "Omar is bored of rice at lunch",
      },
      { id: R2, memberId: OMAR, about: "Rice bowl", rating: 1, tags: ["dry"], comment: null },
      {
        id: R3,
        memberId: ZAYD,
        about: "Zayd's salad",
        rating: 2,
        tags: [],
        comment: "Zayd never eats the salad, Sara says",
      },
    ],
    settings: { appeal: 0.6, macroPrecision: 1, ingredientEconomy: 0.4, pendingProposals: 1 },
    rejected: [
      {
        title: "Serve Rice bowl less often",
        kind: "frequency.set",
        decisionNote: "Sara Haddad loves it, keep it weekly",
        decidedAt: "2026-09-20T10:00:00.000Z",
      },
    ],
    references: {
      dishes: [
        { id: RICE_BOWL, name: "Rice bowl" },
        { id: SALAD, name: "Zayd's salad" },
      ],
      ingredients: [{ id: FREEKEH, slug: "freekeh", name: "Freekeh" }],
      slots: [{ id: LUNCH, key: "lunch", label: "Lunch" }],
    },
  };
}

export type WireOp = { kind: string; payloadJson: string };

export function wireOp(kind: string, payload: unknown): WireOp {
  return { kind, payloadJson: JSON.stringify(payload) };
}

export function wireProposal(
  ops: WireOp[],
  options: { title?: string; priority?: number; evidence?: string[] } = {},
): SynthesisOutput["proposals"][number] {
  return {
    title: options.title ?? "A proposal",
    rationale: "Because of the reviews.",
    priority: options.priority ?? 3,
    evidenceReviewIds: options.evidence ?? [R1],
    ops,
  };
}

export const validPreference = wireOp("preference.set", {
  memberId: "Adult A",
  entityType: "dish",
  entityKey: RICE_BOWL,
  score: -0.8,
  locked: true,
  source: "proposal",
});

/** A StructuredModel that validates a fixed output with the request's schema, as the SDK does. */
export function stubModel(
  output: unknown,
): StructuredModel & { requests: StructuredRequest<z.ZodType>[] } {
  const requests: StructuredRequest<z.ZodType>[] = [];
  return {
    model: DEFAULT_MODEL,
    requests,
    parse<S extends z.ZodType>(
      request: StructuredRequest<S>,
    ): Promise<StructuredResult<z.output<S>>> {
      requests.push(request);
      return Promise.resolve({
        output: request.schema.parse(output),
        servedModel: DEFAULT_MODEL,
        stopReason: "end_turn",
        usage: { inputTokens: 1200, outputTokens: 800, cacheReadTokens: 0, cacheCreationTokens: 0 },
        content: [{ type: "text", text: JSON.stringify(output), citations: null }],
        messageId: "msg_stub_1",
      });
    },
  };
}

export function recorder() {
  const records: InsightsGenerationRecord[] = [];
  return {
    records,
    recordGeneration: (record: InsightsGenerationRecord) => {
      records.push(record);
      return Promise.resolve(
        `70000000-0000-4000-8000-${records.length.toString().padStart(12, "0")}`,
      );
    },
  };
}

/** A wire `message` response whose text is `output` (structured output), after thinking. */
export function wireResponse(output: unknown, stopReason = "end_turn") {
  return {
    status: 200,
    body: {
      id: "msg_recorded_insights",
      type: "message",
      role: "assistant",
      model: DEFAULT_MODEL,
      content: [
        { type: "thinking", thinking: "", signature: "sig_recorded_insights" },
        { type: "text", text: JSON.stringify(output), citations: null },
      ],
      stop_reason: stopReason,
      stop_sequence: null,
      stop_details:
        stopReason === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
      usage: {
        input_tokens: 3000,
        output_tokens: 900,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 2500,
      },
    },
  };
}
