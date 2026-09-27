// Before → after lines from the registry's `describe` (AGT-6/AGT-7), in words. Pure.
// - Bookkeeping fields (ids, household, timestamps) are left out.
// - Ids that the screen knows are shown as names (members, dishes, ingredients).
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
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const HIDDEN = new Set([
  "id",
  "householdId",
  "createdAt",
  "updatedAt",
  "createdByUserId",
  "version",
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

function value(field: string, v: unknown, names: ReadonlyMap<string, string>): string | null {
  if (v === undefined) return null;
  if (v === null) return field === "memberId" ? "Everyone" : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") {
    if (field === "key" || field === "entityKey") return humanize(v.replace(/_/g, " "), names);
    return humanize(v, names);
  }
  if (Array.isArray(v)) return v.map((x) => value(field, x, names) ?? "").join(", ");
  return humanize(JSON.stringify(v), names);
}

export function diffLines(d: Description, names: ReadonlyMap<string, string>): DiffLine[] {
  return d.changes
    .filter((c) => !HIDDEN.has(c.field) && !/(At|UserId)$/.test(c.field))
    .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after))
    .map((c) => ({
      entity: ENTITY_LABELS[c.entity] ?? words(c.entity),
      label: FIELD_LABELS[c.field] ?? words(c.field),
      before: value(c.field, c.before, names),
      after: value(c.field, c.after, names),
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
    const what = typeof row?.after === "string" ? row.after.replace(/_/g, " ") : null;
    const whom = typeof who?.after === "string" ? (names.get(who.after) ?? "one person") : "anyone";
    if (what !== null) return `Never serve ${humanize(what, names)} to ${whom}`;
  }
  return humanize(d.title, names);
}
