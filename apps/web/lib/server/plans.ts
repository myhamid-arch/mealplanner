// Plans, meals, plates and the cook sheet over the plan services (PLN-11 … 14, R2-UX-1), with the
// ARC-6 plate projection (leaf-1.4.1 SPEC-Q-17): admins see every plate with target and deviation;
// a member sees their own plate in full and other members' plates (without target or deviation)
// only when `members_see_plates`; kitchen users see plates only through the cook sheet.
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { plateNutrients, type Nutrients } from "@mealplanner/core/nutrition";
import type { ScoreBreakdown } from "@mealplanner/core/planner";
import { createRepos } from "@mealplanner/db/repos";
import { component, dish, planDay, planMeal, plate, plateItem } from "@mealplanner/db/schema";
import { applyChangeSet } from "@mealplanner/db/services/changes";
import { createReview } from "@mealplanner/db/services/reviews";
import {
  cookSheetFor,
  isUntargeted,
  loadMealState,
  planAlternatives,
  swapMeal,
  type StoredBreakdown,
  type StoredDeviation,
  type StoredTarget,
} from "@mealplanner/db/services/plans";
import type { CallerContext } from "../auth/context";
import { enqueueJob } from "./jobs";
import { memberNames } from "./reads";
import { ProblemError, notFound } from "./problem";
import type { Runtime } from "./runtime";

const MAX_PLAN_RANGE_DAYS = 31;

type PlateRow = typeof plate.$inferSelect;
type ItemRow = typeof plateItem.$inferSelect;

