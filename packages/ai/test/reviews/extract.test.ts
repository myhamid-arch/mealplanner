// `reviews.extract` (ARC-7, R-46): structured extraction of FBK-3 tags from a review comment, with a
// stub model and the real client over a recorded response. No credential is used.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  ClaudeCallError,
  createClaudeClient,
  type StructuredModel,
} from "../../src/client/index.js";
import {
  REVIEW_TAGS,
  extractReviewTags,
  extractionRequest,
  newTags,
  scrubNames,
  type ExtractionGenerationRecord,
} from "../../src/reviews/index.js";

const INPUT = {
  comment: "Omar said it was way too salty, but please make it more often! Sara Haddad loved it.",
  authorTags: ["tasty"],
  about: "dish: Chicken shawarma bowl",
  names: ["Omar", "Sara Haddad"],
};

function stub(tags: string[] | Error): StructuredModel & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    model: "claude-stub",
    requests,
    parse: (request) => {
      requests.push(request);
      if (tags instanceof Error) return Promise.reject(tags);
      return Promise.resolve({
        output: { tags } as never,
        servedModel: "claude-stub",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0 },
        content: [],
        messageId: "msg_1",
      });
    },
  };
}

function recorder() {
  const records: ExtractionGenerationRecord[] = [];
  return {
    records,
    recordGeneration: (r: ExtractionGenerationRecord) => {
      records.push(r);
      return Promise.resolve(`gen-${String(records.length)}`);
    },
  };
}

describe("reviews.extract", () => {
  it("returns only new vocabulary tags and writes one audit row", async () => {
    const rec = recorder();
    const model = stub(["too_salty", "more_often", "tasty"]);
    const r = await extractReviewTags({ model, recordGeneration: rec.recordGeneration }, INPUT);
    expect(r).toEqual({
      status: "extracted",
      tags: ["more_often", "too_salty"],
      generationId: "gen-1",
    });
    expect(rec.records).toHaveLength(1);
    expect(rec.records[0]?.purpose).toBe("comment_extraction");
    expect(JSON.stringify(rec.records[0]?.requestSummary)).not.toContain("salty");
  });

  it("sends the comment with names scrubbed, at effort low", () => {
    const req = extractionRequest(INPUT);
    expect(req.effort).toBe("low");
    const text = JSON.stringify(req.messages);
    expect(text).not.toMatch(/Omar|Sara|Haddad/);
    expect(text).toContain("a family member said it was way too salty");
    expect(req.system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("drops tags that contradict the author's, and anything outside the vocabulary", () => {
    expect(newTags(["too_little", "just_right", "made_up"], ["too_much"])).toEqual([]);
    expect(newTags(["still_hungry"], [])).toEqual(["still_hungry"]);
    expect(REVIEW_TAGS).toHaveLength(26);
  });

  it("scrubs whole names and their words, not substrings of other words", () => {
    expect(scrubNames("Al and Alma ate", ["Al"])).toBe("a family member and Alma ate");
    expect(scrubNames("sara-approved", ["Sara"])).toBe("a family member-approved");
  });

  it("without a credential: disabled with the reason, no call, no audit row", async () => {
    const rec = recorder();
    const r = await extractReviewTags(
      { model: null, recordGeneration: rec.recordGeneration },
      INPUT,
    );
    expect(r.status).toBe("disabled");
    expect(rec.records).toEqual([]);
  });

  it("a typed API failure is recorded and reported, never thrown", async () => {
    const rec = recorder();
    const r = await extractReviewTags(
      {
        model: stub(new ClaudeCallError("refusal", "declined", { stopReason: "refusal" })),
        recordGeneration: rec.recordGeneration,
      },
      INPUT,
    );
    expect(r).toMatchObject({ status: "failed", code: "refusal", generationId: "gen-1" });
    expect(rec.records[0]?.stopReason).toBe("refusal");
  });

  it("the real client over a recorded response: request shape and parsed tags", async () => {
    const bodies: Record<string, unknown>[] = [];
    const anthropic = new Anthropic({
      apiKey: "test-key-not-real",
      maxRetries: 0,
      fetch: (_url, init) => {
        bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        return Promise.resolve(
          Response.json({
            id: "msg_rec",
            type: "message",
            role: "assistant",
            model: "claude-rec",
            content: [{ type: "text", text: '{"tags":["too_salty","more_often"]}' }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 50, output_tokens: 9 },
          }),
        );
      },
    });
    const model = createClaudeClient({ enabled: true, model: "claude-rec" }, { anthropic });
    const rec = recorder();
    const r = await extractReviewTags({ model, recordGeneration: rec.recordGeneration }, INPUT);
    expect(r).toMatchObject({ status: "extracted", tags: ["more_often", "too_salty"] });
    expect(bodies[0]?.output_config).toMatchObject({ effort: "low" });
    expect(bodies[0]?.fallbacks).toBe("default");
  });
});
