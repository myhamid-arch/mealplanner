// G3 (REC-2, REC-5 step 1): refusal, max_tokens and null-parse paths, and API failures, end in
// typed errors; stop_reason is checked before any content is read; nothing fails silently.
import { describe, expect, it } from "vitest";
import {
  ClaudeCallError,
  DEFAULT_MODEL,
  FALLBACK_BETA,
  MAX_OUTPUT_TOKENS,
  createClaudeClient,
  resolveClaudeConfig,
  type ClaudeCallErrorCode,
} from "../../src/client/index.js";
import {
  RecipeGenerationError,
  buildRecipeRequest,
  generateRecipes,
} from "../../src/recipes/index.js";
import { loadCatalogue } from "./support/catalogue.js";
import { batchFixture, batchResponse, recordedClient, wireFixture } from "./support/recorded.js";
import { f1DinnerRequest, scenario } from "./support/scenario.js";

function modelWith(responses: Parameters<typeof recordedClient>[0], maxRetries = 0) {
  const recorder = recordedClient(responses, { maxRetries });
  const model = createClaudeClient(resolveClaudeConfig({ ANTHROPIC_API_KEY: "present" }), {
    anthropic: recorder.anthropic,
  });
  if (model === null) throw new Error("model disabled");
  return { model, recorder };
}

function request() {
  const { context } = f1DinnerRequest();
  return buildRecipeRequest(loadCatalogue(), context, ["breakfast", "dinner", "lunch"]);
}

async function failure(promise: Promise<unknown>): Promise<ClaudeCallError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ClaudeCallError) return error;
    throw new Error(`expected a ClaudeCallError, got ${String(error)}`, { cause: error });
  }
  throw new Error("expected the call to fail");
}

