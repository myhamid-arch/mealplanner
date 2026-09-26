// weights.set, preset.upsert, preset.delete, adjusters.set (AGT-6, 02 §6, PLN-6, BLD-8 R-9 d).
import { z } from "zod";
import { AI_GENERATION_MODES, DEFAULT_PLANNING_WEIGHTS } from "../../types/index.js";
import { defineOp, definedFields, requireRow } from "../define.js";
import { ChangeOpError } from "../tx.js";
import { id, share01, weekday } from "./common.js";

const WeightFields = z.object({
  macroPrecision: share01,
  appeal: share01,
  ingredientEconomy: share01,
  variety: share01,
  fairness: share01,
  aiGeneration: z.enum(AI_GENERATION_MODES),
  economyWindowDays: z.number().int().min(1).max(60),
  adjustersEnabled: z.boolean(),
  maxVariantsPerComponent: z.number().int().min(1).max(10),
});

export const weightsSet = defineOp({
  kind: "weights.set",
  area: "planning",
  schema: WeightFields.partial()
    .strict()
    .refine((p) => Object.keys(p).length > 0, "at least one field"),
  title: (p) => `Change planning weights (${Object.keys(p).join(", ")})`,
  apply: async (tx, p) => {
    const key = { householdId: tx.householdId };
    const current = await tx.get("planning_weights", key);
    if (current === null) {
      await tx.insert("planning_weights", {
        ...key,
        ...DEFAULT_PLANNING_WEIGHTS,
        ...definedFields(p),
        updatedAt: tx.now(),
      });
    } else {
      await tx.update("planning_weights", key, { ...definedFields(p), updatedAt: tx.now() });
    }
  },
});

/** Preset values are a partial set of the numeric weights (02 §6 weight_preset). */
const PresetValues = z
  .object({
    macroPrecision: share01,
    appeal: share01,
    ingredientEconomy: share01,
    variety: share01,
    fairness: share01,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "at least one weight");

export const presetUpsert = defineOp({
  kind: "preset.upsert",
  area: "planning",
  schema: z
    .object({
      id: id.optional(),
      name: z.string().trim().min(1).max(60),
      values: PresetValues,
      appliesToWeekdays: z.array(weekday).min(1).nullable().default(null),
    })
    .strict()
    .refine(
      (p) =>
        p.appliesToWeekdays === null ||
        new Set(p.appliesToWeekdays).size === p.appliesToWeekdays.length,
      "duplicate weekday",
    ),
  title: (p) => `Save preset "${p.name}"`,
  apply: async (tx, { id: presetId, name, values, appliesToWeekdays }) => {
    const weekdays =
      appliesToWeekdays === null ? null : [...appliesToWeekdays].sort((a, b) => a - b);
    const existing =
      presetId === undefined ? null : await tx.get("weight_preset", { id: presetId });
    const clash = (await tx.find("weight_preset", { name })).find((row) => row.id !== presetId);
    if (clash !== undefined)
      throw new ChangeOpError("preset.upsert", `a preset named "${name}" exists`);
    if (existing === null) {
      await tx.insert("weight_preset", {
        id: presetId ?? tx.newId(),
        householdId: tx.householdId,
        name,
        values,
        appliesToWeekdays: weekdays,
      });
    } else {
      await tx.update(
        "weight_preset",
        { id: existing.id },
        { name, values, appliesToWeekdays: weekdays },
      );
    }
  },
});

export const presetDelete = defineOp({
  kind: "preset.delete",
  area: "planning",
  schema: z.object({ presetId: id }).strict(),
  title: () => "Delete preset",
  apply: async (tx, { presetId }) => {
    await requireRow(
      "preset.delete",
      `preset ${presetId}`,
      tx.get("weight_preset", { id: presetId }),
    );
    await tx.remove("weight_preset", { id: presetId });
  },
});

/** PLN-6: switch adjusters on/off and edit which adjuster dishes the household allows. */
export const adjustersSet = defineOp({
  kind: "adjusters.set",
  area: "planning",
  schema: z
    .object({
      enabled: z.boolean().optional(),
      dishes: z.array(z.object({ dishId: id, enabled: z.boolean() }).strict()).optional(),
    })
    .strict()
    .refine((p) => p.enabled !== undefined || (p.dishes?.length ?? 0) > 0, "nothing to change")
    .refine(
      (p) =>
        p.dishes === undefined || new Set(p.dishes.map((d) => d.dishId)).size === p.dishes.length,
      "duplicate dish",
    ),
  title: (p) =>
    p.enabled === undefined
      ? "Edit adjuster list"
      : `${p.enabled ? "Enable" : "Disable"} adjusters`,
  apply: async (tx, { enabled, dishes }) => {
    if (enabled !== undefined) {
      const key = { householdId: tx.householdId };
      const current = await tx.get("planning_weights", key);
      if (current === null) {
        await tx.insert("planning_weights", {
          ...key,
          ...DEFAULT_PLANNING_WEIGHTS,
          adjustersEnabled: enabled,
          updatedAt: tx.now(),
        });
      } else {
        await tx.update("planning_weights", key, {
          adjustersEnabled: enabled,
          updatedAt: tx.now(),
        });
      }
    }
    for (const entry of dishes ?? []) {
      const dish = await requireRow(
        "adjusters.set",
        `dish ${entry.dishId}`,
        tx.get("dish", { id: entry.dishId }),
      );
      const components = await tx.find("component", { dishId: dish.id });
      if (components.length !== 1 || components[0]?.role !== "adjuster")
        throw new ChangeOpError(
          "adjusters.set",
          `dish ${dish.slug} is not a single-component adjuster (PLN-6)`,
        );
      const key = { householdId: tx.householdId, dishId: entry.dishId };
      const existing = await tx.get("household_adjuster", key);
      if (existing === null)
        await tx.insert("household_adjuster", { ...key, enabled: entry.enabled });
      else if (existing.enabled !== entry.enabled)
        await tx.update("household_adjuster", key, { enabled: entry.enabled });
    }
  },
});
