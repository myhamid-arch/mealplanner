// Configuration and catalogue reads with the ARC-6 projections (leaf-1.4.1 SPEC-Q-17):
// - members: admins see everything; members see names, colours and targeted flags but not other
//   members' notes; kitchen sees names only when `kitchen_sees_names` (else "Member 1…n").
// - targets, exclusions, preferences: a member sees household-level rows and their own member's.
// Every read goes through the household-scoped repositories (DM-1).
import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { createRepos } from "@mealplanner/db/repos";
import {
  component,
  cuisine,
  dish,
  dishNutritionCache,
  ingredient,
  preparationMethod,
  variant,
  variantIngredient,
} from "@mealplanner/db/schema";
import type { CallerContext } from "../auth/context";
import { forbidden, notFound } from "./problem";
import type { Runtime } from "./runtime";
import { plain } from "./serialize";

const repos = (rt: Runtime, caller: CallerContext) => createRepos(rt.db, caller.ctx);

/** Display names as the caller may see them (kitchen without `kitchen_sees_names`: "Member n"). */
export async function memberNames(
  rt: Runtime,
  caller: CallerContext,
): Promise<Map<string, string>> {
  const members = [...(await repos(rt, caller).member.list())].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const hide = caller.ctx.role === "kitchen" && !caller.household.kitchenSeesNames;
  return new Map(members.map((m, i) => [m.id, hide ? `Member ${String(i + 1)}` : m.displayName]));
}

export async function listMembers(rt: Runtime, caller: CallerContext) {
  const rows = await repos(rt, caller).member.list();
  const names = await memberNames(rt, caller);
  const role = caller.ctx.role;
  return {
    members: rows.map((m) => ({
      ...plain(m),
      displayName: names.get(m.id) ?? m.displayName,
      notes: role === "admin" || m.id === caller.memberId ? m.notes : null,
      birthYear: role === "kitchen" ? null : m.birthYear,
      sex: role === "kitchen" ? null : m.sex,
    })),
  };
}

/** A member may read only their own member's details and targets. */
function ownOnly(caller: CallerContext, memberId: string | null): void {
  if (caller.ctx.role !== "admin" && (memberId === null || memberId !== caller.memberId))
    throw notFound("member");
}

export async function getMember(rt: Runtime, caller: CallerContext, id: string) {
  ownOnly(caller, id);
  const r = repos(rt, caller);
  const m = await r.member.get({ id });
  if (m === null) throw notFound("member");
  return {
    ...plain(m),
    targets: await r.target_profile.list({ memberId: id }),
    tolerance: await r.tolerance.get({ memberId: id }),
  };
}

export async function listTargets(rt: Runtime, caller: CallerContext) {
  const r = repos(rt, caller);
  const visible = (memberId: string) => caller.ctx.role === "admin" || memberId === caller.memberId;
  return {
    targets: (await r.target_profile.list()).filter((t) => visible(t.memberId)),
    tolerances: (await r.tolerance.list()).filter((t) => visible(t.memberId)),
  };
}

export async function listSlots(rt: Runtime, caller: CallerContext) {
  const slots = await repos(rt, caller).slot_type.list();
  return {
    slots: [...slots].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
  };
}

export async function getSchedules(rt: Runtime, caller: CallerContext) {
  const r = repos(rt, caller);
  return plain({
    slotSchedules: await r.member_slot_schedule.list(),
    training: await r.training_schedule.list(),
    dayOverrides: await r.day_override.list(),
    distributions: await r.meal_distribution.list(),
    slotTargets: await r.slot_target_override.list(),
  });
}

export async function getWeights(rt: Runtime, caller: CallerContext) {
  const w = await repos(rt, caller).planning_weights.get({ householdId: caller.ctx.householdId });
  if (w === null) throw notFound("planning weights");
  return plain(w);
}

export async function listPresets(rt: Runtime, caller: CallerContext) {
  return { presets: await repos(rt, caller).weight_preset.list() };
}

const householdOrOwn = (caller: CallerContext, memberId: string | null) =>
  caller.ctx.role === "admin" || memberId === null || memberId === caller.memberId;

