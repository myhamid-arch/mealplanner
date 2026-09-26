// The recipe generator (REC-2 … REC-6): one call, REC-5 validation, at most one append-only
// follow-up, an audit record per call (DM-7) and the survivors saved through a port (SPEC-Q-8).
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { DishForSolve } from "@mealplanner/core/planner/solver";
import {
  ClaudeCallError,
  MAX_OUTPUT_TOKENS,
  type StructuredModel,
  type StructuredRequest,
} from "../client/index.js";
import type { RecipeCatalogue } from "./catalogue.js";
import type { GenerationContext, SolveTarget } from "./context.js";
import { RecipeGenerationError } from "./errors.js";
import {
  RECIPE_EFFORT,
  buildFollowUpRequest,
  buildRecipeRequest,
  type RejectionNote,
} from "./prompt.js";
import type { DishBatchSchema } from "./schema.js";
import { validateBatch } from "./validate/pipeline.js";
import type { AcceptedDish, DishOutcome, ExistingDish, Reason } from "./validate/types.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** One `ai_generation` row (DM-7). No credentials, no system or catalogue text. */
export type AiGenerationRecord = {
  purpose: "recipe";
  /** The model requested. */
  model: string;
  requestSummary: Json;
  responseRaw: Json;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  validationErrors: Json | null;
};

export type RecipeGeneratorDeps = {
  /** null when generation is disabled (no credential; REC-2). */
  model: StructuredModel | null;
  /** Why the model is null, for the error the caller shows. */
  disabledReason?: string;
  catalogue: RecipeCatalogue;
  slotKeys: readonly string[];
  /** Active household and seed-library dishes, for duplication (REC-5 step 6). */
  existingDishes: readonly ExistingDish[];
  /** Adjuster dishes the household allows (PLN-6); empty when adjusters are off. */
  adjusters: readonly DishForSolve[];
  /** Writes one ai_generation row and returns its id (DM-7). */
  recordGeneration(record: AiGenerationRecord): Promise<string>;
  /** Saves the survivors in one change set with source `ai` (REC-5). */
  saveSurvivors(dishes: readonly SurvivingDish[], generationIds: readonly string[]): Promise<void>;
};

export type RecipeRequest = {
  context: GenerationContext;
  solveTargets: readonly SolveTarget[];
  /**
   * Pseudonymises household text in the follow-up's rejection reasons (an existing dish's name
   * can hold a member's name). `buildGenerationContext` returns it.
   */
  scrub: (text: string) => string;
};

export type SurvivingDish = AcceptedDish & {
  /** False for a dish kept in the library but infeasible for this slot's targets (step 7). */
  candidate: boolean;
  reasons: Reason[];
  /** 1 for the first call, 2 for the follow-up. */
  call: 1 | 2;
};

export type Rejection = { dishName: string; call: 1 | 2; reasons: Reason[] };

export type GenerationRun = {
  /** Survivors that are candidates for this slot. */
  candidates: SurvivingDish[];
  /** Survivors saved to the library but infeasible for this slot's targets. */
  infeasible: SurvivingDish[];
  rejected: Rejection[];
  generationIds: string[];
  calls: 1 | 2;
  /** The follow-up's failure, when it failed (the first call's survivors are still saved). */
  followUpError?: ClaudeCallError;
};

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function requestSummary(
  call: 1 | 2,
  model: string,
  request: RecipeRequest,
  messageCount: number,
): Json {
  return asJson({
    call,
    model,
    effort: RECIPE_EFFORT,
    maxTokens: MAX_OUTPUT_TOKENS,
    messages: messageCount,
    context: request.context,
  });
}

function validationErrors(outcomes: readonly DishOutcome[]): Json | null {
  const rows = outcomes.flatMap((o) =>
    o.status === "candidate"
      ? []
      : o.reasons.map((r) => ({ dish: o.dish.name, status: o.status, ...r })),
  );
  return rows.length === 0 ? null : asJson(rows);
}

