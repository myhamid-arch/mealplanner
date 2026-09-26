// dish.create, dish.update, dish.retire*, ingredient.create, ingredient.verify (AGT-6, 02 §3–§4).
// Only household dishes and household-private ingredients can be written; global seed rows are
// read-only through a household's change set.
import { z } from "zod";
import {
  COMPONENT_ROLES,
  COOKING_LIQUIDS,
  DIETARY_FLAGS,
  DISH_STATUSES,
  INGREDIENT_CATEGORIES,
  LOCALE_AVAILABILITIES,
  NUTRITION_CONFIDENCES,
  PORTIONINGS,
  type ComponentRow,
  type VariantRow,
} from "../../types/index.js";
import { defineOp, definedFields, requireRow } from "../define.js";
import { ChangeOpError, type ChangeTx } from "../tx.js";
import { grams, id, slotKey } from "./common.js";

const IngredientLine = z
  .object({
    ingredientId: id,
    rawGPerBatch: z.number().positive().max(1_000_000),
    roleNote: z.string().max(120).nullable().default(null),
    isAbsorbedOil: z.boolean().default(false),
    cookingLiquid: z.enum(COOKING_LIQUIDS).nullable().default(null),
    yieldOverride: z.number().positive().nullable().default(null),
  })
  .strict();

const Variant = z
  .object({
    id: id.optional(),
    methodId: id,
    label: z.string().trim().min(1).max(60),
    isDefault: z.boolean(),
    steps: z.array(z.string().trim().min(1)).min(1),
    cookTimeMin: z.number().int().positive().nullable().default(null),
    notes: z.string().max(2000).nullable().default(null),
    referenceBatchCookedG: z.number().positive().default(1000),
    ingredients: z.array(IngredientLine).min(1),
  })
  .strict();

const Component = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1).max(80),
    role: z.enum(COMPONENT_ROLES),
    portioning: z.enum(PORTIONINGS),
    unitLabel: z.string().max(30).nullable().default(null),
    minServingG: grams,
    maxServingG: grams,
    defaultServingG: grams,
    stepG: z.number().positive().default(5),
    required: z.boolean(),
    variants: z.array(Variant).min(1),
  })
  .strict()
  .refine(
    (c) => c.minServingG <= c.defaultServingG && c.defaultServingG <= c.maxServingG,
    "min ≤ default ≤ max",
  )
  .refine((c) => c.variants.filter((v) => v.isDefault).length === 1, "exactly one default variant")
  .refine(
    (c) => c.portioning !== "unit" || c.unitLabel !== null,
    "unit portioning needs a unit label",
  );

const Components = z
  .array(Component)
  .min(1)
  .refine((cs) => {
    const ids = cs
      .flatMap((c) => [c.id, ...c.variants.map((v) => v.id)])
      .filter((x) => x !== undefined);
    return new Set(ids).size === ids.length;
  }, "duplicate component or variant id");

const DishFields = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,119}$/),
  description: z.string().max(2000),
  cuisineId: id,
  secondaryCuisineId: id.nullable(),
  slotKeys: z.array(slotKey).min(1),
  flavourTags: z.array(z.string().trim().min(1).max(40)),
  isPackable: z.boolean(),
  servedColdOk: z.boolean(),
  status: z.enum(DISH_STATUSES),
});

type ComponentInput = z.output<typeof Component>;
type VariantInput = z.output<typeof Variant>;

async function checkReferences(
  kind: string,
  tx: ChangeTx,
  dish: Partial<z.output<typeof DishFields>>,
  components?: ComponentInput[],
) {
  if (dish.cuisineId !== undefined)
    await requireRow(kind, `cuisine ${dish.cuisineId}`, tx.get("cuisine", { id: dish.cuisineId }));
  if (dish.secondaryCuisineId != null)
    await requireRow(
      kind,
      `cuisine ${dish.secondaryCuisineId}`,
      tx.get("cuisine", { id: dish.secondaryCuisineId }),
    );
  for (const c of components ?? []) {
    for (const v of c.variants) {
      await requireRow(
        kind,
        `method ${v.methodId}`,
        tx.get("preparation_method", { id: v.methodId }),
      );
      for (const line of v.ingredients)
        await requireRow(
          kind,
          `ingredient ${line.ingredientId}`,
          tx.get("ingredient", { id: line.ingredientId }),
        );
    }
  }
}

