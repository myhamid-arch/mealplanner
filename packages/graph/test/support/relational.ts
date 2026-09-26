// Test-only loader for the relational tables the graph derives from: the catalogue (leaf 1.1.3 data),
// the seed library (leaf 1.2.4 data), and households with members, preferences and exclusions. The
// production loader is 1.4.1's (R-17); tests write rows directly with SQL.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../../src/store/sql.js";
import { newId } from "../../src/store/uuid.js";

export const DATA_DIR = fileURLToPath(new URL("../../../../data", import.meta.url));
export const SUBSTITUTES_CSV = `${DATA_DIR}/substitutes.csv`;

interface IngredientJson {
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sat_fat_g: number;
  fibre_g: number;
  soluble_fibre_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  density_g_per_ml: number | null;
  unit_weight_g: number | null;
  unit_label: string | null;
  edible_portion: number;
  dietary_flags: string[];
  nutrition_source: string;
  nutrition_confidence: string;
  locale_availability: Record<string, string>;
}

export interface DishJson {
  slug: string;
  name: string;
  description: string;
  cuisine: string;
  secondary_cuisine: string | null;
  slot_keys: string[];
  flavour_tags: string[];
  is_packable: boolean;
  served_cold_ok: boolean;
  source: string;
  status: string;
  version: number;
  components: Array<{
    key: string;
    name: string;
    role: string;
    portioning: string;
    unit_label: string | null;
    min_serving_g: number;
    max_serving_g: number;
    default_serving_g: number;
    step_g: number;
    sort_order: number;
    required: boolean;
    variants: Array<{
      key: string;
      method: string;
      label: string;
      is_default: boolean;
      reference_batch_cooked_g: number;
      cook_time_min: number | null;
      notes: string | null;
      steps: string[];
      ingredients: Array<{
        ingredient_slug: string;
        raw_g_per_batch: number;
        role_note: string | null;
        is_absorbed_oil: boolean;
        cooking_liquid: string | null;
        yield_override: number | null;
      }>;
    }>;
  }>;
}

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function catalogueIngredients(): IngredientJson[] {
  return (json(`${DATA_DIR}/ingredients.v1.json`) as { ingredients: IngredientJson[] }).ingredients;
}

export function seedDishes(): DishJson[] {
  return readdirSync(`${DATA_DIR}/seed-dishes`)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => json(`${DATA_DIR}/seed-dishes/${f}`) as DishJson);
}

export function seedDish(slug: string): DishJson {
  return json(`${DATA_DIR}/seed-dishes/${slug}.json`) as DishJson;
}

export interface Catalogue {
  ingredientId: Map<string, string>;
  cuisineId: Map<string, string>;
  methodId: Map<string, string>;
}

function must<T>(map: Map<string, T>, key: string, what: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`unknown ${what} ${key}`);
  return value;
}

export async function loadCatalogue(db: Queryable): Promise<Catalogue> {
  const ingredients = catalogueIngredients();
  const cuisines = json(`${DATA_DIR}/cuisines.json`) as Array<{
    key: string;
    label: string;
    parent_key: string | null;
  }>;
  const methods = (
    json(`${DATA_DIR}/method-yields.v1.json`) as {
      methods: Array<{ key: string; label: string; description: string; appeal_tags: string[] }>;
    }
  ).methods;
  const catalogue: Catalogue = {
    ingredientId: new Map(),
    cuisineId: new Map(),
    methodId: new Map(),
  };
  for (const i of ingredients)
    catalogue.ingredientId.set(i.slug, await insertIngredient(db, i, null));
  for (const c of cuisines) {
    const id = newId();
    await db.query(`INSERT INTO cuisine (id, key, label, parent_key) VALUES ($1, $2, $3, $4)`, [
      id,
      c.key,
      c.label,
      c.parent_key,
    ]);
    catalogue.cuisineId.set(c.key, id);
  }
  for (const m of methods) {
    const id = newId();
    await db.query(
      `INSERT INTO preparation_method (id, key, label, description, appeal_tags) VALUES ($1, $2, $3, $4, $5)`,
      [id, m.key, m.label, m.description, m.appeal_tags],
    );
    catalogue.methodId.set(m.key, id);
  }
  return catalogue;
}