describe("G3 request shape (REC-2)", () => {
  it("sends adaptive thinking, effort high, the Zod output format and the fallback beta", async () => {
    const { model, recorder } = modelWith([batchResponse(batchFixture("valid-batch"))]);
    const result = await model.parse(request());
    expect(result.output.dishes).toHaveLength(3);
    const [sent] = recorder.requests;
    expect(sent?.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(sent?.headers["anthropic-beta"]?.split(",")).toEqual(
      expect.arrayContaining([FALLBACK_BETA, "structured-outputs-2025-12-15"]),
    );
    expect(sent?.body).toMatchObject({
      model: DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema" } },
    });
    expect(sent?.body).not.toHaveProperty("betas");
    const schema = (sent?.body.output_config as { format: { schema: { properties: object } } })
      .format.schema;
    expect(Object.keys(schema.properties).sort()).toEqual(["dishes", "newIngredients"]);
  });

  it("uses ANTHROPIC_MODEL when set, the default otherwise, and is disabled without credentials", () => {
    expect(resolveClaudeConfig({ ANTHROPIC_API_KEY: "x" })).toEqual({
      enabled: true,
      model: DEFAULT_MODEL,
    });
    expect(
      resolveClaudeConfig({ ANTHROPIC_API_KEY: "x", ANTHROPIC_MODEL: " claude-opus-5 " }),
    ).toEqual({
      enabled: true,
      model: "claude-opus-5",
    });
    expect(resolveClaudeConfig({ ANTHROPIC_AUTH_TOKEN: "t" }).enabled).toBe(true);
    expect(resolveClaudeConfig({ ANTHROPIC_PROFILE: "work" }).enabled).toBe(true);
    const wif = {
      ANTHROPIC_FEDERATION_RULE_ID: "r",
      ANTHROPIC_ORGANIZATION_ID: "o",
      ANTHROPIC_SERVICE_ACCOUNT_ID: "s",
    };
    expect(resolveClaudeConfig(wif).enabled).toBe(false);
    expect(resolveClaudeConfig({ ...wif, ANTHROPIC_IDENTITY_TOKEN: "jwt" }).enabled).toBe(true);
    const off = resolveClaudeConfig({ ANTHROPIC_API_KEY: "  " });
    expect(off.enabled).toBe(false);
    expect(off.enabled ? "" : off.reason).toContain("ANTHROPIC_API_KEY");
    expect(createClaudeClient(off)).toBeNull();
  });
});

describe("G3 stop reasons and parse-null (REC-2, REC-5 step 1)", () => {
  const cases: Array<[string, ClaudeCallErrorCode, string]> = [
    ["refusal", "refusal", "refusal"],
    ["max-tokens", "max_tokens", "max_tokens"],
    ["schema-mismatch", "parse_null", "end_turn"],
    ["no-text", "parse_null", "end_turn"],
  ];
  for (const [fixture, code, stopReason] of cases) {
    it(`${fixture} → ClaudeCallError("${code}")`, async () => {
      const { model } = modelWith([wireFixture(fixture)]);
      const error = await failure(model.parse(request()));
      expect(error.code).toBe(code);
      expect(error.stopReason).toBe(stopReason);
      expect(error.usage?.cacheReadTokens).toBe(14000);
      expect(error.servedModel).toBe(DEFAULT_MODEL);
      expect(error.responseContent).toBeDefined();
    });
  }

  it("keeps the refusal details", async () => {
    const { model } = modelWith([wireFixture("refusal")]);
    const error = await failure(model.parse(request()));
    expect(error.stopDetails).toEqual({
      category: "general_harms",
      explanation: "The request was declined by a safety classifier.",
    });
    expect(error.message).toContain("general_harms");
  });

  it("names the schema problem on a parse-null", async () => {
    const { model } = modelWith([wireFixture("schema-mismatch")]);
    const error = await failure(model.parse(request()));
    expect(error.message).toMatch(/did not match the schema/);
    const empty = await failure(modelWith([wireFixture("no-text")]).model.parse(request()));
    expect(empty.message).toBe("the response carried no structured output");
  });
});

describe("G3 API errors map to typed errors (REC-2)", () => {
  const cases: Array<[string, ClaudeCallErrorCode, number | undefined]> = [
    ["rate-limit", "rate_limited", 429],
    ["server-error", "server", 500],
    ["overloaded", "server", 529],
    ["authentication", "authentication", 401],
    ["permission", "permission", 403],
    ["bad-request", "bad_request", 400],
  ];
  for (const [fixture, code, status] of cases) {
    it(`${fixture} → ClaudeCallError("${code}")`, async () => {
      const { model } = modelWith([wireFixture(fixture)]);
      const error = await failure(model.parse(request()));
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(error.requestId).toBeDefined();
    });
  }

  it("maps a network failure to connection", async () => {
    const { model } = modelWith([{ networkError: "socket hang up" }]);
    const error = await failure(model.parse(request()));
    expect(error.code).toBe("connection");
  });

  it("retries 429 and 5xx with the SDK default of 2 retries", async () => {
    const { model, recorder } = modelWith(
      [
        wireFixture("rate-limit"),
        wireFixture("server-error"),
        batchResponse(batchFixture("valid-batch")),
      ],
      2,
    );
    const result = await model.parse(request());
    expect(result.output.dishes).toHaveLength(3);
    expect(recorder.requests).toHaveLength(3);
    const exhausted = modelWith(
      [wireFixture("rate-limit"), wireFixture("rate-limit"), wireFixture("rate-limit")],
      2,
    );
    expect((await failure(exhausted.model.parse(request()))).code).toBe("rate_limited");
    expect(exhausted.recorder.requests).toHaveLength(3);
  });
});

describe("G3 the generator surfaces failures (no silent failure)", () => {
  it("throws RecipeGenerationError('disabled') without a model", async () => {
    const s = scenario([]);
    const deps = { ...s.deps, model: null, disabledReason: "no credential" };
    await expect(generateRecipes(deps, f1DinnerRequest())).rejects.toMatchObject({
      name: "RecipeGenerationError",
      code: "disabled",
      message: "no credential",
    });
    expect(s.recorder.requests).toHaveLength(0);
  });

  for (const fixture of ["refusal", "max-tokens", "schema-mismatch"]) {
    it(`records the failed call and throws model_call on ${fixture}`, async () => {
      const s = scenario([wireFixture(fixture)]);
      const run = generateRecipes(s.deps, f1DinnerRequest());
      const error = await run.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RecipeGenerationError);
      expect((error as RecipeGenerationError).code).toBe("model_call");
      expect((error as RecipeGenerationError).cause).toBeInstanceOf(ClaudeCallError);
      expect(s.ports.records).toHaveLength(1);
      expect(s.ports.records[0]?.stopReason).toBe(
        fixture === "refusal" ? "refusal" : fixture === "max-tokens" ? "max_tokens" : "end_turn",
      );
      expect(s.ports.saved).toHaveLength(0);
    });
  }

  it("keeps the first call's survivors when the follow-up fails", async () => {
    const defects = batchFixture("defects-batch");
    const s = scenario([batchResponse(defects), wireFixture("max-tokens")]);
    const run = await generateRecipes(s.deps, f1DinnerRequest(undefined, { count: 5 }));
    expect(run.calls).toBe(2);
    expect(run.followUpError?.code).toBe("max_tokens");
    expect(s.ports.records).toHaveLength(2);
    expect(s.ports.saved).toHaveLength(1);
  });

  it("fails loudly when the audit record or the save fails", async () => {
    const s = scenario([batchResponse(batchFixture("valid-batch"))]);
    const noRecord = { ...s.deps, recordGeneration: () => Promise.reject(new Error("db down")) };
    await expect(generateRecipes(noRecord, f1DinnerRequest())).rejects.toMatchObject({
      code: "record_failed",
    });
    const t = scenario([batchResponse(batchFixture("valid-batch"))]);
    const noSave = { ...t.deps, saveSurvivors: () => Promise.reject(new Error("db down")) };
    await expect(generateRecipes(noSave, f1DinnerRequest())).rejects.toMatchObject({
      code: "save_failed",
    });
  });
});
