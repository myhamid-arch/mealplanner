// The planner's input from the database (R-2 wiring of 04 §11 `planDays`): the household
// configuration, the dish pool (global seed library plus the household's own dishes) as
// `PlanDish`, the global adjusters, and the stored meals of the planned dates (locked) and of the
// surrounding days (context). Stored meals are mapped back to `PlannedMeal` from the rows written by
// `savePlan` (store.ts), so a re-plan sees exactly what was saved.
//
// Household scoping (DM-1): these range reads need `IN`/`BETWEEN`, which the equality-only
// repositories do not offer, so every query here carries an explicit `household_id` predicate (or,
// for dishes, `household_id IS NULL OR = :household`); leaf-1.4.1's tests load another household's
// plan through them and get nothing.
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { variantNutritionPer100gCooked } from "@mealplanner/core/nutrition";
import type {
  PlanDish,
  PlannedMeal,
  PlannedPlate,
  PlanInput,
  PlateSolution,
  ScoreBreakdown,
  SlotTarget,
} from "@mealplanner/core/planner";
import type { HouseholdConfig, HouseholdContext, Json } from "@mealplanner/core/types";
import type { Executor } from "../../repos/index.js";
import {
  component,
  dish,
  planDay,
  planMeal,
  plate,
  plateItem,
  variant,
  variantIngredient,
} from "../../schema/index.js";
import { loadHouseholdConfig } from "../config/index.js";
import { loadDbCatalog, type DbCatalog } from "./catalog.js";
import { variantInputOf } from "./nutrition.js";

/** Days before and after the planned dates whose meals are loaded as context (economy, gaps). */
export const CONTEXT_DAYS = 21;

export interface PlanPool {
  dishes: PlanDish[];
  adjusters: PlanDish[];
  catalog: DbCatalog;
  /** Every loaded dish by id (pool, adjusters and retired dishes still referenced by meals). */
  byId: Map<string, PlanDish>;
}

type DishRow = typeof dish.$inferSelect;

/** The dishes a household can plan with, and the global adjusters, as planner input. */
export async function loadPlanPool(
  db: Executor,
  ctx: HouseholdContext,
  opts: { includeDishIds?: readonly string[]; catalog?: DbCatalog } = {},
): Promise<PlanPool> {
  const catalog = opts.catalog ?? (await loadDbCatalog(db, ctx.householdId));
  const visible = or(isNull(dish.householdId), eq(dish.householdId, ctx.householdId));
  const extra = [...(opts.includeDishIds ?? [])];
  const dishRows = await db
    .select()
    .from(dish)
    .where(
      extra.length === 0
        ? and(visible, inArray(dish.status, ["active", "draft"]))
        : and(visible, or(inArray(dish.status, ["active", "draft"]), inArray(dish.id, extra))),
    );
  const planDishes = await toPlanDishes(db, dishRows, catalog);
  const byId = new Map(planDishes.map((d) => [d.id, d]));
  const isAdjuster = (d: PlanDish) =>
    d.components.length === 1 && d.components[0]?.role === "adjuster";
  const adjusters = planDishes.filter(
    (d) => isAdjuster(d) && dishRowOf(dishRows, d.id)?.householdId === null,
  );
  const dishes = planDishes.filter((d) => !isAdjuster(d));
  return { dishes, adjusters, catalog, byId };
}

function dishRowOf(rows: readonly DishRow[], id: string): DishRow | undefined {
  return rows.find((r) => r.id === id);
}

