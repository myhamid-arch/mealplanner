// PostgresKgSource: the KgSource port over the relational tables of 02 (SPEC-Q-1, R-35). Parameterised
// SQL only; `graph` does not import `db` (R-2). Every household-scoped read filters by household_id.
import type {
  CuisineRow,
  ExclusionRow,
  IngredientRow,
  MemberRow,
  PreferenceRow,
  PreparationMethodRow,
} from "@mealplanner/core/types";
import type {
  BundleIngredient,
  BundleVariant,
  CatalogueInput,
  DishBundle,
  LibraryDish,
  SubstituteSeed,
} from "../derive/inputs.js";
import { PRIMARY_CUISINE_WEIGHT, SECONDARY_CUISINE_WEIGHT, WATER_SLUG } from "../derive/refs.js";
import { rows, toNumber, type Queryable } from "../store/sql.js";
import type { KgSource } from "./source.js";
import { loadSubstitutesCsv } from "./substitutes-csv.js";

export interface PostgresKgSourceOptions {
  /** Path of `data/substitutes.csv`, or the rows themselves. */
  substitutes: string | readonly SubstituteSeed[];
}

type Row = Record<string, unknown>;
const num = (v: unknown) => toNumber(v);
const numOrNull = (v: unknown) => (v === null ? null : toNumber(v));
const str = (v: unknown) => v as string;
const strOrNull = (v: unknown) => (v === null ? null : (v as string));

const INGREDIENT_COLUMNS = `id, slug, name, aliases, category, kcal, protein_g, carbs_g, fat_g, sat_fat_g,
  fibre_g, soluble_fibre_g, sugar_g, sodium_mg, density_g_per_ml, unit_weight_g, unit_label,
  edible_portion, dietary_flags, nutrition_source, nutrition_confidence, locale_availability,
  created_by_household_id, needs_review, verified_at, verified_by_user_id`;

function toIngredient(r: Row): IngredientRow {
  return {
    id: str(r.id),
    slug: str(r.slug),
    name: str(r.name),
    aliases: r.aliases as string[],
    category: r.category as IngredientRow["category"],
    kcal: num(r.kcal),
    proteinG: num(r.protein_g),
    carbsG: num(r.carbs_g),
    fatG: num(r.fat_g),
    satFatG: num(r.sat_fat_g),
    fibreG: num(r.fibre_g),
    solubleFibreG: numOrNull(r.soluble_fibre_g),
    sugarG: numOrNull(r.sugar_g),
    sodiumMg: numOrNull(r.sodium_mg),
    densityGPerMl: numOrNull(r.density_g_per_ml),
    unitWeightG: numOrNull(r.unit_weight_g),
    unitLabel: strOrNull(r.unit_label),
    ediblePortion: num(r.edible_portion),
    dietaryFlags: r.dietary_flags as string[],
    nutritionSource: str(r.nutrition_source),
    nutritionConfidence: r.nutrition_confidence as IngredientRow["nutritionConfidence"],
    localeAvailability: r.locale_availability as IngredientRow["localeAvailability"],
    createdByHouseholdId: strOrNull(r.created_by_household_id),
    needsReview: r.needs_review as boolean,
    verifiedAt: r.verified_at as Date | null,
    verifiedByUserId: strOrNull(r.verified_by_user_id),
  };
}

function toMember(r: Row): MemberRow {
  return {
    id: str(r.id),
    householdId: str(r.household_id),
    displayName: str(r.display_name),
    color: str(r.color),
    birthYear: r.birth_year as number | null,
    sex: r.sex as MemberRow["sex"],
    isTargeted: r.is_targeted as boolean,
    appetite: r.appetite as MemberRow["appetite"],
    notes: strOrNull(r.notes),
    archivedAt: r.archived_at as Date | null,
  };
}

function toPreference(r: Row): PreferenceRow {
  return {
    id: str(r.id),
    householdId: str(r.household_id),
    memberId: strOrNull(r.member_id),
    entityType: r.entity_type as PreferenceRow["entityType"],
    entityKey: str(r.entity_key),
    score: num(r.score),
    evidenceWeight: num(r.evidence_weight),
    source: r.source as PreferenceRow["source"],
    locked: r.locked as boolean,
    hard: r.hard as PreferenceRow["hard"],
    updatedAt: r.updated_at as Date,
  };
}

/** `household_id` equals the parameter, null meaning global. */
const scoped = (column: string, param: string) => `${column} IS NOT DISTINCT FROM ${param}::uuid`;

export class PostgresKgSource implements KgSource {
  readonly #db: Queryable;
  readonly #substitutes: PostgresKgSourceOptions["substitutes"];

  constructor(db: Queryable, options: PostgresKgSourceOptions) {
    this.#db = db;
    this.#substitutes = options.substitutes;
  }