function dayDiff(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** May the caller see this member's plate, and its target? */
function plateAccess(caller: CallerContext, memberId: string): { see: boolean; targets: boolean } {
  if (caller.ctx.role === "admin") return { see: true, targets: true };
  if (caller.ctx.role === "kitchen") return { see: false, targets: false };
  if (memberId === caller.memberId) return { see: true, targets: true };
  return { see: caller.household.membersSeePlates, targets: false };
}

function plateDto(
  caller: CallerContext,
  p: PlateRow,
  items: readonly ItemRow[],
  mealDishId: string,
  dishOf: ReadonlyMap<string, string>,
) {
  const access = plateAccess(caller, p.memberId);
  const target = p.target as unknown as StoredTarget | null;
  const dev = p.deviation as unknown as Partial<StoredDeviation>;
  const showTarget = access.targets && !isUntargeted(target);
  return {
    id: p.id,
    planMealId: p.planMealId,
    memberId: p.memberId,
    fitStatus: p.fitStatus,
    items: items.map((i) => ({
      componentId: i.componentId,
      variantId: i.variantId,
      cookedG: i.cookedG,
      side: (dishOf.get(i.componentId) ?? mealDishId) !== mealDishId,
    })),
    actual: p.actual as unknown as Nutrients,
    target:
      showTarget && !isUntargeted(target)
        ? {
            kcal: target.kcal,
            protein: target.protein,
            carbs: target.carbs,
            fat: target.fat,
            tolerance: { ...target.tol },
            carbBasis: target.carbBasis,
          }
        : null,
    deviation: showTarget
      ? { kcal: dev.kcal ?? 0, protein: dev.protein ?? 0, carbs: dev.carbs ?? 0, fat: dev.fat ?? 0 }
      : null,
  };
}

/** Plan days in [from, to] as DTOs (the household's own rows only). */
export async function planDays(
  rt: Runtime,
  caller: CallerContext,
  from: string,
  to: string,
  opts: { mealId?: string } = {},
) {
  if (dayDiff(from, to) < 0 || dayDiff(from, to) > MAX_PLAN_RANGE_DAYS)
    throw new ProblemError(
      400,
      "invalid_range",
      `from..to must span 0–${String(MAX_PLAN_RANGE_DAYS)} days`,
    );
  const hh = caller.ctx.householdId;
  const days = await rt.db
    .select()
    .from(planDay)
    .where(and(eq(planDay.householdId, hh), gte(planDay.date, from), lte(planDay.date, to)));
  return { days: await dayDtos(rt, caller, days, opts.mealId) };
}

async function dayDtos(
  rt: Runtime,
  caller: CallerContext,
  days: (typeof planDay.$inferSelect)[],
  onlyMealId?: string,
) {
  const hh = caller.ctx.householdId;
  if (days.length === 0) return [];
  let meals = await rt.db
    .select()
    .from(planMeal)
    .where(
      and(
        eq(planMeal.householdId, hh),
        inArray(
          planMeal.planDayId,
          days.map((d) => d.id),
        ),
      ),
    );
  if (onlyMealId !== undefined) meals = meals.filter((m) => m.id === onlyMealId);
  const plates =
    meals.length === 0
      ? []
      : await rt.db
          .select()
          .from(plate)
          .where(
            and(
              eq(plate.householdId, hh),
              inArray(
                plate.planMealId,
                meals.map((m) => m.id),
              ),
            ),
          );
  const items =
    plates.length === 0
      ? []
      : await rt.db
          .select()
          .from(plateItem)
          .where(
            and(
              eq(plateItem.householdId, hh),
              inArray(
                plateItem.plateId,
                plates.map((p) => p.id),
              ),
            ),
          );
  const slots = new Map(
    (await createRepos(rt.db, caller.ctx).slot_type.list()).map((s) => [s.id, s]),
  );
  const dishIds = [...new Set(meals.map((m) => m.dishId))];
  const dishes = new Map(
    (dishIds.length === 0
      ? []
      : await rt.db
          .select({ id: dish.id, name: dish.name })
          .from(dish)
          .where(inArray(dish.id, dishIds))
    ).map((d) => [d.id, d.name]),
  );
  const componentIds = [...new Set(items.map((i) => i.componentId))];
  const dishOf = new Map(
    (componentIds.length === 0
      ? []
      : await rt.db
          .select({ id: component.id, dishId: component.dishId })
          .from(component)
          .where(inArray(component.id, componentIds))
    ).map((c) => [c.id, c.dishId]),
  );
  const dateOf = new Map(days.map((d) => [d.id, d.date]));
  const mealDtos = meals.flatMap((m) => {
    const slot = slots.get(m.slotTypeId);
    if (slot === undefined) return [];
    const stored = m.scoreBreakdown as unknown as Partial<StoredBreakdown>;
    const { meal: meta, ...breakdown } = stored;
    return [
      {
        planDayId: m.planDayId,
        dto: {
          id: m.id,
          date: dateOf.get(m.planDayId) ?? "",
          slotTypeId: slot.id,
          slotKey: slot.key,
          slotLabel: slot.label,
          time: slot.defaultTime,
          kind: meta?.kind ?? (m.memberScope === "shared" ? "shared" : "individual"),
          memberScope: m.memberScope,
          attendees: meta?.attendees ?? [],
          splitMembers: meta?.splitMembers ?? [],
          dishId: m.dishId,
          dishName: dishes.get(m.dishId) ?? "",
          dishVersion: m.dishVersion,
          locked: m.locked,
          status: m.status,
          scoreBreakdown:
            caller.ctx.role === "admin" && breakdown.total !== undefined
              ? (breakdown as ScoreBreakdown)
              : null,
          plates: plates
            .filter((p) => p.planMealId === m.id && plateAccess(caller, p.memberId).see)
            .map((p) =>
              plateDto(
                caller,
                p,
                items.filter((i) => i.plateId === p.id),
                m.dishId,
                dishOf,
              ),
            ),
        },
      },
    ];
  });
  return days
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      id: d.id,
      date: d.date,
      status: d.status,
      generatedAt: d.generatedAt.toISOString(),
      meals: mealDtos
        .filter((m) => m.planDayId === d.id)
        .map((m) => m.dto)
        .sort(
          (a, b) =>
            a.time.localeCompare(b.time) ||
            a.slotKey.localeCompare(b.slotKey) ||
            a.memberScope.localeCompare(b.memberScope),
        ),
    }));
}

export async function mealDto(rt: Runtime, caller: CallerContext, id: string) {
  const m = await createRepos(rt.db, caller.ctx).plan_meal.get({ id });
  if (m === null) throw notFound("plan meal");
  const day = await createRepos(rt.db, caller.ctx).plan_day.get({ id: m.planDayId });
  if (day === null) throw notFound("plan day");
  const [dto] = (await dayDtos(rt, caller, [day], id)).flatMap((d) => d.meals);
  if (dto === undefined) throw notFound("plan meal");
  return dto;
}