export async function generateRecipes(
  deps: RecipeGeneratorDeps,
  request: RecipeRequest,
): Promise<GenerationRun> {
  const { model } = deps;
  if (model === null)
    throw new RecipeGenerationError(
      "disabled",
      deps.disabledReason ?? "AI recipe generation is disabled",
    );
  const env = {
    catalogue: deps.catalogue,
    slotKeys: deps.slotKeys,
    slot: request.context.slot,
    exclusions: request.context.exclusions,
    existingDishes: deps.existingDishes,
    solveTargets: request.solveTargets,
    adjusters: deps.adjusters,
  };
  const generationIds: string[] = [];

  const record = async (
    call: 1 | 2,
    req: StructuredRequest<typeof DishBatchSchema>,
    result:
      | {
          ok: true;
          content: BetaContentBlock[];
          usage: ClaudeCallError["usage"];
          stopReason: string;
          outcomes: DishOutcome[];
          servedModel: string;
        }
      | { ok: false; error: ClaudeCallError },
  ) => {
    const base = {
      purpose: "recipe" as const,
      model: model.model,
      requestSummary: requestSummary(call, model.model, request, req.messages.length),
    };
    const rec: AiGenerationRecord = result.ok
      ? {
          ...base,
          responseRaw: asJson({ servedModel: result.servedModel, content: result.content }),
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          cacheReadTokens: result.usage?.cacheReadTokens ?? 0,
          stopReason: result.stopReason,
          validationErrors: validationErrors(result.outcomes),
        }
      : {
          ...base,
          responseRaw: asJson({
            error: { code: result.error.code, message: result.error.message },
            status: result.error.status ?? null,
            requestId: result.error.requestId ?? null,
            servedModel: result.error.servedModel ?? null,
            stopDetails: result.error.stopDetails,
            content: result.error.responseContent ?? null,
          }),
          inputTokens: result.error.usage?.inputTokens ?? 0,
          outputTokens: result.error.usage?.outputTokens ?? 0,
          cacheReadTokens: result.error.usage?.cacheReadTokens ?? 0,
          stopReason: result.error.stopReason ?? result.error.code,
          validationErrors: null,
        };
    try {
      generationIds.push(await deps.recordGeneration(rec));
    } catch (error) {
      throw new RecipeGenerationError(
        "record_failed",
        "the ai_generation record could not be written",
        {
          cause: error,
        },
      );
    }
  };

  const callModel = async (call: 1 | 2, req: StructuredRequest<typeof DishBatchSchema>) => {
    try {
      return { ok: true as const, result: await model.parse(req) };
    } catch (error) {
      if (!(error instanceof ClaudeCallError)) throw error;
      await record(call, req, { ok: false, error });
      return { ok: false as const, error };
    }
  };

  const survivors: SurvivingDish[] = [];
  const rejected: Rejection[] = [];
  const collect = (call: 1 | 2, outcomes: readonly DishOutcome[]) => {
    for (const o of outcomes) {
      if (o.status === "rejected")
        rejected.push({ dishName: o.dish.name, call, reasons: o.reasons });
      else
        survivors.push({
          dish: o.dish,
          newIngredients: o.newIngredients,
          nutrition: o.nutrition,
          coreIngredients: o.coreIngredients,
          plates: o.plates,
          candidate: o.status === "candidate",
          reasons: o.status === "infeasible" ? o.reasons : [],
          call,
        });
    }
  };

  // First call.
  const first = buildRecipeRequest(deps.catalogue, request.context, deps.slotKeys);
  const one = await callModel(1, first);
  if (!one.ok)
    throw new RecipeGenerationError(
      "model_call",
      `recipe generation failed: ${one.error.message}`,
      {
        cause: one.error,
      },
    );
  const outcomes1 = await validateBatch(one.result.output, env);
  await record(1, first, {
    ok: true,
    content: one.result.content,
    usage: one.result.usage,
    stopReason: one.result.stopReason,
    outcomes: outcomes1,
    servedModel: one.result.servedModel,
  });
  collect(1, outcomes1);

  // At most one follow-up, appended to the same conversation (REC-5).
  let calls: 1 | 2 = 1;
  let followUpError: ClaudeCallError | undefined;
  const needed = request.context.count - survivors.length;
  if (needed > 0) {
    calls = 2;
    const notes: RejectionNote[] = rejected.map((r) => ({
      dishName: request.scrub(r.dishName),
      reasons: r.reasons.map((x) => request.scrub(x.message)),
    }));
    const returned = one.result.output.dishes.length;
    if (returned < request.context.count)
      notes.push({
        dishName: "(batch)",
        reasons: [
          `${String(returned)} of the ${String(request.context.count)} requested dishes were returned`,
        ],
      });
    const second = buildFollowUpRequest(first, one.result.content, notes, needed);
    const two = await callModel(2, second);
    if (two.ok) {
      const outcomes2 = await validateBatch(
        two.result.output,
        env,
        survivors.map((s) => ({ name: s.dish.name, coreIngredients: s.coreIngredients })),
      );
      await record(2, second, {
        ok: true,
        content: two.result.content,
        usage: two.result.usage,
        stopReason: two.result.stopReason,
        outcomes: outcomes2,
        servedModel: two.result.servedModel,
      });
      collect(2, outcomes2);
    } else {
      followUpError = two.error;
    }
  }

  if (survivors.length > 0) {
    try {
      await deps.saveSurvivors(survivors, generationIds);
    } catch (error) {
      throw new RecipeGenerationError("save_failed", "the generated dishes could not be saved", {
        cause: error,
      });
    }
  }

  return {
    candidates: survivors.filter((s) => s.candidate),
    infeasible: survivors.filter((s) => !s.candidate),
    rejected,
    generationIds,
    calls,
    ...(followUpError === undefined ? {} : { followUpError }),
  };
}
