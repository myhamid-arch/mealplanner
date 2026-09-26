// Background work a change set implies (ARC-7), derived from the entities it touched:
// - recipe rows (dish, component, variant, ingredient lines, ingredients): `nutrition.recompute`,
//   `kg.sync` for the dishes, and `plates.resolve` of future meals (REC-7);
// - members and preferences: `kg.sync` (KG-3);
// - targets, tolerances, slots, schedules, splits, per-slot targets, portion biases, exclusions:
//   `plates.resolve` of future meals (PLN-13);
// - queued `job` rows (the `recipe.*` ops, R-40): sent to the queue by the caller.
// Plan writes and the adjuster rows a plan save materialises trigger nothing (no follow-up loops).
// The API and the worker both call this after applying a change set.
import type { Json } from "@mealplanner/core/types";
import { touchedEntities } from "../changes/index.js";
import type { JobKind } from "./jobs.js";

const RECIPE = new Set(["dish", "component", "variant", "variant_ingredient", "ingredient"]);
const GRAPH = new Set(["member", "preference"]);
const RESOLVE = new Set([
  "target_profile",
  "tolerance",
  "slot_type",
  "member_slot_schedule",
  "training_schedule",
  "day_override",
  "meal_distribution",
  "slot_target_override",
  "portion_bias",
  "exclusion",
]);

export interface FollowUp {
  kind: JobKind;
  payload: Json;
}

/** Entity names a change set touched (from its stored before-images). */
export function touchedEntityNames(row: { id: string; inverse: Json }): Set<string> {
  const names = new Set<string>();
  for (const id of touchedEntities(row)) names.add(id.slice(0, id.indexOf(":")));
  return names;
}

/** The follow-up jobs of one change set. `today` is the household's local date. */
export function followUpJobs(row: { id: string; inverse: Json }, today: string): FollowUp[] {
  const names = touchedEntityNames(row);
  const has = (set: ReadonlySet<string>) => [...names].some((n) => set.has(n));
  const out: FollowUp[] = [];
  const recipe = has(RECIPE);
  if (recipe) out.push({ kind: "nutrition.recompute", payload: { changeSetId: row.id } });
  if (recipe || has(GRAPH)) out.push({ kind: "kg.sync", payload: { changeSetId: row.id } });
  if (recipe || has(RESOLVE))
    out.push({ kind: "plates.resolve", payload: { fromDate: today, changeSetId: row.id } });
  return out;
}
