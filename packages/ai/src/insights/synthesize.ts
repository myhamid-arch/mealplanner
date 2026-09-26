// FBK-7 stage 2: LLM synthesis over the rule candidates and the unprocessed reviews, through
// 1.3.1's structured client. One call, one `ai_generation` record (DM-7), every proposal
// validated locally and every drop logged (leaf-1.3.3 ADR-2).
import type { SynthesisInput, SynthesisResult } from "@mealplanner/core/learning/rules";
import {
  ClaudeCallError,
  MAX_OUTPUT_TOKENS,
  createClaudeClient,
  resolveClaudeConfig,
  type StructuredModel,
} from "../client/index.js";
import { evidenceIds, knownIds, pseudonyms, synthesisContext } from "./context.js";
import { INSIGHTS_EFFORT, buildSynthesisRequest } from "./prompt.js";
import { validateProposals } from "./validate.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** One `ai_generation` row (DM-7). No credentials and no system text. */
export interface InsightsGenerationRecord {
  purpose: "insights";
  /** The model requested. */
  model: string;
  requestSummary: Json;
  responseRaw: Json;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  validationErrors: Json | null;
}

export interface SynthesisDeps {
  /** null when synthesis is disabled (no credential). */
  model: StructuredModel | null;
  /** Why the model is null. */
  disabledReason?: string;
  /** Writes one ai_generation row and returns its id (DM-7). */
  recordGeneration(record: InsightsGenerationRecord): Promise<string>;
}

export const INSIGHTS_DISABLED_REASON =
  "insight synthesis is disabled: no Anthropic credential is configured (set ANTHROPIC_API_KEY)";

/**
 * The synthesis model for an environment (1.3.1's config and client), or null with the reason
 * when there is no credential: synthesis is then reported disabled, never silently skipped.
 */
export function resolveInsightsModel(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: Parameters<typeof createClaudeClient>[1] = {},
): { model: StructuredModel | null; disabledReason?: string } {
  const config = resolveClaudeConfig(env);
  if (!config.enabled) return { model: null, disabledReason: INSIGHTS_DISABLED_REASON };
  return { model: createClaudeClient(config, options) };
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export async function synthesizeInsights(
  deps: SynthesisDeps,
  input: SynthesisInput,
): Promise<SynthesisResult> {
  const { model } = deps;
  if (model === null)
    return {
      status: "disabled",
      reason: deps.disabledReason ?? INSIGHTS_DISABLED_REASON,
      proposals: [],
      dropped: [],
      generationId: null,
    };

  const names = pseudonyms(input);
  const context = synthesisContext(input, names);
  const request = buildSynthesisRequest(context);
  const requestSummary = asJson({
    model: model.model,
    effort: INSIGHTS_EFFORT,
    maxTokens: MAX_OUTPUT_TOKENS,
    candidates: input.candidates.length,
    notes: input.notes.length,
    reviews: input.reviews.length,
    rejected: input.rejected.length,
    context,
  });

  let result;
  try {
    result = await model.parse(request);
  } catch (error) {
    if (!(error instanceof ClaudeCallError)) throw error;
    const generationId = await deps.recordGeneration({
      purpose: "insights",
      model: model.model,
      requestSummary,
      responseRaw: asJson({
        error: error.code,
        message: error.message,
        servedModel: error.servedModel ?? null,
        content: error.responseContent ?? null,
      }),
      inputTokens: error.usage?.inputTokens ?? 0,
      outputTokens: error.usage?.outputTokens ?? 0,
      cacheReadTokens: error.usage?.cacheReadTokens ?? 0,
      stopReason: error.stopReason ?? error.code,
      validationErrors: null,
    });
    return {
      status: "failed",
      code: error.code,
      message: error.message,
      proposals: [],
      dropped: [],
      generationId,
    };
  }

  const { proposals, dropped } = validateProposals(result.output.proposals, {
    pseudonyms: names,
    knownIds: knownIds(context, input),
    evidenceIds: evidenceIds(input),
  });
  const generationId = await deps.recordGeneration({
    purpose: "insights",
    model: model.model,
    requestSummary,
    responseRaw: asJson({
      messageId: result.messageId,
      servedModel: result.servedModel,
      content: result.content,
    }),
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    stopReason: result.stopReason,
    validationErrors: dropped.length === 0 ? null : asJson(dropped),
  });
  return { status: "ok", proposals, dropped, generationId, model: result.servedModel };
}
