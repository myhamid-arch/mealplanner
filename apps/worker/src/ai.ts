// Wiring of the Claude-backed services (R-2): the recipe generator (1.3.1) through its persistence
// ports (`ai_generation` rows, survivors saved as a change set), used by plan generation in `auto`
// mode (PLN-12), by `recipe.generate` and by `recipe.revise`; and insight synthesis (1.3.3). With
// no credential, or over the household's daily dish limit (ARC-6), generation is not attempted
// and the reason is returned, never silently skipped (REC-2).
import {
  coreIngredientSlugs,
  generateRecipes,
  buildGenerationContext,
  type GeneratedComponent,
  type GenerationRun,
  type RecipeCatalogue,
  type SurvivingDish,
} from "@mealplanner/ai/recipes";
import { synthesizeInsights, INSIGHTS_DISABLED_REASON } from "@mealplanner/ai/insights";
import type { Synthesize } from "@mealplanner/core/learning/rules";
import type { MethodKey } from "@mealplanner/core/nutrition";
import type { PlanDish } from "@mealplanner/core/planner";
import type { HouseholdConfig, HouseholdContext, Json } from "@mealplanner/core/types";
import {
  aiDishesToday,
  loadDbCatalog,
  recomputeNutrition,
  recordAiGeneration,
  saveGeneratedDishes,
  toPlanDishes,
  type ChangeActorInput,
  type DbCatalog,
  type PlanPool,
} from "@mealplanner/db/services/plans";
import { dish } from "@mealplanner/db/schema";
import { inArray } from "drizzle-orm";
import type { WorkerRuntime } from "./runtime.js";

/** The generator's catalogue from the database, with the R-22 factors from the data file. */
export function recipeCatalogue(rt: WorkerRuntime, catalog: DbCatalog): RecipeCatalogue {
  return {
    ingredients: [...catalog.ingredients.values()]
      .filter((i) => !i.needsReview)
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((i) => ({
        slug: i.slug,
        name: i.name,
        category: i.category,
        per100gRaw: i.per100gRaw,
        dietaryFlags: i.dietaryFlags,
        atwaterFactors: rt.factorsBySlug.get(i.slug) ?? null,
      })),
    methods: [...catalog.methodIdByKey.keys()].sort() as MethodKey[],
    cuisines: [...catalog.cuisineIdByKey.keys()].sort(),
    methodYields: catalog.methodYields,
  };
}

/** REC-5 step 6: existing dishes by name and core ingredients (the generator's own rule). */
function existingDishes(pool: readonly PlanDish[], catalog: DbCatalog) {
  const categoryOf = (slug: string) =>
    catalog.ingredients.get(catalog.idBySlug.get(slug) ?? "")?.category;
  return pool
    .filter((d) => d.status === "active")
    .map((d) => {
      const components = d.components.map((c) => ({
        variants: c.variants.map((v) => ({
          isDefault: v.isDefault,
          ingredients: v.input.ingredients.map((l) => ({
            slug: catalog.ingredients.get(l.ingredientId)?.slug ?? l.ingredientId,
            rawGramsPerBatch: l.rawG,
            isAbsorbedFat: l.isAbsorbedOil,
          })),
        })),
      })) as unknown as GeneratedComponent[];
      return { name: d.name, coreIngredients: coreIngredientSlugs(components, categoryOf) };
    });
}

export type GenerationOutcome =
  | { status: "generated"; run: GenerationRun; dishIds: string[]; candidateIds: string[] }
  | { status: "unavailable"; reason: string };

export interface GenerateArgs {
  config: HouseholdConfig;
  pool: PlanPool;
  date: string;
  slotKey: string;
  count: number;
  palette?: { slug: string; timesUsed: number }[];
  avoidRecentCuisines?: string[];
  avoidDishes?: string[];
  adminRequest?: string;
  by: ChangeActorInput;
  /** Save the survivors (plans, `recipe.generate`); false returns them only (`recipe.revise`). */
  save: boolean;
}