export async function listExclusions(rt: Runtime, caller: CallerContext, kind: string | undefined) {
  const rows = await repos(rt, caller).exclusion.list();
  return {
    exclusions: rows.filter(
      (e) => householdOrOwn(caller, e.memberId) && (kind === undefined || e.kind === kind),
    ),
  };
}

export async function listFrequencyRules(rt: Runtime, caller: CallerContext) {
  return { rules: await repos(rt, caller).frequency_rule.list() };
}

export async function listMealOverrides(
  rt: Runtime,
  caller: CallerContext,
  from?: string,
  to?: string,
) {
  const rows = await repos(rt, caller).meal_override.list();
  return {
    overrides: rows.filter(
      (o) => (from === undefined || o.planDate >= from) && (to === undefined || o.planDate <= to),
    ),
  };
}

export async function listPreferences(
  rt: Runtime,
  caller: CallerContext,
  memberId: string | undefined,
) {
  if (memberId !== undefined && caller.ctx.role !== "admin" && memberId !== caller.memberId)
    throw forbidden("forbidden_member", "members may read only their own preferences");
  const rows = await repos(rt, caller).preference.list();
  return {
    preferences: plain(
      rows.filter(
        (p) =>
          householdOrOwn(caller, p.memberId) && (memberId === undefined || p.memberId === memberId),
      ),
    ),
  };
}

// Catalogue ------------------------------------------------------------------------------------

const visibleDish = (householdId: string) =>
  or(isNull(dish.householdId), eq(dish.householdId, householdId));

export async function listDishes(
  rt: Runtime,
  caller: CallerContext,
  q: {
    q?: string | undefined;
    cuisine?: string | undefined;
    slot?: string | undefined;
    status?: string | undefined;
  },
) {
  const rows = await rt.db
    .select({ dish, cuisineKey: cuisine.key })
    .from(dish)
    .innerJoin(cuisine, eq(cuisine.id, dish.cuisineId))
    .where(
      and(
        visibleDish(caller.ctx.householdId),
        q.q === undefined ? undefined : ilike(dish.name, `%${q.q.replace(/[\\%_]/g, "\\$&")}%`),
      ),
    );
  const cuisines = new Map((await rt.db.select().from(cuisine)).map((c) => [c.id, c.key]));
  const adjusters = await adjusterDishIds(
    rt,
    rows.map((r) => r.dish.id),
  );
  return {
    dishes: rows
      .filter((r) =>
        q.status === undefined ? r.dish.status !== "retired" : r.dish.status === q.status,
      )
      .filter((r) => q.cuisine === undefined || r.cuisineKey === q.cuisine)
      .filter((r) => q.slot === undefined || r.dish.slotKeys.includes(q.slot))
      .sort((a, b) => a.dish.name.localeCompare(b.dish.name))
      .map((r) => ({
        ...plain(r.dish),
        cuisineKey: r.cuisineKey,
        secondaryCuisineKey:
          r.dish.secondaryCuisineId === null
            ? null
            : (cuisines.get(r.dish.secondaryCuisineId) ?? null),
        isAdjuster: adjusters.has(r.dish.id),
      })),
  };
}

async function adjusterDishIds(rt: Runtime, dishIds: readonly string[]): Promise<Set<string>> {
  if (dishIds.length === 0) return new Set();
  const rows = await rt.db
    .select({ dishId: component.dishId, role: component.role })
    .from(component)
    .where(inArray(component.dishId, [...dishIds]));
  const byDish = new Map<string, string[]>();
  for (const r of rows) byDish.set(r.dishId, [...(byDish.get(r.dishId) ?? []), r.role]);
  return new Set(
    [...byDish]
      .filter(([, roles]) => roles.length === 1 && roles[0] === "adjuster")
      .map(([id]) => id),
  );
}

