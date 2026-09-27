// The recipe generator's persistence ports (leaf-1.3.1 SPEC-Q-8, R-2): one `ai_generation` row per
// Claude call (DM-7) and the surviving dishes saved in one change set with `dish.source = ai`
// (REC-5), with their model-proposed ingredients as unverified household ingredients (NUT-7). The
// generator itself (`@mealplanner/ai/recipes`) is composed with these in `apps/worker`; the types
// here are structural so `db` does not import `ai` (ARC-3). Also the ARC-6 daily dish limit.
import { and, eq, gte, sql } from "drizzle-orm";
import type { ChangeOp } from "@mealplanner/core/changes";
import type { HouseholdContext, Json } from "@mealplanner/core/types";
import { createWriteRepos, type Executor } from "../../repos/index.js";
import { aiGeneration, dish } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";
import { applyChangeSet } from "../changes/index.js";
import type { DbCatalog } from "./catalog.js";
import type { ChangeActorInput } from "./store.js";
import { PlanServiceError } from "./errors.js";

/** ARC-6: AI recipe generation, dishes per household per day (env `AI_RECIPE_DAILY_LIMIT`). */
export const DEFAULT_AI_RECIPE_DAILY_LIMIT = 60;

export interface AiGenerationInput {
  purpose: "recipe" | "insights" | "chat" | "comment_extraction";
  model: string;
  requestSummary: Json;
  responseRaw: Json;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  validationErrors: Json | null;
}

/** DM-7: writes one audit row (never credentials: the record carries none) and returns its id. */
export async function recordAiGeneration(
  db: Executor,
  ctx: HouseholdContext,
  record: AiGenerationInput,
  now: Date = new Date(),
): Promise<string> {
  const id = newId();
  await createWriteRepos(db, ctx).ai_generation.insert({
    id,
    householdId: ctx.householdId,
    ...record,
    createdAt: now,
  });
  return id;
}

/** REC-4's dish, structurally (the generator's `GeneratedDish`). */
export interface GeneratedDishInput {
  name: string;
  description: string;
  cuisine: string;
  secondaryCuisine?: string | undefined;
  slotKeys: string[];
  flavourTags: string[];
  isPackable: boolean;
  servedColdOk: boolean;
  assemblySteps: string[];
  components: Array<{
    name: string;
    role: "protein" | "carb" | "vegetable" | "sauce" | "fat" | "garnish" | "side" | "drink";
    portioning: "continuous" | "unit" | "fixed";
    unitLabel?: string | undefined;
    minServingG: number;
    maxServingG: number;
    defaultServingG: number;
    required: boolean;
    variants: Array<{
      method: string;
      label: string;
      isDefault: boolean;
      ingredients: Array<{
        slug: string;
        rawGramsPerBatch: number;
        isAbsorbedFat: boolean;
        note?: string | undefined;
      }>;
      steps: string[];
      cookTimeMin: number;
    }>;
  }>;
}

export interface NewIngredientInput {
  slug: string;
  name: string;
  category: string;
  per100g: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    satFat: number;
    fibre: number;
    solubleFibre: number | null;
  };
  sourceNote: string;
}

export interface SurvivorInput {
  dish: GeneratedDishInput;
  newIngredients: NewIngredientInput[];
  /** 1 for the first call, 2 for the follow-up: which generation row produced it. */
  call: 1 | 2;
}

const GENERATED_STEP_G = 5;
const REFERENCE_BATCH_COOKED_G = 1000;

function slugOf(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return s === "" ? "dish" : s;
}

/** The ingredient-create slug grammar (`[a-z0-9_]`) for a model-proposed slug. */
function ingredientSlugOf(slug: string): string {
  return (
    slug
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+/, "")
      .slice(0, 100) || "ingredient"
  );
}

/**
 * The ops that save generated dishes (REC-5), pure: `ingredient.create` for each new ingredient
 * (`ai_estimate`, low confidence, NUT-7; one per slug across the survivors) and `dish.create` with
 * `source: ai`, each dish on a slug not in `takenSlugs`. Returns the ops and the new dish ids in
 * input order. Used by `saveGeneratedDishes` and by the chat's recipe drafts (R-53: one mapping).
 */