/** Maps dish rows (with their components, variants and ingredient lines) to `PlanDish`. */
export async function toPlanDishes(
  db: Executor,
  dishRows: readonly DishRow[],
  catalog: DbCatalog,
): Promise<PlanDish[]> {
  if (dishRows.length === 0) return [];
  const components = await db
    .select()
    .from(component)
    .where(
      inArray(
        component.dishId,
        dishRows.map((d) => d.id),
      ),
    );
  const variants =
    components.length === 0
      ? []
      : await db
          .select()
          .from(variant)
          .where(
            inArray(
              variant.componentId,
              components.map((c) => c.id),
            ),
          );
  const lines =
    variants.length === 0
      ? []
      : await db
          .select()
          .from(variantIngredient)
          .where(
            inArray(
              variantIngredient.variantId,
              variants.map((v) => v.id),
            ),
          );
  const group = <T, K>(items: readonly T[], key: (t: T) => K) => {
    const m = new Map<K, T[]>();
    for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
    return m;
  };
  const componentsByDish = group(components, (c) => c.dishId);
  const variantsByComponent = group(variants, (v) => v.componentId);
  // 1.2.7 (R-73, W-17): every order below comes from natural keys, never from ids. The planner
  // reads it: pool order settles ties, component and variant order feed the solver, and line order
  // feeds the nutrition sums and the reasons.
  const slugOf = (ingredientId: string) => catalog.ingredients.get(ingredientId)?.slug ?? "";
  const lineKey = (l: (typeof lines)[number]) =>
    JSON.stringify([
      slugOf(l.ingredientId),
      l.rawGPerBatch,
      l.isAbsorbedOil,
      l.cookingLiquid,
      l.yieldOverride,
      l.roleNote,
    ]);
  const linesByVariant = new Map(
    [...group(lines, (l) => l.variantId)].map(([id, own]) => [
      id,
      [...own].sort((a, b) => compareText(lineKey(a), lineKey(b))),
    ]),
  );
  const variantKey = (v: (typeof variants)[number]) =>
    JSON.stringify([
      Number(!v.isDefault),
      v.label,
      catalog.methodKeyById.get(v.methodId) ?? "",
      (linesByVariant.get(v.id) ?? []).map(lineKey),
    ]);
  const out: PlanDish[] = [];
  // Library dishes before a household dish that reuses their slug (SPEC-Q-2).
  const dishOrder = (d: DishRow) => JSON.stringify([d.slug, d.householdId === null ? 0 : 1]);
  for (const d of [...dishRows].sort((a, b) => compareText(dishOrder(a), dishOrder(b)))) {
    const cuisineKey = catalog.cuisineKeyById.get(d.cuisineId);
    if (cuisineKey === undefined) continue;
    const state = { broken: false };
    const planComponents = [...(componentsByDish.get(d.id) ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder || compareText(a.name, b.name))
      .map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        portioning: c.portioning,
        unitLabel: c.unitLabel,
        minServingG: c.minServingG,
        maxServingG: c.maxServingG,
        defaultServingG: c.defaultServingG,
        stepG: c.stepG,
        unitWeightG: unitWeightOf(
          c.portioning,
          linesByVariant,
          [...(variantsByComponent.get(c.id) ?? [])].sort((a, b) =>
            compareText(variantKey(a), variantKey(b)),
          ),
          catalog,
        ),
        required: c.required,
        variants: [...(variantsByComponent.get(c.id) ?? [])]
          .sort((a, b) => compareText(variantKey(a), variantKey(b)))
          .flatMap((v) => {
            const method = catalog.methodKeyById.get(v.methodId);
            const own = linesByVariant.get(v.id) ?? [];
            if (
              method === undefined ||
              own.length === 0 ||
              own.some((l) => !catalog.ingredients.has(l.ingredientId))
            ) {
              state.broken = true;
              return [];
            }
            const input = variantInputOf(method, own);
            const ingredientIds = [...new Set(own.map((l) => l.ingredientId))];
            return [
              {
                id: v.id,
                isDefault: v.isDefault,
                label: v.label,
                methodKey: method,
                needsReview: v.needsReview,
                steps: v.steps,
                input,
                per100g: variantNutritionPer100gCooked(input, catalog.context).per100g,
                ingredients: ingredientIds.map((id) => {
                  const row = catalog.ingredients.get(id);
                  if (row === undefined) throw new Error(`ingredient ${id} missing`);
                  return {
                    id,
                    slug: row.slug,
                    category: row.category,
                    dietaryFlags: row.dietaryFlags,
                    // 1.4.10 (R-68): the display name for the planner's plain reasons (W-12).
                    name: row.name,
                  };
                }),
              },
            ];
          }),
      }));
    if (state.broken || planComponents.some((c) => c.variants.length === 0)) continue;
    out.push({
      id: d.id,
      slug: d.slug,
      version: d.version,
      name: d.name,
      cuisineKey,
      // 1.4.10 (R-68): the cuisine label for the planner's plain reasons (W-12).
      cuisineLabel: catalog.cuisineLabelByKey.get(cuisineKey),
      slotKeys: d.slotKeys,
      status: d.status,
      isPackable: d.isPackable,
      servedColdOk: d.servedColdOk,
      components: planComponents,
    });
  }
  return out;
}