export async function getDish(rt: Runtime, caller: CallerContext, id: string) {
  const [row] = await rt.db
    .select()
    .from(dish)
    .where(and(eq(dish.id, id), visibleDish(caller.ctx.householdId)));
  if (row === undefined) throw notFound("dish");
  const cuisines = new Map((await rt.db.select().from(cuisine)).map((c) => [c.id, c.key]));
  const methods = new Map((await rt.db.select().from(preparationMethod)).map((m) => [m.id, m.key]));
  const components = await rt.db.select().from(component).where(eq(component.dishId, id));
  const variants =
    components.length === 0
      ? []
      : await rt.db
          .select()
          .from(variant)
          .where(
            inArray(
              variant.componentId,
              components.map((c) => c.id),
            ),
          );
  const variantIds = variants.map((v) => v.id);
  const lines =
    variantIds.length === 0
      ? []
      : await rt.db
          .select({ line: variantIngredient, slug: ingredient.slug, name: ingredient.name })
          .from(variantIngredient)
          .innerJoin(ingredient, eq(ingredient.id, variantIngredient.ingredientId))
          .where(inArray(variantIngredient.variantId, variantIds));
  const cache =
    variantIds.length === 0
      ? []
      : await rt.db
          .select()
          .from(dishNutritionCache)
          .where(inArray(dishNutritionCache.variantId, variantIds));
  const cacheBy = new Map(cache.map((c) => [c.variantId, c]));
  return {
    ...plain(row),
    cuisineKey: cuisines.get(row.cuisineId) ?? "",
    secondaryCuisineKey:
      row.secondaryCuisineId === null ? null : (cuisines.get(row.secondaryCuisineId) ?? null),
    isAdjuster: components.length === 1 && components[0]?.role === "adjuster",
    components: [...components]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        ...c,
        variants: variants
          .filter((v) => v.componentId === c.id)
          .sort(
            (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label),
          )
          .map((v) => {
            const n = cacheBy.get(v.id);
            return {
              ...v,
              methodKey: methods.get(v.methodId) ?? "",
              per100gCooked:
                n === undefined
                  ? null
                  : {
                      kcal: n.kcal,
                      protein: n.protein,
                      carbs: n.carbs,
                      fat: n.fat,
                      satFat: n.satFat,
                      fibre: n.fibre,
                      solubleFibre: n.solubleFibre,
                      sugar: n.sugar,
                      sodiumMg: n.sodium,
                    },
              ingredients: lines
                .filter((l) => l.line.variantId === v.id)
                .map((l) => ({ ...l.line, slug: l.slug, name: l.name })),
            };
          }),
      })),
  };
}

type IngredientRow = typeof ingredient.$inferSelect;

function ingredientDto(i: IngredientRow) {
  return {
    ...plain(i),
    per100gRaw: {
      kcal: i.kcal,
      protein: i.proteinG,
      carbs: i.carbsG,
      fat: i.fatG,
      satFat: i.satFatG,
      fibre: i.fibreG,
      solubleFibre: i.solubleFibreG,
      sugar: i.sugarG,
      sodiumMg: i.sodiumMg,
    },
    householdPrivate: i.createdByHouseholdId !== null,
  };
}

const visibleIngredient = (householdId: string) =>
  or(isNull(ingredient.createdByHouseholdId), eq(ingredient.createdByHouseholdId, householdId));

export async function listIngredients(
  rt: Runtime,
  caller: CallerContext,
  q: { q?: string | undefined; category?: string | undefined; limit: number },
) {
  const rows = await rt.db
    .select()
    .from(ingredient)
    .where(
      and(
        visibleIngredient(caller.ctx.householdId),
        q.q === undefined
          ? undefined
          : ilike(ingredient.name, `%${q.q.replace(/[\\%_]/g, "\\$&")}%`),
      ),
    );
  return {
    ingredients: rows
      .filter((i) => q.category === undefined || i.category === q.category)
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .slice(0, q.limit)
      .map(ingredientDto),
  };
}

export async function getIngredient(rt: Runtime, caller: CallerContext, id: string) {
  const [row] = await rt.db
    .select()
    .from(ingredient)
    .where(and(eq(ingredient.id, id), visibleIngredient(caller.ctx.householdId)));
  if (row === undefined) throw notFound("ingredient");
  return ingredientDto(row);
}

export async function listCuisines(rt: Runtime) {
  const rows = await rt.db.select().from(cuisine);
  return { cuisines: rows.sort((a, b) => a.key.localeCompare(b.key)) };
}

export async function listMethods(rt: Runtime) {
  const rows = await rt.db.select().from(preparationMethod);
  return { methods: rows.sort((a, b) => a.key.localeCompare(b.key)) };
}