export async function insertIngredient(
  db: Queryable,
  i: IngredientJson,
  householdId: string | null,
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO ingredient (id, slug, name, aliases, category, kcal, protein_g, carbs_g, fat_g,
       sat_fat_g, fibre_g, soluble_fibre_g, sugar_g, sodium_mg, density_g_per_ml, unit_weight_g,
       unit_label, edible_portion, dietary_flags, nutrition_source, nutrition_confidence,
       locale_availability, created_by_household_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
       $20, $21, $22, $23)`,
    [
      id,
      i.slug,
      i.name,
      i.aliases,
      i.category,
      i.kcal,
      i.protein_g,
      i.carbs_g,
      i.fat_g,
      i.sat_fat_g,
      i.fibre_g,
      i.soluble_fibre_g,
      i.sugar_g,
      i.sodium_mg,
      i.density_g_per_ml,
      i.unit_weight_g,
      i.unit_label,
      i.edible_portion,
      i.dietary_flags,
      i.nutrition_source,
      i.nutrition_confidence,
      JSON.stringify(i.locale_availability),
      householdId,
    ],
  );
  return id;
}

/** A household-private ingredient (created_by_household_id), copied from a catalogue slug's values. */
export async function insertPrivateIngredient(
  db: Queryable,
  catalogue: Catalogue,
  householdId: string,
  fromSlug: string,
  slug: string,
  name: string,
): Promise<string> {
  const base = catalogueIngredients().find((i) => i.slug === fromSlug);
  if (base === undefined) throw new Error(`unknown slug ${fromSlug}`);
  const id = await insertIngredient(db, { ...base, slug, name, aliases: [] }, householdId);
  catalogue.ingredientId.set(slug, id);
  return id;
}

export async function insertHousehold(db: Queryable, name: string): Promise<string> {
  const id = newId();
  await db.query(`INSERT INTO household (id, name, created_at) VALUES ($1, $2, now())`, [id, name]);
  return id;
}

export interface InsertedDish {
  dishId: string;
  /** component key → id */
  components: Map<string, string>;
  /** "componentKey/variantKey" → id */
  variants: Map<string, string>;
}

export async function insertDish(
  db: Queryable,
  catalogue: Catalogue,
  dish: DishJson,
  householdId: string | null,
  overrides: { status?: string; source?: string } = {},
): Promise<InsertedDish> {
  const dishId = newId();
  await db.query(
    `INSERT INTO dish (id, household_id, name, slug, description, cuisine_id, secondary_cuisine_id,
       slot_keys, flavour_tags, is_packable, served_cold_ok, source, status, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now())`,
    [
      dishId,
      householdId,
      dish.name,
      dish.slug,
      dish.description,
      must(catalogue.cuisineId, dish.cuisine, "cuisine"),
      dish.secondary_cuisine === null
        ? null
        : must(catalogue.cuisineId, dish.secondary_cuisine, "cuisine"),
      dish.slot_keys,
      dish.flavour_tags,
      dish.is_packable,
      dish.served_cold_ok,
      overrides.source ?? (householdId === null ? dish.source : "admin"),
      overrides.status ?? dish.status,
      dish.version,
    ],
  );
  const inserted: InsertedDish = { dishId, components: new Map(), variants: new Map() };
  for (const c of dish.components) {
    const componentId = newId();
    inserted.components.set(c.key, componentId);
    await db.query(
      `INSERT INTO component (id, household_id, dish_id, name, role, portioning, unit_label,
         min_serving_g, max_serving_g, default_serving_g, step_g, sort_order, required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        componentId,
        householdId,
        dishId,
        c.name,
        c.role,
        c.portioning,
        c.unit_label,
        c.min_serving_g,
        c.max_serving_g,
        c.default_serving_g,
        c.step_g,
        c.sort_order,
        c.required,
      ],
    );
    for (const v of c.variants) {
      const variantId = newId();
      inserted.variants.set(`${c.key}/${v.key}`, variantId);
      await db.query(
        `INSERT INTO variant (id, household_id, component_id, method_id, label, is_default, steps,
           cook_time_min, notes, reference_batch_cooked_g)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          variantId,
          householdId,
          componentId,
          must(catalogue.methodId, v.method, "method"),
          v.label,
          v.is_default,
          JSON.stringify(v.steps),
          v.cook_time_min,
          v.notes,
          v.reference_batch_cooked_g,
        ],
      );
      for (const i of v.ingredients)
        await db.query(
          `INSERT INTO variant_ingredient (id, household_id, variant_id, ingredient_id, raw_g_per_batch,
             role_note, is_absorbed_oil, cooking_liquid, yield_override)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            newId(),
            householdId,
            variantId,
            must(catalogue.ingredientId, i.ingredient_slug, "ingredient"),
            i.raw_g_per_batch,
            i.role_note,
            i.is_absorbed_oil,
            i.cooking_liquid,
            i.yield_override,
          ],
        );
    }
  }
  return inserted;
}

