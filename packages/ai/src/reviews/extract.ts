// `reviews.extract` (ARC-7, R-40/R-46; leaf-1.3.5 SPEC-Q-15): the FBK-3 tags a review's free text
// implies, by structured output through 1.3.1's client at effort `low`. Names are scrubbed before
// the comment is sent (REC-3 style). Only vocabulary tags the author did not give (and did not
// contradict) are returned. Every call writes one `ai_generation` row (DM-7).
import type { BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import {
  ClaudeCallError,
  MAX_OUTPUT_TOKENS,
  type Effort,
  type StructuredModel,
  type StructuredRequest,
} from "../client/index.js";
import { OPPOSITES, REVIEW_TAGS, TAG_GROUPS } from "./vocabulary.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** ARC-7: comment extraction runs at effort `low`. */
export const EXTRACTION_EFFORT: Effort = "low";

export const EXTRACTION_DISABLED_REASON =
  "comment extraction is disabled: no Anthropic credential is configured (set ANTHROPIC_API_KEY)";

export const ExtractionOutputSchema = z.object({
  tags: z.array(z.enum(REVIEW_TAGS as [string, ...string[]])).max(8),
});
export type ExtractionOutput = z.output<typeof ExtractionOutputSchema>;

export const SYSTEM_PROMPT = `You read one family member's comment on a home-cooked meal and name the review tags it clearly implies, from a fixed vocabulary. The tags feed a meal planner's taste and portion learning.

Rules:
- Return only tags the comment clearly supports. When in doubt, leave the tag out. An empty list is a good answer.
- Do not repeat tags the author already chose; they are listed with the comment.
- Kitchen tags only when the comment is about cooking or ingredients (for example an ingredient was missing or the recipe was unclear).
- Quantity tags are about the portion served to this person.
- Frequency tags only when the comment asks for the dish more often, less often, or never again.

Vocabulary by group:
${Object.entries(TAG_GROUPS)
  .map(([group, tags]) => `- ${group}: ${tags.join(", ")}`)
  .join("\n")}`;

export function systemBlocks(): BetaTextBlockParam[] {
  return [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
}

export interface ExtractionInput {
  comment: string;
  /** The tags the author gave. */
  authorTags: readonly string[];
  /** What was reviewed, e.g. "dish: Chicken shawarma bowl". */
  about: string;
  /** Display names in the household (replaced before the text is sent). */
  names: readonly string[];
}

/** One `ai_generation` row (DM-7). No credentials. */
export interface ExtractionGenerationRecord {
  purpose: "comment_extraction";
  model: string;
  requestSummary: Json;
  responseRaw: Json;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  validationErrors: Json | null;
}

export interface ExtractionDeps {
  model: StructuredModel | null;
  disabledReason?: string;
  recordGeneration(record: ExtractionGenerationRecord): Promise<string>;
}

export type ExtractionResult =
  | { status: "extracted"; tags: string[]; generationId: string }
  | { status: "disabled"; reason: string }
  | { status: "failed"; code: string; message: string; generationId: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces each household name (and each of its words) with "a family member". */
export function scrubNames(text: string, names: readonly string[]): string {
  const words = new Set<string>();
  for (const n of names) {
    const trimmed = n.trim();
    if (trimmed.length < 2) continue;
    words.add(trimmed);
    for (const part of trimmed.split(/\s+/)) if (part.length >= 2) words.add(part);
  }
  let out = text;
  for (const w of [...words].sort((a, b) => b.length - a.length))
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}(?![\\p{L}\\p{N}])`, "giu"),
      "a family member",
    );
  return out;
}

/** Tags to keep: in the vocabulary, not given by the author, not contradicting the author. */
export function newTags(extracted: readonly string[], authorTags: readonly string[]): string[] {
  const given = new Set(authorTags);
  const opposed = (t: string) =>
    OPPOSITES.some(([a, b]) => (a === t && given.has(b)) || (b === t && given.has(a)));
  return [...new Set(extracted)]
    .filter((t) => REVIEW_TAGS.includes(t) && !given.has(t) && !opposed(t))
    .sort();
}

export function extractionRequest(
  input: ExtractionInput,
): StructuredRequest<typeof ExtractionOutputSchema> {
  const text = [
    `About: ${scrubNames(input.about, input.names)}`,
    `Tags the author chose: ${input.authorTags.length === 0 ? "none" : input.authorTags.join(", ")}`,
    "Comment:",
    scrubNames(input.comment, input.names),
  ].join("\n");
  return {
    schema: ExtractionOutputSchema,
    system: systemBlocks(),
    messages: [{ role: "user", content: text }],
    effort: EXTRACTION_EFFORT,
  };
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export async function extractReviewTags(
  deps: ExtractionDeps,
  input: ExtractionInput,
): Promise<ExtractionResult> {
  if (deps.model === null)
    return { status: "disabled", reason: deps.disabledReason ?? EXTRACTION_DISABLED_REASON };
  const request = extractionRequest(input);
  const requestSummary = asJson({
    model: deps.model.model,
    effort: EXTRACTION_EFFORT,
    maxTokens: MAX_OUTPUT_TOKENS,
    authorTags: input.authorTags,
    commentLength: input.comment.length,
  });
  try {
    const result = await deps.model.parse(request);
    const tags = newTags(result.output.tags, input.authorTags);
    const generationId = await deps.recordGeneration({
      purpose: "comment_extraction",
      model: result.servedModel,
      requestSummary,
      responseRaw: asJson({ messageId: result.messageId, output: result.output, kept: tags }),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      stopReason: result.stopReason,
      validationErrors: null,
    });
    return { status: "extracted", tags, generationId };
  } catch (error) {
    if (!(error instanceof ClaudeCallError)) throw error;
    const generationId = await deps.recordGeneration({
      purpose: "comment_extraction",
      model: error.servedModel ?? deps.model.model,
      requestSummary,
      responseRaw: asJson({
        error: error.code,
        message: error.message,
        content: error.responseContent ?? null,
      }),
      inputTokens: error.usage?.inputTokens ?? 0,
      outputTokens: error.usage?.outputTokens ?? 0,
      cacheReadTokens: error.usage?.cacheReadTokens ?? 0,
      stopReason: error.stopReason ?? error.code,
      validationErrors: null,
    });
    return { status: "failed", code: error.code, message: error.message, generationId };
  }
}