export function generatedDishOps(args: {
  survivors: readonly SurvivorInput[];
  generationIds: readonly string[];
  catalog: DbCatalog;
  /** Household dish slugs already used. */
  takenSlugs: Iterable<string>;
  newId?: () => string;
}): { ops: ChangeOp[]; dishIds: string[] } {
  const makeId = args.newId ?? newId;
  const ingredientIds = new Map(args.catalog.idBySlug);
  const ops: ChangeOp[] = [];
  for (const s of args.survivors)
    for (const n of s.newIngredients) {
      // Stored slugs use the op's grammar (underscores); look both forms up so a proposal that
      // differs only in separators reuses the ingredient instead of colliding on the unique slug.
      const slug = ingredientSlugOf(n.slug);
      const existing = ingredientIds.get(n.slug) ?? ingredientIds.get(slug);
      if (existing !== undefined) {
        ingredientIds.set(n.slug, existing);
        continue;
      }
      const id = makeId();
      ingredientIds.set(n.slug, id);
      ingredientIds.set(slug, id);
      ops.push({
        kind: "ingredient.create",
        payload: {
          id,
          slug,
          name: n.name,
          category: n.category,
          kcal: n.per100g.kcal,
          proteinG: n.per100g.protein,
          carbsG: n.per100g.carbs,
          fatG: n.per100g.fat,
          satFatG: n.per100g.satFat,
          fibreG: n.per100g.fibre,
          solubleFibreG: n.per100g.solubleFibre,
          sugarG: null,
          sodiumMg: null,
          nutritionSource: "ai_estimate",
          nutritionConfidence: "low",
        },
      });
    }
  const taken = new Set(args.takenSlugs);
  const need = (map: ReadonlyMap<string, string>, key: string, what: string) => {
    const v = map.get(key);
    if (v === undefined)
      throw new PlanServiceError("invalid", `generated dish uses unknown ${what} ${key}`);
    return v;
  };
  const dishIds: string[] = [];
  for (const s of args.survivors) {
    const d = s.dish;
    let slug = slugOf(d.name);
    for (let i = 2; taken.has(slug); i++) slug = `${slugOf(d.name).slice(0, 95)}-${String(i)}`;
    taken.add(slug);
    const id = makeId();
    dishIds.push(id);
    const assembly =
      d.assemblySteps.length === 0
        ? ""
        : `\n\nTo assemble: ${d.assemblySteps.map((step, i) => `${String(i + 1)}. ${step}`).join(" ")}`;
    ops.push({
      kind: "dish.create",
      payload: {
        id,
        name: d.name.slice(0, 120),
        slug,
        description: `${d.description}${assembly}`.slice(0, 2000),
        cuisineId: need(args.catalog.cuisineIdByKey, d.cuisine, "cuisine"),
        secondaryCuisineId:
          d.secondaryCuisine === undefined
            ? null
            : need(args.catalog.cuisineIdByKey, d.secondaryCuisine, "cuisine"),
        slotKeys: d.slotKeys,
        flavourTags: d.flavourTags,
        isPackable: d.isPackable,
        servedColdOk: d.servedColdOk,
        status: "active",
        source: "ai",
        aiGenerationId: args.generationIds[s.call - 1] ?? args.generationIds[0] ?? null,
        components: d.components.map((c) => ({
          name: c.name,
          role: c.role,
          portioning: c.portioning,
          unitLabel: c.unitLabel ?? (c.portioning === "unit" ? "piece" : null),
          minServingG: c.minServingG,
          maxServingG: c.maxServingG,
          defaultServingG: c.defaultServingG,
          stepG: GENERATED_STEP_G,
          required: c.required,
          variants: c.variants.map((v) => ({
            methodId: need(args.catalog.methodIdByKey, v.method, "method"),
            label: v.label,
            isDefault: v.isDefault,
            steps: v.steps,
            cookTimeMin: v.cookTimeMin,
            notes: null,
            referenceBatchCookedG: REFERENCE_BATCH_COOKED_G,
            ingredients: v.ingredients.map((l) => ({
              ingredientId: need(ingredientIds, l.slug, "ingredient"),
              rawGPerBatch: l.rawGramsPerBatch,
              roleNote: l.note?.slice(0, 120) ?? null,
              isAbsorbedOil: l.isAbsorbedFat,
            })),
          })),
        })),
      },
    });
  }
  return { ops, dishIds };
}

/** The household's dish slugs (taken for new dishes). */
export async function householdDishSlugs(db: Executor, ctx: HouseholdContext): Promise<string[]> {
  return (
    await db.select({ slug: dish.slug }).from(dish).where(eq(dish.householdId, ctx.householdId))
  ).map((d) => d.slug);
}

/**
 * REC-5 "survivors are saved via a change set": the `generatedDishOps` applied as one change set.
 * Returns the new dish ids in input order and the change set (for its follow-up jobs).
 */
export async function saveGeneratedDishes(
  db: Executor,
  ctx: HouseholdContext,
  args: {
    survivors: readonly SurvivorInput[];
    generationIds: readonly string[];
    catalog: DbCatalog;
    by: ChangeActorInput;
  },
): Promise<{ dishIds: string[]; changeSetId: string | null }> {
  if (args.survivors.length === 0) return { dishIds: [], changeSetId: null };
  const { ops, dishIds } = generatedDishOps({
    survivors: args.survivors,
    generationIds: args.generationIds,
    catalog: args.catalog,
    takenSlugs: await householdDishSlugs(db, ctx),
  });
  const applied = await applyChangeSet(db, ctx, {
    actor: args.by.actor,
    source: args.by.source,
    summary: `Add ${String(dishIds.length)} AI recipe${dishIds.length === 1 ? "" : "s"}`,
    ops,
  });
  return { dishIds, changeSetId: applied.changeSetId };
}

/** Offset of `timeZone` from UTC at `at`, in ms (wall clock minus UTC). */
function offsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * Start of the household's local day, as an instant (`timezone` is an IANA name). Computed from
 * the offset in force at midnight, so days that change daylight-saving time are exact.
 */
export function localMidnight(timezone: string, now: Date): Date {
  const local = new Date(now.getTime() + offsetMs(timezone, now.getTime()));
  const wallMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let instant = wallMidnight - offsetMs(timezone, wallMidnight);
  instant = wallMidnight - offsetMs(timezone, instant);
  return new Date(instant);
}

/**
 * ARC-6 / SPEC-Q-15: AI dishes requested since the household's local midnight, from the
 * `ai_generation` audit rows (each generation's first call records the dish count asked for).
 * Counting requests, not stored dishes, covers revisions and survives an undo of the saved dishes.
 */
export async function aiDishesToday(
  db: Executor,
  ctx: HouseholdContext,
  timezone: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`coalesce(sum(coalesce((${aiGeneration.requestSummary} -> 'context' ->> 'count')::int, 0)), 0)::int`,
    })
    .from(aiGeneration)
    .where(
      and(
        eq(aiGeneration.householdId, ctx.householdId),
        eq(aiGeneration.purpose, "recipe"),
        sql`(${aiGeneration.requestSummary} ->> 'call')::int = 1`,
        gte(aiGeneration.createdAt, localMidnight(timezone, now)),
      ),
    );
  return row?.n ?? 0;
}
