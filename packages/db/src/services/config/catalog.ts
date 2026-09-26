// Loads global catalogue rows (cuisines, methods, method yields, ingredients) idempotently. Global
// catalogue data is not household configuration, so it is not a change set; leaf 1.1.3 ships the
// real data, fixtures use a small test catalogue (SPEC-Q-8).
import { FixtureCatalogSchema, type FixtureCatalog } from "@mealplanner/core/types";
import type { Executor } from "../../repos/index.js";
import { cuisine, ingredient, methodYield, preparationMethod } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";

export interface CatalogIds {
  cuisines: Map<string, string>;
  methods: Map<string, string>;
  ingredients: Map<string, string>;
}

export async function seedCatalog(db: Executor, input: FixtureCatalog): Promise<CatalogIds> {
  const catalog = FixtureCatalogSchema.parse(input);
  return db.transaction(async (trx) => {
    if (catalog.cuisines.length > 0)
      await trx
        .insert(cuisine)
        .values(
          catalog.cuisines.map((c) => ({
            id: newId(),
            key: c.key,
            label: c.label,
            flagEmoji: c.flagEmoji ?? null,
            parentKey: null,
          })),
        )
        .onConflictDoNothing({ target: cuisine.key });
    if (catalog.methods.length > 0)
      await trx
        .insert(preparationMethod)
        .values(catalog.methods.map((m) => ({ id: newId(), ...m })))
        .onConflictDoNothing({ target: preparationMethod.key });
    const ids = await readCatalogIds(trx);
    if (catalog.methodYields.length > 0)
      await trx
        .insert(methodYield)
        .values(
          catalog.methodYields.map((y) => {
            const methodId = ids.methods.get(y.method);
            if (methodId === undefined)
              throw new Error(`method yield for unknown method ${y.method}`);
            return {
              methodId,
              ingredientCategory: y.category,
              yieldFactor: y.yieldFactor,
              fatRetention: y.fatRetention,
              oilAbsorptionGPer100gRaw: y.oilAbsorptionGPer100gRaw,
            };
          }),
        )
        .onConflictDoNothing();
    if (catalog.ingredients.length > 0)
      await trx
        .insert(ingredient)
        .values(
          catalog.ingredients.map(({ availabilityAE, unitWeightG, unitLabel, ...i }) => ({
            id: newId(),
            ...i,
            aliases: [],
            densityGPerMl: null,
            unitWeightG: unitWeightG ?? null,
            unitLabel: unitLabel ?? null,
            ediblePortion: 1,
            localeAvailability: { AE: availabilityAE },
            createdByHouseholdId: null,
          })),
        )
        .onConflictDoNothing({ target: ingredient.slug });
    return readCatalogIds(trx);
  });
}

export async function readCatalogIds(db: Executor): Promise<CatalogIds> {
  // Sequential: `db` may be a transaction, which runs on one connection.
  const cuisines = await db.select({ id: cuisine.id, key: cuisine.key }).from(cuisine);
  const methods = await db
    .select({ id: preparationMethod.id, key: preparationMethod.key })
    .from(preparationMethod);
  const ingredients = await db
    .select({ id: ingredient.id, key: ingredient.slug, owner: ingredient.createdByHouseholdId })
    .from(ingredient);
  return {
    cuisines: new Map(cuisines.map((c) => [c.key, c.id])),
    methods: new Map(methods.map((m) => [m.key, m.id])),
    ingredients: new Map(ingredients.filter((i) => i.owner === null).map((i) => [i.key, i.id])),
  };
}
