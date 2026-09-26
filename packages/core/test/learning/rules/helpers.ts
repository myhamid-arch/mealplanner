// Fixtures for the insights-engine rule tests (leaf 1.3.3 G1, G2): F1's in-memory configuration
// with uuid ids (change-op payloads require uuids), and small builders for dishes, meals and
// reviews. The run time is Saturday 2026-09-26 12:00 UTC.
import { configFromFixture } from "../../planner/targets/config.js";
import { F1 } from "../../fixtures/index.js";
import type { HouseholdConfig, ReviewTargetType } from "../../../src/types/index.js";
import type {
  InsightDish,
  InsightIngredient,
  InsightInput,
  InsightMeal,
  InsightPlate,
  InsightReview,
} from "../../../src/learning/rules/index.js";

export const NOW = new Date("2026-09-26T12:00:00Z");
export const TODAY = "2026-09-26";

let counter = 0;
/** A fresh, valid v4-shaped uuid. */
export function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

/** Stable uuids for F1's members and slots. */
export const M = {
  a: "10000000-0000-4000-8000-00000000000a",
  b: "10000000-0000-4000-8000-00000000000b",
  c1: "10000000-0000-4000-8000-0000000000c1",
  c2: "10000000-0000-4000-8000-0000000000c2",
  c3: "10000000-0000-4000-8000-0000000000c3",
} as const;
const MEMBER_KEYS: Record<string, string> = {
  adult_a: M.a,
  adult_b: M.b,
  c1: M.c1,
  c2: M.c2,
  c3: M.c3,
};

export const S = {
  breakfast: "20000000-0000-4000-8000-000000000001",
  lunch: "20000000-0000-4000-8000-000000000002",
  dinner: "20000000-0000-4000-8000-000000000003",
  snack: "20000000-0000-4000-8000-000000000004",
  packed_school_lunch: "20000000-0000-4000-8000-000000000005",
  packed_work_lunch: "20000000-0000-4000-8000-000000000006",
  pre_workout: "20000000-0000-4000-8000-000000000007",
  post_workout: "20000000-0000-4000-8000-000000000008",
} as const;
export const HOUSEHOLD = "30000000-0000-4000-8000-000000000001";

function remap<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => remap(v, ids)) as T;
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remap(v, ids)]),
  ) as T;
}

/** F1's configuration with uuid member, slot and household ids. */
export function config(): HouseholdConfig {
  const ids = new Map<string, string>([["household-test", HOUSEHOLD]]);
  for (const [key, id] of Object.entries(MEMBER_KEYS)) ids.set(key, id);
  for (const [key, id] of Object.entries(S)) ids.set(`slot:${key}`, id);
  return remap(configFromFixture(F1), ids);
}

export interface VariantSpec {
  label: string;
  isDefault?: boolean;
  ingredients?: string[];
  core?: string[];
}

export interface ComponentSpec {
  name: string;
  role?: InsightDish["components"][number]["role"];
  variants: VariantSpec[];
}

export function dish(name: string, components: ComponentSpec[]): InsightDish {
  return {
    id: uuid(),
    name,
    components: components.map((c) => ({
      id: uuid(),
      name: c.name,
      role: c.role ?? "protein",
      variants: c.variants.map((v, i) => ({
        id: uuid(),
        label: v.label,
        isDefault: v.isDefault ?? i === 0,
        ingredientIds: v.ingredients ?? v.core ?? [],
        coreIngredientIds: v.core ?? v.ingredients ?? [],
      })),
    })),
  };
}

export function ingredient(
  slug: string,
  options: Partial<Omit<InsightIngredient, "slug">> = {},
): InsightIngredient {
  return {
    id: options.id ?? uuid(),
    slug,
    name: options.name ?? slug.replaceAll("_", " "),
    nutritionSource: options.nutritionSource ?? "usda_fdc:1",
    householdPrivate: options.householdPrivate ?? false,
    verified: options.verified ?? false,
  };
}

export function plate(memberId: string, options: Partial<Omit<InsightPlate, "memberId">> = {}) {
  return {
    id: options.id ?? uuid(),
    memberId,
    fitStatus: options.fitStatus ?? "in_tolerance",
    kcalDeviation: options.kcalDeviation ?? 0,
    items: options.items ?? [],
  } satisfies InsightPlate;
}

export function meal(
  date: string,
  dishId: string,
  options: Partial<Omit<InsightMeal, "date" | "dishId">> = {},
): InsightMeal {
  return {
    id: options.id ?? uuid(),
    date,
    slotTypeId: options.slotTypeId ?? S.dinner,
    dishId,
    status: options.status ?? "planned",
    plates: options.plates ?? [],
  };
}

export function review(
  memberId: string,
  targetType: ReviewTargetType,
  targetId: string,
  options: {
    rating?: number | null;
    tags?: string[];
    comment?: string | null;
    daysAgo?: number;
    planMealId?: string | null;
    id?: string;
  } = {},
): InsightReview {
  return {
    id: options.id ?? uuid(),
    memberId,
    targetType,
    targetId,
    planMealId: options.planMealId ?? null,
    rating: options.rating === undefined ? null : options.rating,
    tags: options.tags ?? [],
    comment: options.comment ?? null,
    createdAt: new Date(NOW.getTime() - (options.daysAgo ?? 1) * 24 * 60 * 60 * 1000),
  };
}

export function input(parts: Partial<InsightInput> = {}): InsightInput {
  return {
    now: NOW,
    today: TODAY,
    config: parts.config ?? config(),
    reviews: parts.reviews ?? [],
    dishes: parts.dishes ?? [],
    ingredients: parts.ingredients ?? [],
    meals: parts.meals ?? [],
  };
}

/** `YYYY-MM-DD`, `days` before TODAY. */
export function daysBefore(days: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
}
