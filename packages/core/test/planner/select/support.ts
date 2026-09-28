// Shared test support: the seed library, F1 plans memoised per file, and small config helpers.
import {
  planDays,
  type PlanDish,
  type PlanInput,
  type PlanResult,
} from "../../../src/planner/index.js";
import type { HouseholdConfig, MealOverrideRow } from "../../../src/types/index.js";
import { f1PlanConfig, F1_WEEK, slotId } from "./f1.js";
import { buildSeedLibrary, type SeedLibrary } from "./library.js";
import { seedFiles } from "./seed-files.js";

let library: SeedLibrary | undefined;
export function seedLibrary(): SeedLibrary {
  library ??= buildSeedLibrary(seedFiles());
  return library;
}

export const MONDAY = F1_WEEK[0];
export const TUESDAY = F1_WEEK[1];

export async function planF1(
  dates: readonly string[],
  opts: { seed?: number; config?: HouseholdConfig; dishes?: PlanDish[] } = {},
): Promise<PlanResult> {
  const lib = seedLibrary();
  return planDays(
    {
      config: opts.config ?? f1PlanConfig(),
      dates,
      dishes: opts.dishes ?? lib.dishes,
      adjusters: lib.adjusters,
    },
    { seed: opts.seed ?? 1 },
  );
}

export function override(
  date: string,
  slotKey: string,
  kind: MealOverrideRow["kind"],
  memberIds: string[],
): MealOverrideRow {
  return {
    id: `override-${date}-${slotKey}-${kind}`,
    householdId: "household-test",
    planDate: date,
    slotTypeId: slotId(slotKey),
    kind,
    memberIds,
    createdBy: "user-admin",
    createdAt: new Date(0),
  };
}

/** Every plate of the plan with its meal. */
export function platesOf(plan: PlanResult) {
  return plan.days.flatMap((d) =>
    d.meals.flatMap((meal) => meal.plates.map((plate) => ({ meal, plate }))),
  );
}

/**
 * A plan without its run counters (wall-clock time, and solves and cache hits, which depend on
 * what earlier runs in the process memoised), for equality checks.
 */
export function stable(plan: PlanResult): unknown {
  return { ...plan, stats: { ...plan.stats, ms: 0, solves: 0, cacheHits: 0 } };
}

// ---------------------------------------------------------------------------------------------
// leaf-1.2.7 G1 (W-17, R-73): every surrogate id of a planner input remapped consistently
// ---------------------------------------------------------------------------------------------

/** Preference and frequency-rule entity types whose keys are surrogate ids (dish keys may be `dish#variant`). */
const ID_KEYED_ENTITIES: ReadonlySet<string> = new Set(["dish", "ingredient"]);

/** True for a field that holds one surrogate id: `id`, `…Id` (householdId, slotTypeId, …). */
const isIdField = (key: string) => key === "id" || /[a-z]Id$/.test(key);
/** True for a field that holds a list of surrogate ids: `memberIds`, … */
const isIdListField = (key: string) => /[a-z]Ids$/.test(key);

/**
 * Walks a planner input and calls `visit` on every surrogate id it holds, returning the value with
 * each id replaced by `visit`'s answer. Ids are the values of `id` / `…Id` / `…Ids` fields; an
 * `entityKey` whose `entityType` is a dish or an ingredient (`dish#variant` keys map both parts); a
 * meal's `memberScope` other than `shared`; and `variantLimits` (component id → variant ids).
 * Natural keys (`slug`, slot `key`, `cuisineKey`, exclusion keys, names, labels) are left as they are.
 */
export function mapInputIds<T>(value: T, visit: (id: string) => string): T {
  const walk = (
    v: unknown,
    key: string | null,
    parent: Record<string, unknown> | null,
  ): unknown => {
    if (typeof v === "string") {
      if (key === null) return v;
      if (isIdField(key)) return visit(v);
      if (key === "memberScope") return v === "shared" ? v : visit(v);
      if (key === "entityKey" && ID_KEYED_ENTITIES.has(String(parent?.entityType)))
        return v.split("#").map(visit).join("#");
      return v;
    }
    if (Array.isArray(v)) {
      const listOfIds = key !== null && isIdListField(key);
      return v.map((x) => (listOfIds && typeof x === "string" ? visit(x) : walk(x, null, null)));
    }
    if (v instanceof Date || v === null || typeof v !== "object") return v;
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(obj)) {
      if (k === "variantLimits" && x !== null && typeof x === "object") {
        out[k] = Object.fromEntries(
          Object.entries(x as Record<string, string[]>).map(([c, vs]) => [visit(c), vs.map(visit)]),
        );
        continue;
      }
      out[k] = walk(x, k, obj);
    }
    return out;
  };
  return walk(value, null, null) as T;
}

/** Every distinct surrogate id of a planner input, in first-seen order. */
export function surrogateIds(value: unknown): string[] {
  const seen = new Set<string>();
  mapInputIds(value, (id) => {
    seen.add(id);
    return id;
  });
  return [...seen];
}

/**
 * How fresh ids sort against the originals: `reverse` flips every id comparison; `preserve` keeps
 * every comparison and changes only the ids' bits (the salted-prefix case of W-17).
 */
export type IdOrder = "reverse" | "preserve";

/**
 * Fresh UUIDv7-shaped ids (RFC 9562 §5.7 layout) for `ids`, one each: the timestamp field orders
 * them (`order`) and the remaining bits come from a PRNG seeded with `salt`, so every id hash
 * changes.
 */
export function freshIds(
  ids: readonly string[],
  salt: number,
  order: IdOrder = "reverse",
): Map<string, string> {
  const sorted = [...ids].sort();
  let state = salt >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const hex = (n: number, width: number) => n.toString(16).padStart(width, "0").slice(-width);
  const out = new Map<string, string>();
  sorted.forEach((id, i) => {
    const ms = 0x019000000000 + (order === "reverse" ? sorted.length - 1 - i : i) * 7919;
    const time = hex(ms, 12);
    const randA = hex(next() & 0xfff, 3);
    const variant = hex(0x8000 | (next() & 0x3fff), 4);
    const tail = hex(next(), 8) + hex(next() & 0xffff, 4);
    out.set(id, `${time.slice(0, 8)}-${time.slice(8)}-7${randA}-${variant}-${tail}`);
  });
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Replaces every mapped UUID inside every string and object key of `value` (a plan result). */
export function mapBack<T>(value: T, back: ReadonlyMap<string, string>): T {
  const text = (s: string) => s.replace(UUID, (u) => back.get(u) ?? u);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date || v === null || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walk(x)]));
  };
  return walk(value) as T;
}

/** Meals whose dish differs between two plans of the same dates (meal by meal, in plan order). */
export function mealsDiffering(a: PlanResult, b: PlanResult): number {
  const dishes = (p: PlanResult) => p.days.flatMap((d) => d.meals.map((m) => m.dishId));
  const x = dishes(a);
  const y = dishes(b);
  let n = Math.abs(x.length - y.length);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++;
  return n;
}

/** A planner input with every surrogate id remapped (`freshIds`), and the way back. */
export function remapInput(
  input: PlanInput,
  salt: number,
  order: IdOrder = "reverse",
): { input: PlanInput; forward: Map<string, string>; back: Map<string, string> } {
  const forward = freshIds(surrogateIds(input), salt, order);
  const back = new Map([...forward].map(([o, f]) => [f, o]));
  const visit = (id: string) => {
    const f = forward.get(id);
    if (f === undefined) throw new Error(`id ${id} was not collected`);
    return f;
  };
  return { input: mapInputIds(input, visit), forward, back };
}