export async function getPlate(rt: Runtime, caller: CallerContext, id: string) {
  const p = await createRepos(rt.db, caller.ctx).plate.get({ id });
  if (p === null || !plateAccess(caller, p.memberId).see) throw notFound("plate");
  const meal = await createRepos(rt.db, caller.ctx).plan_meal.get({ id: p.planMealId });
  if (meal === null) throw notFound("plate");
  const items = await createRepos(rt.db, caller.ctx).plate_item.list({ plateId: id });
  const dishOf = new Map(
    (items.length === 0
      ? []
      : await rt.db
          .select({ id: component.id, dishId: component.dishId })
          .from(component)
          .where(
            inArray(
              component.id,
              items.map((i) => i.componentId),
            ),
          )
    ).map((c) => [c.id, c.dishId]),
  );
  return plateDto(caller, p, items, meal.dishId, dishOf);
}

export async function generate(
  rt: Runtime,
  caller: CallerContext,
  body: { dates: string[]; seed: number },
) {
  const jobId = await enqueueJob(rt.db, rt.queue, {
    kind: "plan.generate",
    householdId: caller.ctx.householdId,
    payload: { dates: [...new Set(body.dates)].sort(), seed: body.seed, source: "ui" },
    createdByUserId: caller.ctx.userId,
  });
  return { jobId };
}

export async function alternatives(rt: Runtime, caller: CallerContext, planMealId: string) {
  const result = await planAlternatives(rt.db, caller.ctx, planMealId);
  return {
    current: result.current.scoreBreakdown,
    alternatives: result.alternatives.map((a) => ({
      dishId: a.dishId,
      dishName: a.dishName,
      scoreBreakdown: a.meal.scoreBreakdown,
      plates: a.meal.plates.map((p) => ({ memberId: p.memberId, fitStatus: p.fitStatus })),
    })),
  };
}

export async function swap(rt: Runtime, caller: CallerContext, planMealId: string, dishId: string) {
  const applied = await swapMeal(rt.db, caller.ctx, {
    planMealId,
    dishId,
    by: { actor: "user", source: "ui" },
  });
  return { changeSetId: applied.changeSetId, meal: await mealDto(rt, caller, planMealId) };
}

export async function setLock(
  rt: Runtime,
  caller: CallerContext,
  planMealId: string,
  locked: boolean,
) {
  const applied = await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: locked ? "Lock meal" : "Unlock meal",
    ops: [{ kind: locked ? "plan.lock" : "plan.unlock", payload: { planMealId } }],
  });
  return { changeSetId: applied.changeSetId };
}

/**
 * PLN-13: an admin sets a plate's grams; the plate is re-scored against its stored target: the
 * new actual, deviation and fit status (in tolerance when every macro is within its band;
 * otherwise a flexible miss in flexible mode, infeasible in strict mode).
 */
export async function overridePlate(
  rt: Runtime,
  caller: CallerContext,
  plateId: string,
  items: ReadonlyArray<{ componentId: string; variantId: string; cookedG: number }>,
) {
  const p = await createRepos(rt.db, caller.ctx).plate.get({ id: plateId });
  if (p === null) throw notFound("plate");
  const state = await loadMealState(rt.db, caller.ctx, p.planMealId);
  const variants = new Map(
    [...state.pool.byId.values()].flatMap((d) =>
      d.components.flatMap((c) => c.variants.map((v) => [v.id, { v, c }] as const)),
    ),
  );
  const parts = items.map((i) => {
    const found = variants.get(i.variantId);
    if (found === undefined || found.c.id !== i.componentId)
      throw new ProblemError(
        422,
        "unknown_variant",
        `variant ${i.variantId} is not a variant of component ${i.componentId}`,
      );
    return { per100g: found.v.per100g, cookedG: i.cookedG, variant: found.v };
  });
  const actual = plateNutrients(parts);
  const target = p.target as unknown as StoredTarget | null;
  let fitStatus = p.fitStatus;
  const deviation: StoredDeviation = {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    shortfall: { fibre: 0, solubleFibre: 0 },
    objective: 0,
    fit: 1,
    explain: ["Grams set by an admin"],
    flag: null,
  };
  if (target !== null && !isUntargeted(target)) {
    const carbs = target.carbBasis === "total" ? actual.carbs + actual.fibre : actual.carbs;
    deviation.kcal = actual.kcal - target.kcal;
    deviation.protein = actual.protein - target.protein;
    deviation.carbs = carbs - target.carbs;
    deviation.fat = actual.fat - target.fat;
    const keys = ["kcal", "protein", "carbs", "fat"] as const;
    // Macros within tolerance and saturated fat under its hard cap (OQ-4), as the solver requires.
    const satFatOk = target.satFatMax === undefined || actual.satFat <= target.satFatMax + 1e-6;
    const within = satFatOk && keys.every((k) => Math.abs(deviation[k]) <= target.tol[k] + 1e-6);
    const meanRel =
      keys.reduce((s, k) => s + Math.abs(deviation[k]) / Math.max(target.tol[k], 1e-6), 0) /
      keys.length;
    deviation.fit = within ? Math.max(0, Math.min(1, 1 - meanRel)) : 0;
    fitStatus = within
      ? "in_tolerance"
      : target.mode === "flexible"
        ? "flexible_miss"
        : "infeasible";
    deviation.flag = within
      ? null
      : satFatOk
        ? "Grams set by an admin are outside the tolerance"
        : "Grams set by an admin exceed the saturated-fat limit";
  }
  const applied = await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: "Override plate grams",
    ops: [
      {
        kind: "plate.override",
        payload: {
          plateId,
          fitStatus,
          actual: JSON.parse(JSON.stringify(actual)) as object,
          deviation: JSON.parse(JSON.stringify(deviation)) as object,
          items: items.map((i) => ({ ...i, rawEquivalent: {} })),
        },
      },
    ],
  });
  return { changeSetId: applied.changeSetId, plate: await getPlate(rt, caller, plateId) };
}