/** Code-unit order (not locale order), so the loader's order is the same on every machine. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * PLN-5: a `unit` component steps by the unit weight of its unit ingredient (e.g. one egg). It is
 * taken from the default variant's single ingredient with a `unit_weight_g`; null when there is
 * none, and the solver then uses `step_g`.
 */
function unitWeightOf(
  portioning: string,
  linesByVariant: Map<string, (typeof variantIngredient.$inferSelect)[]>,
  variants: readonly (typeof variant.$inferSelect)[],
  catalog: DbCatalog,
): number | null {
  if (portioning !== "unit") return null;
  const def = variants.find((v) => v.isDefault) ?? variants[0];
  if (def === undefined) return null;
  const weights = (linesByVariant.get(def.id) ?? [])
    .map((l) => catalog.ingredients.get(l.ingredientId)?.unitWeightG ?? null)
    .filter((w): w is number => w !== null && w > 0);
  return weights.length === 1 ? (weights[0] ?? null) : null;
}

// Stored meal ⇄ PlannedMeal ------------------------------------------------------------------------

/** What `plan_meal.score_breakdown` holds: the PLN-9 breakdown plus the meal's planning facts. */
export interface StoredBreakdown extends ScoreBreakdown {
  meal: {
    kind: PlannedMeal["kind"];
    attendees: string[];
    splitMembers: string[];
    split: boolean;
    frequencyRelaxed: string | null;
    variantLimits: Record<string, string[]>;
    explain: string[];
  };
}

/**
 * What `plate.target` holds: the slot target used plus the resolver's own target, or
 * `{ untargeted: true }` for an untargeted plate (the column is not null).
 */
export type StoredTarget = (SlotTarget & { resolver: SlotTarget | null }) | { untargeted: true };

export function isUntargeted(t: StoredTarget | null): t is { untargeted: true } | null {
  return t === null || "untargeted" in t;
}

/** What `plate.deviation` holds besides the four macro deviations. */
export interface StoredDeviation {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  shortfall: PlateSolution["shortfall"];
  objective: number;
  fit: number;
  explain: string[];
  flag: string | null;
}

export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export interface MealRange {
  from: string;
  to: string;
}