/** Runs the recipe generator for one slot (REC-2 … REC-6) through the database ports. */
export async function generateDishes(
  rt: WorkerRuntime,
  ctx: HouseholdContext,
  args: GenerateArgs,
): Promise<GenerationOutcome & { survivors: SurvivingDish[] }> {
  if (rt.model === null)
    return {
      status: "unavailable",
      reason: rt.modelDisabledReason ?? "AI recipe generation is disabled",
      survivors: [],
    };
  const used = await aiDishesToday(rt.db, ctx, args.config.household.timezone);
  if (args.save && used + args.count > rt.env.aiRecipeDailyLimit)
    return {
      status: "unavailable",
      reason: `the household's daily AI recipe limit (${String(rt.env.aiRecipeDailyLimit)}) is reached`,
      survivors: [],
    };
  const catalog = args.pool.catalog;
  const { context, solveTargets, scrub } = buildGenerationContext({
    config: args.config,
    date: args.date,
    slotKey: args.slotKey,
    count: args.count,
    ...(args.palette === undefined ? {} : { palette: args.palette }),
    ...(args.avoidRecentCuisines === undefined
      ? {}
      : { avoidRecentCuisines: args.avoidRecentCuisines }),
    ...(args.avoidDishes === undefined ? {} : { avoidDishes: args.avoidDishes }),
    ...(args.adminRequest === undefined ? {} : { adminRequest: args.adminRequest }),
  });
  const disabled = new Set(args.config.adjusters.filter((a) => !a.enabled).map((a) => a.dishId));
  let saved: string[] = [];
  let survivors: SurvivingDish[] = [];
  const run = await generateRecipes(
    {
      model: rt.model,
      catalogue: recipeCatalogue(rt, catalog),
      slotKeys: args.config.slotTypes.filter((s) => s.active).map((s) => s.key),
      existingDishes: existingDishes(args.pool.dishes, catalog),
      adjusters: args.config.planningWeights.adjustersEnabled
        ? args.pool.adjusters.filter((a) => !disabled.has(a.id))
        : [],
      recordGeneration: (record) => recordAiGeneration(rt.db, ctx, record),
      saveSurvivors: async (dishes, generationIds) => {
        survivors = [...dishes];
        if (!args.save) return;
        saved = await saveGeneratedDishes(rt.db, ctx, {
          survivors: dishes.map((s) => ({
            dish: s.dish,
            newIngredients: s.newIngredients,
            call: s.call,
          })),
          generationIds,
          catalog,
          by: args.by,
        });
      },
    },
    { context, solveTargets, scrub },
  );
  if (saved.length > 0)
    await recomputeNutrition(rt.db, {
      householdId: ctx.householdId,
      factorsBySlug: rt.factorsBySlug,
    });
  const candidateIds = survivors.flatMap((s, i) =>
    s.candidate && saved[i] !== undefined ? [saved[i]] : [],
  );
  return { status: "generated", run, dishIds: saved, candidateIds, survivors };
}

/** PLN-12 `auto`: the planner's `requestDishes` port; progress and outcome become job events. */
export function requestDishesFor(
  rt: WorkerRuntime,
  ctx: HouseholdContext,
  config: HouseholdConfig,
  by: ChangeActorInput,
  emit: (type: string, payload: Json) => void,
) {
  return async (
    request: {
      date: string;
      slotKey: string;
      count: number;
      palette: { slug: string; timesUsed: number }[];
      avoidRecentCuisines: string[];
      avoidDishes: string[];
      reason: string;
    },
    pool: PlanPool,
  ): Promise<PlanDish[]> => {
    const outcome = await generateDishes(rt, ctx, {
      config,
      pool,
      date: request.date,
      slotKey: request.slotKey,
      count: request.count,
      palette: request.palette,
      avoidRecentCuisines: request.avoidRecentCuisines,
      avoidDishes: request.avoidDishes,
      by,
      save: true,
    });
    if (outcome.status === "unavailable") {
      emit("ai_unavailable", {
        date: request.date,
        slotKey: request.slotKey,
        reason: outcome.reason,
      });
      return [];
    }
    emit("ai_generated", {
      date: request.date,
      slotKey: request.slotKey,
      saved: outcome.dishIds.length,
      candidates: outcome.candidateIds.length,
      rejected: outcome.run.rejected.length,
    });
    if (outcome.candidateIds.length === 0) return [];
    const catalog = await loadDbCatalog(rt.db, ctx.householdId);
    const rows = await rt.db.select().from(dish).where(inArray(dish.id, outcome.candidateIds));
    const dishes = await toPlanDishes(rt.db, rows, catalog);
    for (const d of dishes) pool.byId.set(d.id, d);
    return dishes;
  };
}

/** FBK-7 stage 2 for one household: synthesis with the DM-7 audit row. */
export function synthesizeFor(rt: WorkerRuntime, ctx: HouseholdContext): Synthesize {
  return (input) =>
    synthesizeInsights(
      {
        model: rt.model,
        disabledReason: rt.model === null ? INSIGHTS_DISABLED_REASON : undefined,
        recordGeneration: (record) => recordAiGeneration(rt.db, ctx, record),
      },
      input,
    );
}
