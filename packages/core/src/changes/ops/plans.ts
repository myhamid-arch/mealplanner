// plan.lock, plan.unlock, plan.swap_dish, plate.override (AGT-6, PLN-13), plan.save_days (BLD-8
// R-10), meal_override.set, meal_override.remove (R2-MEAL-2). The planner (core, pure) computes
// plates; these ops persist what it computed.
import { z } from "zod";
import {
  FIT_STATUSES,
  MEAL_OVERRIDE_KINDS,
  PLAN_DAY_STATUSES,
  PLAN_MEAL_STATUSES,
  type Json,
} from "../../types/index.js";
import { defineOp, requireRow } from "../define.js";
import { ChangeOpError, type ChangeTx } from "../tx.js";
import { grams, id, isoDate } from "./common.js";

const json = z.json() as z.ZodType<Json>;
const gramsById = z.record(id, grams);

const PlateItem = z
  .object({ componentId: id, variantId: id, cookedG: grams, rawEquivalent: gramsById })
  .strict();

const Plate = z
  .object({
    memberId: id,
    fitStatus: z.enum(FIT_STATUSES),
    target: json,
    actual: json,
    deviation: json,
    items: z.array(PlateItem),
  })
  .strict();

const CookBatch = z
  .object({
    variantId: id,
    totalCookedG: grams,
    rawIngredients: gramsById,
    servings: z.number().int().min(1),
  })
  .strict();

const uniqueMembers = (plates: { memberId: string }[]) =>
  new Set(plates.map((p) => p.memberId)).size === plates.length;

const Meal = z
  .object({
    id: id.optional(),
    slotTypeId: id,
    dishId: id,
    memberScope: z.union([z.literal("shared"), id]),
    scoreBreakdown: json,
    status: z.enum(PLAN_MEAL_STATUSES).default("planned"),
    plates: z.array(Plate).refine(uniqueMembers, "one plate per member"),
    cookBatches: z.array(CookBatch).default([]),
  })
  .strict();

type PlateInput = z.output<typeof Plate>;
type CookBatchInput = z.output<typeof CookBatch>;
type MealInput = z.output<typeof Meal>;

async function requireMeal(kind: string, tx: ChangeTx, planMealId: string) {
  return requireRow(kind, `plan meal ${planMealId}`, tx.get("plan_meal", { id: planMealId }));
}

/** Components and variants a plate may use: those of the dish (and the household's adjusters). */
async function dishParts(tx: ChangeTx, dishId: string) {
  const components = new Map<string, Set<string>>();
  const dishIds = [
    dishId,
    ...(await tx.find("household_adjuster", { enabled: true })).map((a) => a.dishId),
  ];
  for (const d of dishIds) {
    for (const c of await tx.find("component", { dishId: d })) {
      components.set(
        c.id,
        new Set((await tx.find("variant", { componentId: c.id })).map((v) => v.id)),
      );
    }
  }
  return components;
}

async function checkItems(
  kind: string,
  tx: ChangeTx,
  dishId: string,
  items: PlateInput["items"],
  batches: CookBatchInput[],
) {
  const parts = await dishParts(tx, dishId);
  for (const item of items) {
    const variants = parts.get(item.componentId);
    if (variants === undefined)
      throw new ChangeOpError(kind, `component ${item.componentId} is not part of the dish`);
    if (!variants.has(item.variantId))
      throw new ChangeOpError(
        kind,
        `variant ${item.variantId} is not a variant of component ${item.componentId}`,
      );
  }
  const allVariants = new Set([...parts.values()].flatMap((v) => [...v]));
  for (const batch of batches) {
    if (!allVariants.has(batch.variantId))
      throw new ChangeOpError(
        kind,
        `cook batch variant ${batch.variantId} is not part of the dish`,
      );
  }
}

async function insertPlates(
  kind: string,
  tx: ChangeTx,
  planMealId: string,
  dishId: string,
  plates: PlateInput[],
  batches: CookBatchInput[],
) {
  await checkItems(
    kind,
    tx,
    dishId,
    plates.flatMap((p) => p.items),
    batches,
  );
  for (const plate of plates) {
    await requireRow(kind, `member ${plate.memberId}`, tx.get("member", { id: plate.memberId }));
    const plateId = tx.newId();
    await tx.insert("plate", {
      id: plateId,
      householdId: tx.householdId,
      planMealId,
      memberId: plate.memberId,
      fitStatus: plate.fitStatus,
      target: plate.target,
      actual: plate.actual,
      deviation: plate.deviation,
    });
    for (const item of plate.items)
      await tx.insert("plate_item", {
        id: tx.newId(),
        householdId: tx.householdId,
        plateId,
        ...item,
      });
  }
  for (const batch of batches)
    await tx.insert("cook_batch", {
      id: tx.newId(),
      householdId: tx.householdId,
      planMealId,
      ...batch,
    });
}

async function deletePlates(tx: ChangeTx, planMealId: string) {
  for (const plate of await tx.find("plate", { planMealId })) {
    for (const item of await tx.find("plate_item", { plateId: plate.id }))
      await tx.remove("plate_item", { id: item.id });
    await tx.remove("plate", { id: plate.id });
  }
  for (const batch of await tx.find("cook_batch", { planMealId }))
    await tx.remove("cook_batch", { id: batch.id });
}

