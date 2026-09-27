// Before → after lines from the registry's `describe` (AGT-6/AGT-7), in words. Pure.
// - Bookkeeping fields (ids, household, timestamps) are left out.
// - Ids that the screen knows are shown as names (members, dishes, ingredients).
// - Stored values are shown as labels: enums in words, catalogue slugs by their catalogue name,
//   booleans as Yes / No. Numbers are flagged so only they use the numeric font.
// - A new row's fields that only repeat a default (not locked, rule none, not protected) or are
//   empty are left out; a changed default is shown.
// - R-34 / R-36 (SPEC-Q-13): every exclusion filters, whatever `hard`; `hard` only protects it from
//   automatic change. It is never worded as "may be served".
import type { z } from "zod";
import type { DescriptionDto } from "@mealplanner/api-contract/contract";

export type Description = z.output<typeof DescriptionDto>;

export interface DiffLine {
  /** "Score", "Minimum gap (days)". */
  label: string;
  before: string | null;
  after: string | null;
  /** The row the field belongs to ("Preference", "Exclusion"). */
  entity: string;
  /** Numbers (scores, grams, calories): shown in the numeric font. */
  numeric: boolean;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const HIDDEN = new Set([
  "id",
  "householdId",
  "createdAt",
  "updatedAt",
  "createdByUserId",
  "version",
  "evidenceWeight",
  "source",
]);

const FIELD_LABELS: Readonly<Record<string, string>> = {
  score: "Score",
  locked: "Locked",
  source: "Source",
  hard: "Protected from automatic change",
  reason: "Reason",
  key: "What",
  kind: "Kind",
  minGapDays: "Minimum gap (days)",
  maxPerWeek: "At most per week",
  entityType: "About",
  entityKey: "Which",
  kcal: "Calories",
  proteinG: "Protein (g)",
  carbsG: "Carbs (g)",
  fatG: "Fat (g)",
  satFatMaxG: "Saturated fat cap (g)",
  bias: "Portion factor",
  componentRole: "Part",
  displayName: "Name",
  memberId: "Who",
  dishId: "Dish",
  status: "Status",
  name: "Name",
  share: "Share",
};

/** Readable labels of stored enum values, per field. */
const VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  kind: {
    ingredient: "Ingredient",
    category: "Category",
    dietary_flag: "Dietary flag",
    default: "Every day",
    training: "Training days",
  },
  reason: {
    allergy: "Allergy",
    religious: "Religious",
    dislike: "Dislike",
    medical: "Medical",
    other: "Other",
  },
  hard: { none: "None", never: "Never serve", always_ok: "Always allowed" },
  entityType: {
    dish: "Dish",
    ingredient: "Ingredient",
    cuisine: "Cuisine",
    method: "Cooking method",
    flavour_tag: "Flavour",
    component_role: "Part of the dish",
  },
  componentRole: {
    protein: "Protein",
    carb: "Carbs",
    vegetable: "Vegetables",
    sauce: "Sauce",
    fat: "Fat",
    garnish: "Garnish",
    side: "Side",
    drink: "Drink",
    adjuster: "Adjuster",
  },
};

/** Defaults that say nothing on a new row (shown only when the op sets something else). */
const DEFAULTS: Readonly<Record<string, readonly unknown[]>> = {
  locked: [false],
  hard: ["none", false],
};

const ENTITY_LABELS: Readonly<Record<string, string>> = {
  preference: "Taste",
  exclusion: "Never serve",
  frequency_rule: "How often",
  portion_bias: "Portions",
  target_profile: "Targets",
  tolerance: "Tolerance",
  member: "Member",
  dish: "Dish",
  plan_meal: "Meal",
  plate: "Plate",
  planning_weights: "Planning balance",
  slot_type: "Meal slot",
};

/** "minGapDays" → "Min gap days" for fields without a label. */
function words(s: string): string {
  const w = s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
  return w === "" ? s : `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
}

/** Replaces ids the screen can name, and makes slugs readable. */
export function humanize(text: string, names: ReadonlyMap<string, string>): string {
  return text.replace(UUID, (id) => names.get(id.toLowerCase()) ?? names.get(id) ?? "…");
}

/** A catalogue slug by its catalogue name ("sesame_seeds" → "Sesame seeds"), else in words. */
export function slugName(slug: string, names: ReadonlyMap<string, string>): string {
  return (
    names.get(`ingredient:${slug}`) ??
    names.get(`dish:${slug}`) ??
    humanize(words(slug.replace(/_/g, " ")), names)
  );
}

const SLUG = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function value(field: string, v: unknown, names: ReadonlyMap<string, string>): string | null {
  if (v === undefined) return null;
  if (v === null) return field === "memberId" ? "Everyone" : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") {
    if (UUID_ONLY.test(v)) return humanize(v, names);
    const label = VALUE_LABELS[field]?.[v];
    if (label !== undefined) return label;
    if ((field === "key" || field === "entityKey") && SLUG.test(v)) return slugName(v, names);
    if (SLUG.test(v) && !/^\d+$/.test(v)) return words(v);
    return humanize(v, names);
  }
  if (Array.isArray(v)) return v.map((x) => value(field, x, names) ?? "").join(", ");
  return humanize(JSON.stringify(v), names);
}

/** A new row's field that only repeats a default, or is empty ("Who: Everyone" is not). */
function isDefault(field: string, before: unknown, after: unknown): boolean {
  if (before !== undefined && before !== null) return false;
  if (after === null) return field !== "memberId";
  return DEFAULTS[field]?.includes(after) ?? false;
}

export function diffLines(d: Description, names: ReadonlyMap<string, string>): DiffLine[] {
  return d.changes
    .filter((c) => !HIDDEN.has(c.field) && !/(At|UserId)$/.test(c.field))
    .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after))
    .filter((c) => !isDefault(c.field, c.before, c.after))
    .map((c) => ({
      entity: ENTITY_LABELS[c.entity] ?? words(c.entity),
      label:
        c.field === "hard" && c.entity !== "exclusion"
          ? "Rule"
          : (FIELD_LABELS[c.field] ?? words(c.field)),
      before: value(c.field, c.before, names),
      after: value(c.field, c.after, names),
      numeric: typeof (c.after ?? c.before) === "number",
    }));
}

/**
 * The op's title in words. `exclusion.add` reads "Never serve <what> to <who>" for every `hard`
 * (R-34); other titles have their ids named.
 */
export function describeTitle(d: Description, names: ReadonlyMap<string, string>): string {
  if (d.kind === "exclusion.add") {
    const row = d.changes.find((c) => c.entity === "exclusion" && c.field === "key");
    const who = d.changes.find((c) => c.entity === "exclusion" && c.field === "memberId");
    const what = typeof row?.after === "string" ? slugName(row.after, names) : null;
    const whom = typeof who?.after === "string" ? (names.get(who.after) ?? "one person") : "anyone";
    if (what !== null) return `Never serve ${lower(what)} to ${whom}`;
  }
  // Quoted slugs in registry titles ("Set cuisine preference \"italian\" to 0.50") by name.
  return humanize(d.title, names).replace(/"([a-z0-9]+(?:[_-][a-z0-9]+)*)"/g, (_, slug: string) =>
    slugName(slug, names),
  );
}

/** "Sesame seeds" → "sesame seeds" inside a sentence; names with capitals inside stay as they are. */
function lower(name: string): string {
  return /^[A-Z][a-z0-9 ,()'-]*$/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}