export async function cookSheet(rt: Runtime, caller: CallerContext, date: string) {
  // ARC-6 (SPEC-Q-17): the sheet is built with the names the caller may see, so side labels,
  // notes and banners never carry a hidden name; tolerance notes (target deviations) are for
  // admins; a member sees only the plating rows of plates they may see.
  const names = await memberNames(rt, caller);
  const { sheet, mealIds } = await cookSheetFor(rt.db, caller.ctx, date, {
    names,
    hideFlags: caller.ctx.role !== "admin",
  });
  const nameOf = (id: string, fallback: string) => names.get(id) ?? fallback;
  const visible = (memberId: string) =>
    caller.ctx.role !== "member" || plateAccess(caller, memberId).see;
  const day = sheet.days[0];
  return {
    date,
    banner: sheet.banner,
    meals: (day?.meals ?? []).map((m) => ({
      planMealId: mealIds[`${m.slotKey}|${m.memberScope}`] ?? "",
      slotKey: m.slotKey,
      slotLabel: m.slotLabel,
      time: m.time,
      kind: m.kind,
      dishId: m.dishId,
      dishName: m.dishName,
      cuisineKey: m.cuisineKey,
      batches: m.batches,
      plating: {
        columns: m.plating.columns,
        rows: m.plating.rows
          .filter((r) => visible(r.memberId))
          .map((r) => ({
            memberId: r.memberId,
            memberName: nameOf(r.memberId, r.memberName),
            cells: r.cells,
            sides: r.sides,
          })),
      },
      notes: m.notes,
      allergyBanners: m.allergyBanners.map((b) => ({
        memberName: nameOf(b.memberId, b.memberName),
        allergen: b.allergen,
        text: b.text,
      })),
    })),
  };
}

/**
 * R2-UX-1 kitchen flags: stored as a kitchen-tag review (`ingredient_unavailable` on the
 * ingredient, `recipe_unclear` on the variant), and an unavailable flag queues `plates.substitute`.
 */
export async function kitchenFlag(
  rt: Runtime,
  caller: CallerContext,
  date: string,
  body:
    | {
        kind: "unavailable";
        ingredientId: string;
        planMealId?: string | undefined;
        note?: string | undefined;
      }
    | {
        kind: "unclear";
        variantId: string;
        planMealId?: string | undefined;
        note?: string | undefined;
      },
) {
  const review = await createReview(rt.db, caller.ctx, {
    targetType: body.kind === "unavailable" ? "ingredient" : "variant",
    targetId: body.kind === "unavailable" ? body.ingredientId : body.variantId,
    planMealId: body.planMealId ?? null,
    onBehalfOfMemberId: null,
    tags: [body.kind === "unavailable" ? "ingredient_unavailable" : "recipe_unclear"],
    comment: body.note ?? null,
  });
  let jobId: string | null = null;
  if (body.kind === "unavailable")
    jobId = await enqueueJob(rt.db, rt.queue, {
      kind: "plates.substitute",
      householdId: caller.ctx.householdId,
      payload: { date, ingredientId: body.ingredientId, reviewId: review.review.id },
      createdByUserId: caller.ctx.userId,
    });
  return { reviewId: review.review.id, jobId };
}