function componentRow(
  tx: ChangeTx,
  dishId: string,
  c: ComponentInput,
  componentId: string,
  sortOrder: number,
): ComponentRow {
  return {
    id: componentId,
    householdId: tx.householdId,
    dishId,
    name: c.name,
    role: c.role,
    portioning: c.portioning,
    unitLabel: c.unitLabel,
    minServingG: c.minServingG,
    maxServingG: c.maxServingG,
    defaultServingG: c.defaultServingG,
    stepG: c.stepG,
    sortOrder,
    required: c.required,
  };
}

function variantRow(
  tx: ChangeTx,
  componentId: string,
  v: VariantInput,
  variantId: string,
): VariantRow {
  return {
    id: variantId,
    householdId: tx.householdId,
    componentId,
    methodId: v.methodId,
    label: v.label,
    isDefault: v.isDefault,
    steps: v.steps,
    cookTimeMin: v.cookTimeMin,
    notes: v.notes,
    referenceBatchCookedG: v.referenceBatchCookedG,
    needsReview: false,
  };
}

async function insertLines(tx: ChangeTx, variantId: string, lines: VariantInput["ingredients"]) {
  for (const line of lines)
    await tx.insert("variant_ingredient", {
      id: tx.newId(),
      householdId: tx.householdId,
      variantId,
      ...line,
    });
}

async function insertComponent(tx: ChangeTx, dishId: string, c: ComponentInput, sortOrder: number) {
  const componentId = c.id ?? tx.newId();
  await tx.insert("component", componentRow(tx, dishId, c, componentId, sortOrder));
  for (const v of c.variants) {
    const variantId = v.id ?? tx.newId();
    await tx.insert("variant", variantRow(tx, componentId, v, variantId));
    await insertLines(tx, variantId, v.ingredients);
  }
}

async function deleteVariant(kind: string, tx: ChangeTx, variantId: string) {
  const used = [
    ...(await tx.find("plate_item", { variantId })),
    ...(await tx.find("cook_batch", { variantId })),
  ];
  if (used.length > 0)
    throw new ChangeOpError(kind, `variant ${variantId} is used in plans; retire the dish instead`);
  for (const line of await tx.find("variant_ingredient", { variantId }))
    await tx.remove("variant_ingredient", { id: line.id });
  if ((await tx.get("dish_nutrition_cache", { variantId })) !== null)
    await tx.remove("dish_nutrition_cache", { variantId });
  await tx.remove("variant", { id: variantId });
}

async function requireHouseholdDish(kind: string, tx: ChangeTx, dishId: string) {
  const dish = await requireRow(kind, `dish ${dishId}`, tx.get("dish", { id: dishId }));
  if (dish.householdId === null) throw new ChangeOpError(kind, "global seed dishes are read-only");
  return dish;
}