async function insertMeal(kind: string, tx: ChangeTx, planDayId: string, meal: MealInput) {
  await requireRow(kind, `slot ${meal.slotTypeId}`, tx.get("slot_type", { id: meal.slotTypeId }));
  const dish = await requireRow(kind, `dish ${meal.dishId}`, tx.get("dish", { id: meal.dishId }));
  if (meal.memberScope !== "shared")
    await requireRow(
      kind,
      `member ${meal.memberScope}`,
      tx.get("member", { id: meal.memberScope }),
    );
  const planMealId = meal.id ?? tx.newId();
  await tx.insert("plan_meal", {
    id: planMealId,
    householdId: tx.householdId,
    planDayId,
    slotTypeId: meal.slotTypeId,
    dishId: dish.id,
    dishVersion: dish.version,
    memberScope: meal.memberScope,
    locked: false,
    scoreBreakdown: meal.scoreBreakdown,
    status: meal.status,
  });
  await insertPlates(kind, tx, planMealId, dish.id, meal.plates, meal.cookBatches);
}

export const planLock = defineOp({
  kind: "plan.lock",
  area: "plans",
  schema: z.object({ planMealId: id }).strict(),
  title: () => "Lock meal",
  apply: async (tx, { planMealId }) => {
    const meal = await requireMeal("plan.lock", tx, planMealId);
    if (meal.locked) throw new ChangeOpError("plan.lock", "meal is already locked");
    await tx.update("plan_meal", { id: planMealId }, { locked: true });
  },
});

export const planUnlock = defineOp({
  kind: "plan.unlock",
  area: "plans",
  schema: z.object({ planMealId: id }).strict(),
  title: () => "Unlock meal",
  apply: async (tx, { planMealId }) => {
    const meal = await requireMeal("plan.unlock", tx, planMealId);
    if (!meal.locked) throw new ChangeOpError("plan.unlock", "meal is not locked");
    await tx.update("plan_meal", { id: planMealId }, { locked: false });
  },
});

/** PLN-13: swap the dish of one meal; the caller supplies the re-solved plates and batches. */
export const planSwapDish = defineOp({
  kind: "plan.swap_dish",
  area: "plans",
  schema: z
    .object({
      planMealId: id,
      dishId: id,
      scoreBreakdown: json,
      plates: z.array(Plate).refine(uniqueMembers, "one plate per member"),
      cookBatches: z.array(CookBatch).default([]),
    })
    .strict(),
  title: () => "Swap dish",
  apply: async (tx, { planMealId, dishId, scoreBreakdown, plates, cookBatches }) => {
    const meal = await requireMeal("plan.swap_dish", tx, planMealId);
    const dish = await requireRow(
      "plan.swap_dish",
      `dish ${dishId}`,
      tx.get("dish", { id: dishId }),
    );
    if (dish.status !== "active")
      throw new ChangeOpError("plan.swap_dish", "only active dishes can be planned");
    await deletePlates(tx, planMealId);
    await tx.update(
      "plan_meal",
      { id: meal.id },
      { dishId, dishVersion: dish.version, scoreBreakdown },
    );
    await insertPlates("plan.swap_dish", tx, planMealId, dishId, plates, cookBatches);
  },
});

/** PLN-13: an admin overrides the grams on one plate; the caller supplies the re-scored result. */
export const plateOverride = defineOp({
  kind: "plate.override",
  area: "plans",
  schema: z
    .object({
      plateId: id,
      fitStatus: z.enum(FIT_STATUSES),
      actual: json,
      deviation: json,
      items: z.array(PlateItem).min(1),
    })
    .strict(),
  title: () => "Override plate grams",
  apply: async (tx, { plateId, fitStatus, actual, deviation, items }) => {
    const plate = await requireRow(
      "plate.override",
      `plate ${plateId}`,
      tx.get("plate", { id: plateId }),
    );
    const meal = await requireMeal("plate.override", tx, plate.planMealId);
    await checkItems("plate.override", tx, meal.dishId, items, []);
    for (const item of await tx.find("plate_item", { plateId }))
      await tx.remove("plate_item", { id: item.id });
    await tx.update("plate", { id: plateId }, { fitStatus, actual, deviation });
    for (const item of items)
      await tx.insert("plate_item", {
        id: tx.newId(),
        householdId: tx.householdId,
        plateId,
        ...item,
      });
  },
});

/**
 * BLD-8 R-10: replaces the unlocked meals (with their plates and cook batches) of each given date.
 * Locked meals are kept; a new meal may not take the slot and scope of a locked one.
 */
