// REC-4 output schema, as written in 05-recipe-generation §4.
import { z } from "zod";

export const VariantSchema = z.object({
  method: z.string(), // preparation_method.key
  label: z.string(),
  isDefault: z.boolean(),
  ingredients: z
    .array(
      z.object({
        slug: z.string(),
        rawGramsPerBatch: z.number().positive(),
        isAbsorbedFat: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .min(1),
  steps: z.array(z.string()).min(1),
  cookTimeMin: z.number().int().positive(),
});

export const ComponentSchema = z.object({
  name: z.string(),
  role: z.enum(["protein", "carb", "vegetable", "sauce", "fat", "garnish", "side", "drink"]),
  portioning: z.enum(["continuous", "unit", "fixed"]),
  unitLabel: z.string().optional(),
  minServingG: z.number(),
  maxServingG: z.number(),
  defaultServingG: z.number(),
  required: z.boolean(),
  variants: z.array(VariantSchema).min(1).max(3),
});

export const DishSchema = z.object({
  name: z.string(),
  description: z.string(),
  cuisine: z.string(),
  secondaryCuisine: z.string().optional(),
  slotKeys: z.array(z.string()).min(1),
  flavourTags: z.array(z.string()),
  isPackable: z.boolean(),
  servedColdOk: z.boolean(),
  components: z.array(ComponentSchema).min(1).max(6),
  assemblySteps: z.array(z.string()),
});

export const NewIngredientSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  per100g: z.object({
    kcal: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    satFat: z.number(),
    fibre: z.number(),
    solubleFibre: z.number().nullable(),
  }),
  sourceNote: z.string(),
});

export const DishBatchSchema = z.object({
  dishes: z.array(DishSchema),
  newIngredients: z.array(NewIngredientSchema),
});

export type GeneratedVariant = z.output<typeof VariantSchema>;
export type GeneratedComponent = z.output<typeof ComponentSchema>;
export type GeneratedDish = z.output<typeof DishSchema>;
export type NewIngredient = z.output<typeof NewIngredientSchema>;
export type DishBatch = z.output<typeof DishBatchSchema>;