/** Deletes a dish and every row under it. */
export async function deleteDish(db: Queryable, dishId: string): Promise<void> {
  await db.query(
    `DELETE FROM variant_ingredient WHERE variant_id IN
       (SELECT v.id FROM variant v JOIN component c ON c.id = v.component_id WHERE c.dish_id = $1)`,
    [dishId],
  );
  await db.query(
    `DELETE FROM variant WHERE component_id IN (SELECT id FROM component WHERE dish_id = $1)`,
    [dishId],
  );
  await db.query(`DELETE FROM component WHERE dish_id = $1`, [dishId]);
  await db.query(`DELETE FROM dish WHERE id = $1`, [dishId]);
}

/** Deletes one component of a dish and its variants. */
export async function deleteComponent(db: Queryable, componentId: string): Promise<void> {
  await db.query(
    `DELETE FROM variant_ingredient WHERE variant_id IN (SELECT id FROM variant WHERE component_id = $1)`,
    [componentId],
  );
  await db.query(`DELETE FROM variant WHERE component_id = $1`, [componentId]);
  await db.query(`DELETE FROM component WHERE id = $1`, [componentId]);
}

export async function insertMember(
  db: Queryable,
  householdId: string,
  displayName: string,
  isTargeted: boolean,
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO member (id, household_id, display_name, color, is_targeted) VALUES ($1, $2, $3, 'sage', $4)`,
    [id, householdId, displayName, isTargeted],
  );
  return id;
}

export interface PreferenceSpec {
  memberId: string | null;
  entityType: string;
  entityKey: string;
  score: number;
  source?: string;
  locked?: boolean;
  hard?: string;
}

export async function insertPreference(
  db: Queryable,
  householdId: string,
  p: PreferenceSpec,
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO preference (id, household_id, member_id, entity_type, entity_key, score,
       evidence_weight, source, locked, hard, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, now())`,
    [
      id,
      householdId,
      p.memberId,
      p.entityType,
      p.entityKey,
      p.score,
      p.source ?? "explicit",
      p.locked ?? false,
      p.hard ?? "none",
    ],
  );
  return id;
}

export async function insertExclusion(
  db: Queryable,
  householdId: string,
  e: { memberId: string | null; kind: string; key: string; reason: string; hard: boolean },
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO exclusion (id, household_id, member_id, kind, key, reason, hard)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, householdId, e.memberId, e.kind, e.key, e.reason, e.hard],
  );
  return id;
}

/** A copy of a seed dish with a new slug and name, and one ingredient swapped. */
export function variantOf(
  dish: DishJson,
  slug: string,
  name: string,
  swap?: [string, string],
): DishJson {
  const copy = structuredClone(dish);
  copy.slug = slug;
  copy.name = name;
  if (swap !== undefined)
    for (const c of copy.components)
      for (const v of c.variants)
        for (const i of v.ingredients)
          if (i.ingredient_slug === swap[0]) i.ingredient_slug = swap[1];
  return copy;
}