export const dishCreate = defineOp({
  kind: "dish.create",
  area: "recipes",
  schema: DishFields.partial({ secondaryCuisineId: true, flavourTags: true, status: true })
    .extend({
      id: id.optional(),
      source: z.enum(["admin", "ai"]).default("admin"),
      aiGenerationId: id.nullable().default(null),
      components: Components,
    })
    .strict(),
  title: (p) => `Add dish "${p.name}"`,
  apply: async (tx, p) => {
    await checkReferences("dish.create", tx, p, p.components);
    if ((await tx.find("dish", { slug: p.slug, householdId: tx.householdId })).length > 0)
      throw new ChangeOpError("dish.create", `a household dish with slug "${p.slug}" exists`);
    const dishId = p.id ?? tx.newId();
    const now = tx.now();
    await tx.insert("dish", {
      id: dishId,
      householdId: tx.householdId,
      name: p.name,
      slug: p.slug,
      description: p.description,
      cuisineId: p.cuisineId,
      secondaryCuisineId: p.secondaryCuisineId ?? null,
      slotKeys: p.slotKeys,
      flavourTags: p.flavourTags ?? [],
      isPackable: p.isPackable,
      servedColdOk: p.servedColdOk,
      source: p.source,
      status: p.status ?? "active",
      aiGenerationId: p.aiGenerationId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    for (const [index, c] of p.components.entries()) await insertComponent(tx, dishId, c, index);
  },
});

/**
 * Updates dish fields and/or replaces its component tree. Components and variants that keep their
 * id are updated in place (plans refer to them); ones left out are deleted; new ones are added.
 * The version is bumped.
 */
export const dishUpdate = defineOp({
  kind: "dish.update",
  area: "recipes",
  schema: DishFields.partial()
    .extend({ dishId: id, components: Components.optional() })
    .strict()
    .refine((p) => Object.keys(p).length > 1, "at least one field"),
  title: (p) =>
    `Edit dish (${Object.keys(p)
      .filter((k) => k !== "dishId")
      .join(", ")})`,
  apply: async (tx, { dishId, components, ...fields }) => {
    const dish = await requireHouseholdDish("dish.update", tx, dishId);
    await checkReferences("dish.update", tx, fields, components);
    if (fields.slug !== undefined && fields.slug !== dish.slug) {
      if ((await tx.find("dish", { slug: fields.slug, householdId: tx.householdId })).length > 0)
        throw new ChangeOpError(
          "dish.update",
          `a household dish with slug "${fields.slug}" exists`,
        );
    }
    await tx.update(
      "dish",
      { id: dishId },
      { ...definedFields(fields), version: dish.version + 1, updatedAt: tx.now() },
    );
    if (components === undefined) return;

    const existing = await tx.find("component", { dishId });
    const keptIds = new Set(components.map((c) => c.id).filter((x) => x !== undefined));
    for (const unknown of keptIds) {
      if (!existing.some((c) => c.id === unknown))
        throw new ChangeOpError("dish.update", `component ${unknown} does not belong to this dish`);
    }
    for (const old of existing) {
      if (keptIds.has(old.id)) continue;
      for (const v of await tx.find("variant", { componentId: old.id }))
        await deleteVariant("dish.update", tx, v.id);
      if ((await tx.find("plate_item", { componentId: old.id })).length > 0)
        throw new ChangeOpError(
          "dish.update",
          `component ${old.id} is used in plans; retire the dish instead`,
        );
      await tx.remove("component", { id: old.id });
    }
    for (const [index, c] of components.entries()) {
      if (c.id === undefined) {
        await insertComponent(tx, dishId, c, index);
        continue;
      }
      const { id: componentId, ...row } = componentRow(tx, dishId, c, c.id, index);
      await tx.update("component", { id: componentId }, row);
      const oldVariants = await tx.find("variant", { componentId });
      const keptVariants = new Set(c.variants.map((v) => v.id).filter((x) => x !== undefined));
      for (const unknown of keptVariants) {
        if (!oldVariants.some((v) => v.id === unknown))
          throw new ChangeOpError(
            "dish.update",
            `variant ${unknown} does not belong to component ${componentId}`,
          );
      }
      for (const old of oldVariants)
        if (!keptVariants.has(old.id)) await deleteVariant("dish.update", tx, old.id);
      for (const v of c.variants) {
        if (v.id === undefined) {
          const variantId = tx.newId();
          await tx.insert("variant", variantRow(tx, componentId, v, variantId));
          await insertLines(tx, variantId, v.ingredients);
          continue;
        }
        const { id: variantId, ...variantFields } = variantRow(tx, componentId, v, v.id);
        await tx.update("variant", { id: variantId }, variantFields);
        for (const line of await tx.find("variant_ingredient", { variantId }))
          await tx.remove("variant_ingredient", { id: line.id });
        await insertLines(tx, variantId, v.ingredients);
      }
    }
  },
});

/** AGT-5: retiring a dish that has reviews (on it, its components or variants) is protected. */
export async function dishHasReviews(dishId: string, tx: ChangeTx): Promise<boolean> {
  if ((await tx.find("review", { targetType: "dish", targetId: dishId })).length > 0) return true;
  for (const c of await tx.find("component", { dishId })) {
    if ((await tx.find("review", { targetType: "component", targetId: c.id })).length > 0)
      return true;
    for (const v of await tx.find("variant", { componentId: c.id })) {
      if ((await tx.find("review", { targetType: "variant", targetId: v.id })).length > 0)
        return true;
    }
  }
  return false;
}

export const dishRetire = defineOp({
  kind: "dish.retire",
  area: "recipes",
  schema: z.object({ dishId: id }).strict(),
  protected: async (p, tx) => dishHasReviews(p.dishId, tx),
  title: () => "Retire dish",
  apply: async (tx, { dishId }) => {
    const dish = await requireHouseholdDish("dish.retire", tx, dishId);
    if (dish.status === "retired")
      throw new ChangeOpError("dish.retire", "dish is already retired");
    await tx.update("dish", { id: dishId }, { status: "retired", updatedAt: tx.now() });
  },
});

const Nutrients = z.object({
  kcal: grams,
  proteinG: grams,
  carbsG: grams,
  fatG: grams,
  satFatG: grams,
  fibreG: grams,
  solubleFibreG: grams.nullable(),
  sugarG: grams.nullable(),
  sodiumMg: grams.nullable(),
});

/** A household-private ingredient (NUT-7): added manually or by the AI during generation. */
export const ingredientCreate = defineOp({
  kind: "ingredient.create",
  area: "recipes",
  schema: Nutrients.extend({
    id: id.optional(),
    slug: z.string().regex(/^[a-z0-9][a-z0-9_]{0,99}$/),
    name: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().trim().min(1)).default([]),
    category: z.enum(INGREDIENT_CATEGORIES),
    densityGPerMl: z.number().positive().nullable().default(null),
    unitWeightG: z.number().positive().nullable().default(null),
    unitLabel: z.string().max(30).nullable().default(null),
    ediblePortion: z.number().gt(0).max(1).default(1),
    dietaryFlags: z.array(z.enum(DIETARY_FLAGS)).default([]),
    nutritionSource: z.union([
      z.literal("manual"),
      z.literal("ai_estimate"),
      z.string().regex(/^usda_fdc:\d+$/),
    ]),
    nutritionConfidence: z.enum(NUTRITION_CONFIDENCES),
    availabilityAE: z.enum(LOCALE_AVAILABILITIES).default("available"),
  })
    .strict()
    .refine(
      (p) => p.nutritionSource !== "ai_estimate" || p.nutritionConfidence === "low",
      "AI-estimated nutrition has low confidence (NUT-7)",
    ),
  title: (p) => `Add ingredient "${p.name}"`,
  apply: async (tx, { id: ingredientId, availabilityAE, ...p }) => {
    if ((await tx.find("ingredient", { slug: p.slug })).length > 0)
      throw new ChangeOpError("ingredient.create", `ingredient slug "${p.slug}" exists`);
    await tx.insert("ingredient", {
      id: ingredientId ?? tx.newId(),
      ...p,
      localeAvailability: { AE: availabilityAE },
      createdByHouseholdId: tx.householdId,
      needsReview: false,
      verifiedAt: null,
      verifiedByUserId: null,
    });
  },
});

/** Clears the NUT-7 "verify" badge, optionally correcting the nutrition values. */
export const ingredientVerify = defineOp({
  kind: "ingredient.verify",
  area: "recipes",
  schema: z
    .object({
      ingredientId: id,
      nutrition: Nutrients.partial().strict().optional(),
      nutritionSource: z.string().min(1).optional(),
      nutritionConfidence: z.enum(NUTRITION_CONFIDENCES).default("medium"),
    })
    .strict(),
  title: () => "Verify ingredient nutrition",
  apply: async (tx, { ingredientId, nutrition, nutritionSource, nutritionConfidence }) => {
    const ingredient = await requireRow(
      "ingredient.verify",
      `ingredient ${ingredientId}`,
      tx.get("ingredient", { id: ingredientId }),
    );
    if (ingredient.createdByHouseholdId === null)
      throw new ChangeOpError("ingredient.verify", "global catalogue ingredients are read-only");
    await tx.update(
      "ingredient",
      { id: ingredientId },
      {
        ...definedFields(nutrition ?? {}),
        ...(nutritionSource === undefined ? {} : { nutritionSource }),
        nutritionConfidence,
        needsReview: false,
        verifiedAt: tx.now(),
        verifiedByUserId: tx.actorUserId,
      },
    );
  },
});