  async catalogue(): Promise<CatalogueInput> {
    const [ingredients, cuisines, methods, substitutes] = await Promise.all([
      rows<Row>(
        this.#db,
        `SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE created_by_household_id IS NULL ORDER BY slug`,
      ),
      rows<Row>(this.#db, `SELECT id, key, label, parent_key FROM cuisine ORDER BY key`),
      rows<Row>(
        this.#db,
        `SELECT id, key, label, description, appeal_tags FROM preparation_method ORDER BY key`,
      ),
      typeof this.#substitutes === "string"
        ? loadSubstitutesCsv(this.#substitutes)
        : Promise.resolve([...this.#substitutes]),
    ]);
    return {
      ingredients: ingredients.map(toIngredient),
      cuisines: cuisines.map((r): CuisineRow => ({
        id: str(r.id),
        key: str(r.key),
        label: str(r.label),
        parentKey: strOrNull(r.parent_key),
      })),
      methods: methods.map((r): PreparationMethodRow => ({
        id: str(r.id),
        key: str(r.key),
        label: str(r.label),
        description: str(r.description),
        appealTags: r.appeal_tags as string[],
      })),
      substitutes,
    };
  }

  async householdIngredients(householdId: string): Promise<IngredientRow[]> {
    return (
      await rows<Row>(
        this.#db,
        `SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE created_by_household_id = $1::uuid ORDER BY slug`,
        [householdId],
      )
    ).map(toIngredient);
  }

  async households(): Promise<string[]> {
    return (await rows<{ id: string }>(this.#db, `SELECT id FROM household ORDER BY id`)).map(
      (r) => r.id,
    );
  }

  async dishIds(householdId: string | null): Promise<string[]> {
    return (
      await rows<{ id: string }>(
        this.#db,
        `SELECT id FROM dish WHERE ${scoped("household_id", "$1")} ORDER BY id`,
        [householdId],
      )
    ).map((r) => r.id);
  }

  async dishes(householdId: string | null, dishIds: readonly string[]): Promise<DishBundle[]> {
    if (dishIds.length === 0) return [];
    const params = [householdId, dishIds];
    const [dishes, components, variants, items] = await Promise.all([
      rows<Row>(
        this.#db,
        `SELECT d.*, c.key AS cuisine_key, sc.key AS secondary_cuisine_key
         FROM dish d JOIN cuisine c ON c.id = d.cuisine_id
         LEFT JOIN cuisine sc ON sc.id = d.secondary_cuisine_id
         WHERE ${scoped("d.household_id", "$1")} AND d.id = ANY($2::uuid[])`,
        params,
      ),
      rows<Row>(
        this.#db,
        `SELECT c.* FROM component c
         WHERE ${scoped("c.household_id", "$1")} AND c.dish_id = ANY($2::uuid[])
         ORDER BY c.sort_order, c.id`,
        params,
      ),
      rows<Row>(
        this.#db,
        `SELECT v.*, m.key AS method_key, c.dish_id
         FROM variant v JOIN component c ON c.id = v.component_id
         JOIN preparation_method m ON m.id = v.method_id
         WHERE ${scoped("v.household_id", "$1")} AND c.dish_id = ANY($2::uuid[])
         ORDER BY v.id`,
        params,
      ),
      rows<Row>(
        this.#db,
        `SELECT vi.*, i.created_by_household_id AS ingredient_household_id, c.dish_id
         FROM variant_ingredient vi JOIN variant v ON v.id = vi.variant_id
         JOIN component c ON c.id = v.component_id
         JOIN ingredient i ON i.id = vi.ingredient_id
         WHERE ${scoped("vi.household_id", "$1")} AND c.dish_id = ANY($2::uuid[])
         ORDER BY vi.id`,
        params,
      ),
    ]);
    return dishes.map((d) => {
      const id = str(d.id);
      return {
        dish: {
          id,
          householdId: strOrNull(d.household_id),
          name: str(d.name),
          slug: str(d.slug),
          description: str(d.description),
          cuisineId: str(d.cuisine_id),
          secondaryCuisineId: strOrNull(d.secondary_cuisine_id),
          slotKeys: d.slot_keys as string[],
          flavourTags: d.flavour_tags as string[],
          isPackable: d.is_packable as boolean,
          servedColdOk: d.served_cold_ok as boolean,
          source: d.source as DishBundle["dish"]["source"],
          status: d.status as DishBundle["dish"]["status"],
          aiGenerationId: strOrNull(d.ai_generation_id),
          version: d.version as number,
          createdAt: d.created_at as Date,
          updatedAt: d.updated_at as Date,
        },
        cuisineKey: str(d.cuisine_key),
        secondaryCuisineKey: strOrNull(d.secondary_cuisine_key),
        components: components
          .filter((c) => c.dish_id === id)
          .map((c) => ({
            id: str(c.id),
            householdId: strOrNull(c.household_id),
            dishId: id,
            name: str(c.name),
            role: c.role as DishBundle["components"][number]["role"],
            portioning: c.portioning as DishBundle["components"][number]["portioning"],
            unitLabel: strOrNull(c.unit_label),
            minServingG: num(c.min_serving_g),
            maxServingG: num(c.max_serving_g),
            defaultServingG: num(c.default_serving_g),
            stepG: num(c.step_g),
            sortOrder: c.sort_order as number,
            required: c.required as boolean,
          })),
        variants: variants
          .filter((v) => v.dish_id === id)
          .map((v): BundleVariant => ({
            id: str(v.id),
            householdId: strOrNull(v.household_id),
            componentId: str(v.component_id),
            methodId: str(v.method_id),
            methodKey: str(v.method_key),
            label: str(v.label),
            isDefault: v.is_default as boolean,
            steps: v.steps as string[],
            cookTimeMin: v.cook_time_min as number | null,
            notes: strOrNull(v.notes),
            referenceBatchCookedG: num(v.reference_batch_cooked_g),
            needsReview: v.needs_review as boolean,
          })),
        ingredients: items
          .filter((i) => i.dish_id === id)
          .map((i): BundleIngredient => ({
            id: str(i.id),
            householdId: strOrNull(i.household_id),
            variantId: str(i.variant_id),
            ingredientId: str(i.ingredient_id),
            rawGPerBatch: num(i.raw_g_per_batch),
            roleNote: strOrNull(i.role_note),
            isAbsorbedOil: i.is_absorbed_oil as boolean,
            cookingLiquid: i.cooking_liquid as BundleIngredient["cookingLiquid"],
            yieldOverride: numOrNull(i.yield_override),
            ingredientHouseholdId: strOrNull(i.ingredient_household_id),
          })),
      };
    });
  }

  async members(householdId: string, memberIds?: readonly string[]): Promise<MemberRow[]> {
    return (
      await rows<Row>(
        this.#db,
        `SELECT * FROM member WHERE household_id = $1::uuid
           AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY id`,
        [householdId, memberIds ?? null],
      )
    ).map(toMember);
  }

  async preferences(householdId: string, memberIds?: readonly string[]): Promise<PreferenceRow[]> {
    return (
      await rows<Row>(
        this.#db,
        `SELECT * FROM preference WHERE household_id = $1::uuid AND member_id IS NOT NULL
           AND ($2::uuid[] IS NULL OR member_id = ANY($2::uuid[])) ORDER BY id`,
        [householdId, memberIds ?? null],
      )
    ).map(toPreference);
  }

  async library(householdId: string | null): Promise<LibraryDish[]> {
    const found = await rows<Row>(
      this.#db,
      `SELECT d.id AS dish_id, d.household_id, c.key AS cuisine_key, sc.key AS secondary_cuisine_key,
              i.id AS ingredient_id, i.created_by_household_id AS ingredient_household_id
       FROM dish d
       JOIN cuisine c ON c.id = d.cuisine_id
       LEFT JOIN cuisine sc ON sc.id = d.secondary_cuisine_id
       JOIN component co ON co.dish_id = d.id
       JOIN variant v ON v.component_id = co.id
       JOIN variant_ingredient vi ON vi.variant_id = v.id
       JOIN ingredient i ON i.id = vi.ingredient_id
       WHERE d.status = 'active' AND i.slug <> $2
         AND (d.household_id IS NULL OR d.household_id = $1::uuid)
       ORDER BY d.id, i.id`,
      [householdId, WATER_SLUG],
    );
    const dishes = new Map<string, LibraryDish>();
    for (const r of found) {
      const id = str(r.dish_id);
      let dish = dishes.get(id);
      if (dish === undefined) {
        const primary = str(r.cuisine_key);
        const secondary = strOrNull(r.secondary_cuisine_key);
        dish = {
          dishId: id,
          householdId: strOrNull(r.household_id),
          cuisines: [
            { key: primary, weight: PRIMARY_CUISINE_WEIGHT },
            ...(secondary !== null && secondary !== primary
              ? [{ key: secondary, weight: SECONDARY_CUISINE_WEIGHT }]
              : []),
          ],
          ingredients: [],
        };
        dishes.set(id, dish);
      }
      const ingredientId = str(r.ingredient_id);
      if (!dish.ingredients.some((i) => i.id === ingredientId))
        dish.ingredients.push({
          id: ingredientId,
          householdId: strOrNull(r.ingredient_household_id),
        });
    }
    return [...dishes.values()];
  }

  async exclusions(householdId: string): Promise<ExclusionRow[]> {
    return (
      await rows<Row>(
        this.#db,
        `SELECT id, household_id, member_id, kind, key, reason, hard FROM exclusion
         WHERE household_id = $1::uuid ORDER BY id`,
        [householdId],
      )
    ).map((r) => ({
      id: str(r.id),
      householdId: str(r.household_id),
      memberId: strOrNull(r.member_id),
      kind: r.kind as ExclusionRow["kind"],
      key: str(r.key),
      reason: r.reason as ExclusionRow["reason"],
      hard: r.hard as boolean,
    }));
  }
}
