// leaf-1.3.6 G1 (REC-2, W-11; ADR-1): the recipe output budget is sized from the dishes a call asks
// for and from the live measurement, the budget travels on the wire with an explicit timeout the
// SDK needs above its non-streaming ceiling, and a response cut at the budget is still a typed
// failure that saves nothing.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClaudeCallError,
  MAX_OUTPUT_TOKENS,
  MODEL_MAX_OUTPUT_TOKENS,
  createClaudeClient,
  nonStreamingTimeoutMs,
  outputBudget,
  resolveClaudeConfig,
} from "../../src/client/index.js";
import {
  RECIPE_TOKENS_PER_DISH,
  RecipeGenerationError,
  buildRecipeRequest,
  generateRecipes,
  recipeMaxTokens,
} from "../../src/recipes/index.js";
import { loadCatalogue, repoRoot } from "./support/catalogue.js";
import { batchFixture, batchResponse, recordedClient, wireFixture } from "./support/recorded.js";
import { f1DinnerRequest, libraryWithChicken, scenario } from "./support/scenario.js";

/** One measurement line of `docs/build/live/leaf-1.3.6-budget-measure-*.log`. */
type Measurement = { count: number; stop: string; out: number; file: string };

function measurements(): Measurement[] {
  const dir = join(repoRoot(), "docs/build/live");
  return readdirSync(dir)
    .filter((f) => /^leaf-1\.3\.6-budget-measure-.*\.log$/.test(f))
    .sort()
    .flatMap((file) =>
      readFileSync(join(dir, file), "utf8")
        .split("\n")
        .filter((line) => line.startsWith('{"count":'))
        .map((line) => ({ ...(JSON.parse(line) as Omit<Measurement, "file">), file })),
    );
}

const timeoutHeader = (maxTokens: number) =>
  String(Math.trunc(nonStreamingTimeoutMs(maxTokens) / 1000));

describe("G1 recipe budget (ADR-1)", () => {
  it("is 20 000 tokens per dish asked for, capped at the model's maximum output", () => {
    expect(RECIPE_TOKENS_PER_DISH).toBe(20_000);
    expect(recipeMaxTokens(1)).toBe(20_000);
    expect(recipeMaxTokens(3)).toBe(60_000);
    expect(recipeMaxTokens(5)).toBe(100_000);
    expect(recipeMaxTokens(7)).toBe(MODEL_MAX_OUTPUT_TOKENS);
    for (const bad of [0, -1, 1.5, Number.NaN])
      expect(() => recipeMaxTokens(bad)).toThrow(RangeError);
  });

  it("covers every live measurement at least twice over; the old fixed budget does not", () => {
    const all = measurements();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((m) => m.count === 3)).toBe(true);
    for (const m of all) {
      expect(m.stop, m.file).toBe("end_turn");
      expect(recipeMaxTokens(m.count), `${m.file} count ${String(m.count)}`).toBeGreaterThanOrEqual(
        2 * m.out,
      );
    }
    // Negative control: the fixed budget the live 1.3.1 G4 run hit is below a measured 3-dish output.
    expect(all.filter((m) => m.count === 3).some((m) => MAX_OUTPUT_TOKENS < m.out)).toBe(true);
  });

  it("the timeout follows the SDK's scaling, never below its 10-minute default", () => {
    expect(nonStreamingTimeoutMs(MAX_OUTPUT_TOKENS)).toBe(600_000);
    expect(nonStreamingTimeoutMs(60_000)).toBe(1_687_500);
    expect(nonStreamingTimeoutMs(MODEL_MAX_OUTPUT_TOKENS)).toBe(3_600_000);
    expect(() => outputBudget({ maxTokens: MODEL_MAX_OUTPUT_TOKENS + 1 })).toThrow(RangeError);
    expect(() => outputBudget({ maxTokens: 0 })).toThrow(RangeError);
    expect(outputBudget({})).toBe(MAX_OUTPUT_TOKENS);
  });
});

