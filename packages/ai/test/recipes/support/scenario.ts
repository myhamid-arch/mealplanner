// F1 dinner generation scenarios with in-memory ports (the db side is 1.4.1's; SPEC-Q-8).
import type { HouseholdConfig } from "@mealplanner/core/types";
import { createClaudeClient, resolveClaudeConfig } from "../../../src/client/index.js";
import {
  buildGenerationContext,
  coreIngredientSlugs,
  type AiGenerationRecord,
  type ExistingDish,
  type GeneratedDish,
  type RecipeGeneratorDeps,
  type RecipeRequest,
  type SurvivingDish,
} from "../../../src/recipes/index.js";
import { loadCatalogue } from "./catalogue.js";
import { F1_DINNER_DATE, f1Config } from "./household.js";
import { batchFixture, recordedClient, type RecordedResponse, type Recorder } from "./recorded.js";

export type Ports = {
  records: AiGenerationRecord[];
  saved: Array<{ dishes: SurvivingDish[]; generationIds: string[] }>;
  recordGeneration: RecipeGeneratorDeps["recordGeneration"];
  saveSurvivors: RecipeGeneratorDeps["saveSurvivors"];
};

export function memoryPorts(): Ports {
  const records: AiGenerationRecord[] = [];
  const saved: Ports["saved"] = [];
  return {
    records,
    saved,
    recordGeneration: (record) => {
      records.push(record);
      return Promise.resolve(`gen-${String(records.length)}`);
    },
    saveSurvivors: (dishes, generationIds) => {
      saved.push({ dishes: [...dishes], generationIds: [...generationIds] });
      return Promise.resolve();
    },
  };
}

/** The core-ingredient key of a dish the way the caller computes it for existing dishes. */
export function existingFrom(dish: GeneratedDish): ExistingDish {
  const catalogue = loadCatalogue();
  const category = new Map<string, string>(catalogue.ingredients.map((i) => [i.slug, i.category]));
  return {
    name: dish.name,
    coreIngredients: coreIngredientSlugs(dish.components, (slug) => category.get(slug)),
  };
}

/** The library dish that the defects batch duplicates (the first valid dish). */
export function libraryWithChicken(): ExistingDish[] {
  const chicken = batchFixture("valid-batch").dishes[0];
  if (chicken === undefined) throw new Error("valid-batch has no dishes");
  return [existingFrom(chicken)];
}

export function f1DinnerRequest(
  config: HouseholdConfig = f1Config(),
  extra: { adminRequest?: string; count?: number; date?: string; slotKey?: string } = {},
): RecipeRequest {
  return buildGenerationContext({
    config,
    date: extra.date ?? F1_DINNER_DATE,
    slotKey: extra.slotKey ?? "dinner",
    ...(extra.count === undefined ? {} : { count: extra.count }),
    ...(extra.adminRequest === undefined ? {} : { adminRequest: extra.adminRequest }),
  });
}

export type Scenario = { deps: RecipeGeneratorDeps; ports: Ports; recorder: Recorder };

export function scenario(
  responses: readonly RecordedResponse[],
  options: { existingDishes?: ExistingDish[]; config?: HouseholdConfig; maxRetries?: number } = {},
): Scenario {
  const recorder = recordedClient(
    responses,
    options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries },
  );
  const ports = memoryPorts();
  const config = options.config ?? f1Config();
  const model = createClaudeClient(resolveClaudeConfig({ ANTHROPIC_API_KEY: "present" }), {
    anthropic: recorder.anthropic,
  });
  return {
    recorder,
    ports,
    deps: {
      model,
      catalogue: loadCatalogue(),
      slotKeys: config.slotTypes.filter((s) => s.active).map((s) => s.key),
      existingDishes: options.existingDishes ?? [],
      adjusters: [],
      recordGeneration: ports.recordGeneration,
      saveSurvivors: ports.saveSurvivors,
    },
  };
}