export const planSaveDays = defineOp({
  kind: "plan.save_days",
  area: "plans",
  schema: z
    .object({
      days: z
        .array(
          z
            .object({
              date: isoDate,
              status: z.enum(PLAN_DAY_STATUSES).default("draft"),
              weightsSnapshot: json,
              generatedAt: z.iso.datetime({ offset: true }),
              generatorVersion: z.string().min(1).max(60),
              meals: z.array(Meal),
            })
            .strict(),
        )
        .min(1)
        .refine((days) => new Set(days.map((d) => d.date)).size === days.length, "duplicate date"),
    })
    .strict(),
  title: (p) =>
    p.days.length === 1
      ? `Save plan for ${p.days[0]?.date ?? ""}`
      : `Save plans for ${String(p.days.length)} days`,
  apply: async (tx, { days }) => {
    for (const day of days) {
      const generatedAt = new Date(day.generatedAt);
      const [existing] = await tx.find("plan_day", { date: day.date });
      let planDayId: string;
      if (existing === undefined) {
        planDayId = tx.newId();
        await tx.insert("plan_day", {
          id: planDayId,
          householdId: tx.householdId,
          date: day.date,
          status: day.status,
          weightsSnapshot: day.weightsSnapshot,
          generatedAt,
          generatorVersion: day.generatorVersion,
        });
      } else {
        planDayId = existing.id;
        await tx.update(
          "plan_day",
          { id: planDayId },
          {
            status: day.status,
            weightsSnapshot: day.weightsSnapshot,
            generatedAt,
            generatorVersion: day.generatorVersion,
          },
        );
      }
      const oldMeals = await tx.find("plan_meal", { planDayId });
      const locked = new Set(
        oldMeals.filter((m) => m.locked).map((m) => `${m.slotTypeId}/${m.memberScope}`),
      );
      for (const meal of oldMeals) {
        if (meal.locked) continue;
        if ((await tx.find("review", { planMealId: meal.id })).length > 0)
          throw new ChangeOpError(
            "plan.save_days",
            `meal ${meal.id} has reviews; lock it to keep it`,
          );
        await deletePlates(tx, meal.id);
        await tx.remove("plan_meal", { id: meal.id });
      }
      const seen = new Set<string>();
      for (const meal of day.meals) {
        const slotScope = `${meal.slotTypeId}/${meal.memberScope}`;
        if (locked.has(slotScope))
          throw new ChangeOpError(
            "plan.save_days",
            `${day.date}: slot ${meal.slotTypeId} (${meal.memberScope}) is locked`,
          );
        if (seen.has(slotScope))
          throw new ChangeOpError(
            "plan.save_days",
            `${day.date}: two meals for slot ${meal.slotTypeId} (${meal.memberScope})`,
          );
        seen.add(slotScope);
        await insertMeal("plan.save_days", tx, planDayId, meal);
      }
    }
  },
});

export const mealOverrideSet = defineOp({
  kind: "meal_override.set",
  area: "plans",
  schema: z
    .object({
      planDate: isoDate,
      slotTypeId: id,
      kind: z.enum(MEAL_OVERRIDE_KINDS),
      memberIds: z.array(id).default([]),
    })
    .strict()
    .refine(
      (p) => (p.kind === "split_member") === p.memberIds.length > 0,
      "split_member names members; make_individual names none",
    )
    .refine((p) => new Set(p.memberIds).size === p.memberIds.length, "duplicate member"),
  title: (p) =>
    p.kind === "make_individual"
      ? `Make the meal individual on ${p.planDate}`
      : `Give ${String(p.memberIds.length)} member(s) their own dish on ${p.planDate}`,
  apply: async (tx, { planDate, slotTypeId, kind, memberIds }) => {
    if (tx.actorUserId === null)
      throw new ChangeOpError("meal_override.set", "a meal override is made by a user");
    const slot = await requireRow(
      "meal_override.set",
      `slot ${slotTypeId}`,
      tx.get("slot_type", { id: slotTypeId }),
    );
    if (!slot.isShared)
      throw new ChangeOpError("meal_override.set", "the slot is already individual");
    for (const memberId of memberIds)
      await requireRow(
        "meal_override.set",
        `member ${memberId}`,
        tx.get("member", { id: memberId }),
      );
    const sorted = [...memberIds].sort();
    const [existing] = await tx.find("meal_override", { planDate, slotTypeId });
    if (existing === undefined) {
      await tx.insert("meal_override", {
        id: tx.newId(),
        householdId: tx.householdId,
        planDate,
        slotTypeId,
        kind,
        memberIds: sorted,
        createdBy: tx.actorUserId,
        createdAt: tx.now(),
      });
    } else {
      await tx.update(
        "meal_override",
        { id: existing.id },
        { kind, memberIds: sorted, createdBy: tx.actorUserId, createdAt: tx.now() },
      );
    }
  },
});

export const mealOverrideRemove = defineOp({
  kind: "meal_override.remove",
  area: "plans",
  schema: z.object({ planDate: isoDate, slotTypeId: id }).strict(),
  title: (p) => `Remove the meal override on ${p.planDate}`,
  apply: async (tx, { planDate, slotTypeId }) => {
    const [existing] = await tx.find("meal_override", { planDate, slotTypeId });
    if (existing === undefined)
      throw new ChangeOpError("meal_override.remove", "no override for that date and slot");
    await tx.remove("meal_override", { id: existing.id });
  },
});