describe("G1 the budget on the wire", () => {
  it("a 3-dish request sends 60 000 with an explicit timeout, and parses the batch", async () => {
    const s = scenario([batchResponse(batchFixture("valid-batch"))]);
    const run = await generateRecipes(s.deps, f1DinnerRequest(undefined, { count: 3 }));
    expect(run.calls).toBe(1);
    const [sent] = s.recorder.requests;
    expect(sent?.body.max_tokens).toBe(60_000);
    expect(sent?.headers["x-stainless-timeout"]).toBe(timeoutHeader(60_000));
    expect(s.ports.records[0]?.requestSummary).toMatchObject({ call: 1, maxTokens: 60_000 });
  });

  it("the follow-up is sized by the replacements it asks for", async () => {
    const s = scenario(
      [
        batchResponse(batchFixture("defects-batch")),
        batchResponse(batchFixture("follow-up-batch")),
      ],
      { existingDishes: libraryWithChicken() },
    );
    const run = await generateRecipes(s.deps, f1DinnerRequest());
    expect(run.calls).toBe(2);
    const [first, second] = s.recorder.requests;
    expect(first?.body.max_tokens).toBe(recipeMaxTokens(3));
    const messages = second?.body.messages as { role: string; content: unknown }[];
    const last = messages.at(-1)?.content;
    const needed = Number(/Write (\d+) replacement/.exec(String(last))?.[1]);
    expect(needed).toBeGreaterThanOrEqual(1);
    expect(second?.body.max_tokens).toBe(recipeMaxTokens(needed));
    expect(second?.headers["x-stainless-timeout"]).toBe(timeoutHeader(recipeMaxTokens(needed)));
    expect(s.ports.records[1]?.requestSummary).toMatchObject({
      call: 2,
      maxTokens: recipeMaxTokens(needed),
    });
  });

  it("a caller without maxTokens keeps the 20 000 default (onboarding, reviews, insights)", async () => {
    const recorder = recordedClient([batchResponse(batchFixture("valid-batch"))], {
      maxRetries: 0,
    });
    const model = createClaudeClient(resolveClaudeConfig({ ANTHROPIC_API_KEY: "present" }), {
      anthropic: recorder.anthropic,
    });
    const req = buildRecipeRequest(loadCatalogue(), f1DinnerRequest().context, ["dinner"]);
    const plain = { ...req, maxTokens: undefined };
    await model?.parse(plain);
    expect(recorder.requests[0]?.body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(recorder.requests[0]?.headers["x-stainless-timeout"]).toBe("600");
  });

  it("negative control: without the explicit timeout the SDK refuses the 3-dish budget", () => {
    const recorder = recordedClient([batchResponse(batchFixture("valid-batch"))], {
      maxRetries: 0,
    });
    // The SDK checks the budget before sending anything (synchronously).
    const call = () =>
      recorder.anthropic.beta.messages.create({
        model: "m",
        max_tokens: recipeMaxTokens(3),
        messages: [{ role: "user", content: "x" }],
      });
    expect(call).toThrow(/Streaming is required/);
    expect(recorder.requests).toHaveLength(0);
  });
});

describe("G1 a response cut at the budget", () => {
  it("is a typed max_tokens failure naming the budget: recorded, nothing saved", async () => {
    const s = scenario([wireFixture("max-tokens")]);
    const error = await generateRecipes(s.deps, f1DinnerRequest(undefined, { count: 3 })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RecipeGenerationError);
    expect((error as RecipeGenerationError).code).toBe("model_call");
    const cause = (error as RecipeGenerationError).cause;
    expect(cause).toBeInstanceOf(ClaudeCallError);
    expect((cause as ClaudeCallError).code).toBe("max_tokens");
    expect((cause as ClaudeCallError).message).toContain("max_tokens (60000)");
    expect(s.ports.records).toHaveLength(1);
    expect(s.ports.records[0]).toMatchObject({
      stopReason: "max_tokens",
      requestSummary: { maxTokens: 60_000 },
    });
    expect(s.ports.saved).toHaveLength(0);
  });
});