/** Stored meals in a date range as `PlannedMeal` (dishes must be in `byId` for their parts). */
export async function loadPlannedMeals(
  db: Executor,
  ctx: HouseholdContext,
  cfg: HouseholdConfig,
  range: MealRange,
  byId: ReadonlyMap<string, PlanDish>,
): Promise<Array<PlannedMeal & { id: string }>> {
  const days = await db
    .select()
    .from(planDay)
    .where(
      and(
        eq(planDay.householdId, ctx.householdId),
        gte(planDay.date, range.from),
        lte(planDay.date, range.to),
      ),
    );
  if (days.length === 0) return [];
  const meals = await db
    .select()
    .from(planMeal)
    .where(
      and(
        eq(planMeal.householdId, ctx.householdId),
        inArray(
          planMeal.planDayId,
          days.map((d) => d.id),
        ),
      ),
    );
  const plates =
    meals.length === 0
      ? []
      : await db
          .select()
          .from(plate)
          .where(
            and(
              eq(plate.householdId, ctx.householdId),
              inArray(
                plate.planMealId,
                meals.map((m) => m.id),
              ),
            ),
          );
  const items =
    plates.length === 0
      ? []
      : await db
          .select()
          .from(plateItem)
          .where(
            and(
              eq(plateItem.householdId, ctx.householdId),
              inArray(
                plateItem.plateId,
                plates.map((p) => p.id),
              ),
            ),
          );
  const dateOf = new Map(days.map((d) => [d.id, d.date]));
  const componentDish = new Map<string, string>();
  for (const d of byId.values()) for (const c of d.components) componentDish.set(c.id, d.id);
  // 1.2.7 (R-73): a plate's items in their dish's component and variant order (adjusters by slug).
  const itemKey = new Map<string, string>();
  for (const d of byId.values())
    d.components.forEach((c, ci) => {
      c.variants.forEach((v, vi) => itemKey.set(v.id, JSON.stringify([d.slug, ci, vi])));
    });
  const byItem = (a: { variantId: string }, b: { variantId: string }) =>
    compareText(itemKey.get(a.variantId) ?? "", itemKey.get(b.variantId) ?? "");
  const members = new Map(cfg.members.map((m) => [m.id, m]));
  // 1.2.7 (R-73, W-17): plates and meals in natural order: members by their position in the
  // configuration (SPEC-Q-1), slots by time, sort order and key.
  const rank = new Map(cfg.members.map((m, i) => [m.id, i]));
  const rankOf = (memberId: string) => rank.get(memberId) ?? cfg.members.length;
  const slotRank = new Map(cfg.slotTypes.map((s, i) => [s.id, i]));
  const scopeRank = (scope: string) =>
    scope === "shared" ? cfg.members.length + 1 : rankOf(scope);
  const out: Array<PlannedMeal & { id: string }> = [];
  for (const m of meals) {
    const date = dateOf.get(m.planDayId);
    const slot = cfg.slotTypes.find((s) => s.id === m.slotTypeId);
    if (date === undefined || slot === undefined) continue;
    const stored = m.scoreBreakdown as unknown as Partial<StoredBreakdown>;
    const mealPlates: PlannedPlate[] = plates
      .filter((p) => p.planMealId === m.id)
      .sort((a, b) => rankOf(a.memberId) - rankOf(b.memberId))
      .map((p) => {
        const own = items.filter((i) => i.plateId === p.id).sort(byItem);
        const storedTarget = p.target as unknown as StoredTarget | null;
        const target = isUntargeted(storedTarget) ? null : storedTarget;
        const dev = p.deviation as unknown as Partial<StoredDeviation>;
        const status = p.fitStatus;
        const solution: PlateSolution = {
          status,
          items: own
            .filter((i) => (componentDish.get(i.componentId) ?? m.dishId) === m.dishId)
            .map((i) => ({
              componentId: i.componentId,
              variantId: i.variantId,
              cookedG: i.cookedG,
            })),
          adjusters: own
            .filter((i) => {
              const d = componentDish.get(i.componentId);
              return d !== undefined && d !== m.dishId;
            })
            .map((i) => ({
              dishId: componentDish.get(i.componentId) ?? "",
              variantId: i.variantId,
              cookedG: i.cookedG,
            })),
          actual: p.actual as unknown as PlateSolution["actual"],
          deviation: {
            kcal: dev.kcal ?? 0,
            protein: dev.protein ?? 0,
            carbs: dev.carbs ?? 0,
            fat: dev.fat ?? 0,
          },
          shortfall: dev.shortfall ?? { fibre: 0, solubleFibre: 0 },
          objective: dev.objective ?? 0,
          fit: dev.fit ?? 0,
          explain: dev.explain ?? [],
        };
        let slotTarget: SlotTarget | null = null;
        let resolverTarget: SlotTarget | null = null;
        if (target !== null) {
          const { resolver, ...rest } = target;
          slotTarget = rest;
          resolverTarget = resolver;
        }
        return {
          memberId: p.memberId,
          targeted: target !== null && (members.get(p.memberId)?.isTargeted ?? true),
          fitStatus: status,
          target: slotTarget,
          resolverTarget,
          solution,
          flag: dev.flag ?? null,
        };
      });
    const breakdown: ScoreBreakdown = {
      macroFit: stored.macroFit ?? 0,
      appeal: stored.appeal ?? 0,
      economy: stored.economy ?? 0,
      variety: stored.variety ?? 0,
      total: stored.total ?? 0,
      weights: stored.weights ?? { macroPrecision: 0, appeal: 0, ingredientEconomy: 0, variety: 0 },
      reasons: stored.reasons ?? [],
    };
    const meta = stored.meal;
    out.push({
      id: m.id,
      date,
      slotKey: slot.key,
      slotTypeId: slot.id,
      slotLabel: slot.label,
      time: slot.defaultTime,
      isPacked: slot.isPacked,
      reheatAvailable: slot.reheatAvailable,
      kind: meta?.kind ?? (m.memberScope === "shared" ? "shared" : "individual"),
      memberScope: m.memberScope,
      attendees: meta?.attendees ?? mealPlates.map((p) => p.memberId),
      splitMembers: meta?.splitMembers ?? [],
      split: meta?.split ?? false,
      dishId: m.dishId,
      dishVersion: m.dishVersion,
      locked: m.locked,
      scoreBreakdown: breakdown,
      plates: mealPlates,
      frequencyRelaxed: meta?.frequencyRelaxed ?? null,
      variantLimits: meta?.variantLimits ?? {},
      explain: meta?.explain ?? [],
    });
  }
  return out.sort(
    (a, b) =>
      compareText(a.date, b.date) ||
      compareText(a.time, b.time) ||
      (slotRank.get(a.slotTypeId) ?? 0) - (slotRank.get(b.slotTypeId) ?? 0) ||
      scopeRank(a.memberScope) - scopeRank(b.memberScope),
  );
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The planner input for `dates`: locked meals on those dates stay (PLN-13), and every other stored
 * meal within CONTEXT_DAYS is context (economy window, frequency gaps).
 */
export async function loadPlanInput(
  db: Executor,
  ctx: HouseholdContext,
  input: { dates: readonly string[] },
): Promise<{ input: PlanInput; pool: PlanPool; stored: Array<PlannedMeal & { id: string }> }> {
  const dates = [...new Set(input.dates)].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) throw new RangeError("no dates to plan");
  const config = await loadHouseholdConfig(db, ctx);
  const range = { from: addDays(first, -CONTEXT_DAYS), to: addDays(last, CONTEXT_DAYS) };
  // Dishes referenced by stored meals (a retired one still describes its past meal).
  const referenced = await db
    .selectDistinct({ dishId: planMeal.dishId })
    .from(planMeal)
    .innerJoin(planDay, eq(planDay.id, planMeal.planDayId))
    .where(
      and(
        eq(planMeal.householdId, ctx.householdId),
        gte(planDay.date, range.from),
        lte(planDay.date, range.to),
      ),
    );
  const pool = await loadPlanPool(db, ctx, { includeDishIds: referenced.map((r) => r.dishId) });
  const stored = await loadPlannedMeals(db, ctx, config, range, pool.byId);
  const planned = new Set(dates);
  return {
    input: {
      config,
      dates,
      dishes: pool.dishes,
      adjusters: pool.adjusters,
      locked: stored.filter((m) => planned.has(m.date) && m.locked),
      context: stored.filter((m) => !planned.has(m.date)),
    },
    pool,
    stored,
  };
}
