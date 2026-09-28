// node-1.2 N3 measurements over a persisted plan (R-69, R-70): everything is read back from the
// database the worker wrote (plan_day, plan_meal, plate, plate_item, cook_batch, job), never from
// the planner in memory. Per-100 g values are read by SQL from `dish_nutrition_cache` (written by
// the catalogue loader's nutrition recompute), not through the planner's loader (`loadPlanPool`),
// so a planner that miscomputes nutrition disagrees with this checker (pre-CP2 finding 3). The
// targets come from the stored household configuration.
import { resolveSlotTargets } from "@mealplanner/core/planner";
import type { HouseholdConfig, HouseholdContext } from "@mealplanner/core/types";
import { loadHouseholdConfig } from "@mealplanner/db/services/config";
import { cookSheetFor } from "@mealplanner/db/services/plans";
import type pg from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const EPS = 1e-6;
const MACROS = ["protein", "carbs", "fat"] as const;
const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "satFat", "fibre"] as const;
type Nutrient = (typeof NUTRIENTS)[number];
type Totals = Record<Nutrient, number>;

export interface StoredPlate {
  id: string;
  memberId: string;
  fitStatus: string;
  target: Record<string, unknown>;
  actual: Record<string, number | null>;
  deviation: { flag: string | null; kcal: number; protein: number; carbs: number; fat: number };
  items: { componentId: string; variantId: string; cookedG: number; raw: Record<string, number> }[];
}

export interface StoredMeal {
  id: string;
  date: string;
  slotTypeId: string;
  slotKey: string;
  dishId: string;
  memberScope: string;
  locked: boolean;
  attendees: string[];
  frequencyRelaxed: string | null;
  plates: StoredPlate[];
  batches: { variantId: string; totalCookedG: number; raw: Record<string, number> }[];
}

export interface Flag {
  kind: string;
  date: string;
  slotKey: string | null;
  memberId: string | null;
  reason: string;
}

/** The stored meals of `dates`, with plates, items and cook batches. */
export async function readPlan(
  pool: pg.Pool,
  householdId: string,
  dates: readonly string[],
): Promise<StoredMeal[]> {
  const { rows: meals } = await pool.query<{
    id: string;
    date: string;
    slot_type_id: string;
    slot_key: string;
    dish_id: string;
    member_scope: string;
    locked: boolean;
    score_breakdown: { meal?: { attendees?: string[]; frequencyRelaxed?: string | null } };
  }>(
    `SELECT m.id, d.date::text AS date, m.slot_type_id, s.key AS slot_key, m.dish_id, m.member_scope, m.locked,
            m.score_breakdown
       FROM plan_meal m
       JOIN plan_day d ON d.id = m.plan_day_id
       JOIN slot_type s ON s.id = m.slot_type_id
      WHERE m.household_id = $1 AND d.date = ANY($2::date[])
      ORDER BY d.date, s.sort_order, m.id`,
    [householdId, dates],
  );
  const { rows: plates } = await pool.query<{
    id: string;
    plan_meal_id: string;
    member_id: string;
    fit_status: string;
    target: Record<string, unknown>;
    actual: Record<string, number | null>;
    deviation: StoredPlate["deviation"];
  }>(
    `SELECT id, plan_meal_id, member_id, fit_status::text, target, actual, deviation
       FROM plate WHERE plan_meal_id = ANY($1::uuid[])`,
    [meals.map((m) => m.id)],
  );
  const { rows: items } = await pool.query<{
    plate_id: string;
    component_id: string;
    variant_id: string;
    cooked_g: string;
    raw_equivalent: Record<string, number>;
  }>(
    `SELECT plate_id, component_id, variant_id, cooked_g::text, raw_equivalent
       FROM plate_item WHERE plate_id = ANY($1::uuid[])`,
    [plates.map((p) => p.id)],
  );
  const { rows: batches } = await pool.query<{
    plan_meal_id: string;
    variant_id: string;
    total_cooked_g: string;
    raw_ingredients: Record<string, number>;
  }>(
    `SELECT plan_meal_id, variant_id, total_cooked_g::text, raw_ingredients
       FROM cook_batch WHERE plan_meal_id = ANY($1::uuid[])`,
    [meals.map((m) => m.id)],
  );
  return meals.map((m) => ({
    id: m.id,
    date: m.date,
    slotTypeId: m.slot_type_id,
    slotKey: m.slot_key,
    dishId: m.dish_id,
    memberScope: m.member_scope,
    locked: m.locked,
    attendees: m.score_breakdown.meal?.attendees ?? [],
    frequencyRelaxed: m.score_breakdown.meal?.frequencyRelaxed ?? null,
    plates: plates
      .filter((p) => p.plan_meal_id === m.id)
      .map((p) => ({
        id: p.id,
        memberId: p.member_id,
        fitStatus: p.fit_status,
        target: p.target,
        actual: p.actual,
        deviation: p.deviation,
        items: items
          .filter((i) => i.plate_id === p.id)
          .map((i) => ({
            componentId: i.component_id,
            variantId: i.variant_id,
            cookedG: Number(i.cooked_g),
            raw: i.raw_equivalent,
          })),
      })),
    batches: batches
      .filter((b) => b.plan_meal_id === m.id)
      .map((b) => ({
        variantId: b.variant_id,
        totalCookedG: Number(b.total_cooked_g),
        raw: b.raw_ingredients,
      })),
  }));
}

/** Per-100 g cooked nutrients of every variant the plan uses, read from `dish_nutrition_cache`. */
export async function variantNutrients(
  pool: pg.Pool,
  meals: readonly StoredMeal[],
): Promise<Map<string, Totals>> {
  const ids = [
    ...new Set(meals.flatMap((m) => m.plates.flatMap((p) => p.items.map((i) => i.variantId)))),
  ];
  const { rows } = await pool.query<{
    variant_id: string;
    kcal: string;
    protein: string;
    carbs: string;
    fat: string;
    sat_fat: string;
    fibre: string;
  }>(
    `SELECT variant_id, kcal::text, protein::text, carbs::text, fat::text, sat_fat::text, fibre::text
       FROM dish_nutrition_cache WHERE variant_id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(
    rows.map((r) => [
      r.variant_id,
      {
        kcal: Number(r.kcal),
        protein: Number(r.protein),
        carbs: Number(r.carbs),
        fat: Number(r.fat),
        satFat: Number(r.sat_fat),
        fibre: Number(r.fibre),
      },
    ]),
  );
}

/**
 * `dish_nutrition_cache` stores per-100 g values to 0.001 (numeric scale 3), so a recomputed plate
 * total can differ from the planner's unrounded one by at most Σ cooked g × 0.0005 / 100 per
 * nutrient: the bound every comparison below allows, and nothing more.
 */
const CACHE_HALF_STEP = 0.0005;

function recompute(plate: StoredPlate, per100g: Map<string, Totals>) {
  const n = Object.fromEntries(NUTRIENTS.map((k) => [k, 0])) as Totals;
  const missing: string[] = [];
  const bound = (plate.items.reduce((g, i) => g + i.cookedG, 0) * CACHE_HALF_STEP) / 100 + EPS;
  for (const item of plate.items) {
    const v = per100g.get(item.variantId);
    if (v === undefined) {
      missing.push(item.variantId);
      continue;
    }
    for (const k of NUTRIENTS) n[k] += (v[k] * item.cookedG) / 100;
  }
  return { n, missing, bound };
}

interface Target {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  satFatMax?: number;
  carbBasis: "total" | "available";
  tol: { kcal: number; protein: number; carbs: number; fat: number };
}

const macroOf = (n: Totals, m: (typeof MACROS)[number], basis: Target["carbBasis"]) =>
  m === "carbs" ? (basis === "total" ? n.carbs + n.fibre : n.carbs) : n[m];

export interface Sc1Result {
  total: number;
  inTolerance: number;
  flagged: number;
  noPlateFlagged: number;
  failures: string[];
  /** Largest |recomputed − stored actual| over every plate and nutrient (R-70 amendment 2). */
  maxStoredDiff: number;
  maxStoredDiffAt: string;
  /** Plates whose stored total differs from their items by more than the rounding bound. */
  storedDrift: number;
  memberDays: number;
}

/**
 * SC-1 from the persisted plates, with leaf 1.2.3's rules: every targeted member-meal the resolver
 * expects is in tolerance by this function's own arithmetic (P/C/F per meal, sat-fat cap, kcal in
 * the R-28 re-targeted window, which the stored target must equal), or is flagged with its reason
 * and the smallest deviation found. Member-day kcal totals are within ±tolerance.kcal unless the
 * day has a flagged slot, which must itself be flagged.
 */
export function evaluateSc1(
  cfg: HouseholdConfig,
  dates: readonly string[],
  meals: readonly StoredMeal[],
  per100g: Map<string, Totals>,
  flags: readonly Flag[],
): Sc1Result {
  const r: Sc1Result = {
    total: 0,
    inTolerance: 0,
    flagged: 0,
    noPlateFlagged: 0,
    failures: [],
    maxStoredDiff: 0,
    maxStoredDiffAt: "",
    storedDrift: 0,
    memberDays: 0,
  };
  // The stored totals of every plate (targeted or not) against its items.
  for (const meal of meals)
    for (const plate of meal.plates) {
      const { n, missing, bound } = recompute(plate, per100g);
      for (const v of missing)
        r.failures.push(`${meal.date} ${meal.slotKey}: variant ${v} unknown`);
      let drifted = false;
      for (const k of NUTRIENTS) {
        const stored = plate.actual[k];
        const diff = typeof stored === "number" ? Math.abs(stored - n[k]) : Infinity;
        if (diff > bound) drifted = true;
        if (diff > r.maxStoredDiff) {
          r.maxStoredDiff = diff;
          r.maxStoredDiffAt = `${meal.date} ${meal.slotKey} ${plate.memberId} ${k}`;
        }
      }
      if (drifted) {
        r.storedDrift += 1;
        r.failures.push(
          `${meal.date} ${meal.slotKey} ${plate.memberId}: stored total differs from its items by more than ${bound.toFixed(4)}`,
        );
      }
    }
  // A flag counts only with a persisted reason (pre-CP2 finding 11).
  const reasoned = flags.filter((f) => f.reason.trim() !== "");
  const flagKey = (f: Flag) => `${f.date}|${String(f.slotKey)}|${String(f.memberId)}`;
  const memberFlags = new Set(reasoned.filter((f) => f.memberId !== null).map(flagKey));
  const mealFlags = new Set(
    reasoned
      .filter((f) => f.memberId === null && f.slotKey !== null)
      .map((f) => `${f.date}|${String(f.slotKey)}`),
  );
  const slotOrder = (id: string) => {
    const s = cfg.slotTypes.find((x) => x.id === id);
    return s === undefined
      ? ""
      : `${s.defaultTime}|${String(s.sortOrder).padStart(6, "0")}|${s.key}`;
  };
  for (const date of dates) {
    const targets = resolveSlotTargets(cfg, date);
    const dayMeals = meals.filter((m) => m.date === date);
    for (const member of [...new Set(targets.map((t) => t.memberId))]) {
      const own = targets
        .filter((t) => t.memberId === member)
        .sort((a, b) => slotOrder(a.slotTypeId).localeCompare(slotOrder(b.slotTypeId)));
      const tolKcal = cfg.tolerances.find((t) => t.memberId === member)?.kcal ?? 50;
      let d = 0;
      let dBound = 0;
      let band = 0;
      let total = 0;
      let dayFlagged = false;
      r.memberDays += 1;
      for (const t of own) {
        r.total += 1;
        band += t.tol.kcal;
        const key = `${date}|${t.slotKey}|${member}`;
        const hits = dayMeals.flatMap((meal) =>
          meal.slotTypeId === t.slotTypeId
            ? meal.plates.filter((p) => p.memberId === member).map((plate) => ({ meal, plate }))
            : [],
        );
        const hit = hits[0];
        if (hits.length !== 1 || hit === undefined) {
          const isFlagged = memberFlags.has(key) || mealFlags.has(`${date}|${t.slotKey}`);
          if (hits.length === 0 && isFlagged) r.noPlateFlagged += 1;
          else r.failures.push(`${key}: ${String(hits.length)} plates and no flag`);
          dayFlagged = true;
          continue;
        }
        const { meal, plate } = hit;
        const { n, bound } = recompute(plate, per100g);
        const tolEps = bound + EPS;
        const devs: Record<string, number> = {};
        for (const m of MACROS) devs[m] = macroOf(n, m, t.carbBasis) - t[m];
        const windowKcal = t.kcal - d;
        devs.kcal = n.kcal - windowKcal;
        const inTol =
          MACROS.every((m) => Math.abs(devs[m] ?? Infinity) <= t.tol[m] + tolEps) &&
          Math.abs(devs.kcal) <= band + tolEps + dBound &&
          (t.satFatMax === undefined || n.satFat <= t.satFatMax + tolEps);
        const stored = plate.target as unknown as Target;
        if (
          !meal.locked &&
          (Math.abs(stored.kcal - windowKcal) > dBound + EPS ||
            Math.abs(stored.tol.kcal - band) > 1e-6)
        )
          r.failures.push(
            `${key}: stored target ${String(stored.kcal)}±${String(stored.tol.kcal)} is not the R-28 window ${windowKcal.toFixed(1)}±${String(band)}`,
          );
        const reason = plate.deviation.flag;
        const hasDeviation = MACROS.every((m) => typeof plate.deviation[m] === "number");
        const isFlagged = reason !== null && reason !== "" && hasDeviation && memberFlags.has(key);
        if (inTol) r.inTolerance += 1;
        else if (isFlagged) r.flagged += 1;
        else r.failures.push(`${key}: out of tolerance and not flagged`);
        if (plate.fitStatus === "in_tolerance" && !inTol)
          r.failures.push(`${key}: stored in_tolerance but recomputes outside tolerance`);
        if (plate.fitStatus !== "in_tolerance") dayFlagged = true;
        if (plate.fitStatus !== "in_tolerance" && !isFlagged)
          r.failures.push(`${key}: status ${plate.fitStatus} without a flag`);
        d += n.kcal - t.kcal;
        dBound += bound;
        total += n.kcal;
      }
      const target = own.reduce((s, t) => s + t.kcal, 0);
      if (Math.abs(band - tolKcal) > EPS)
        r.failures.push(
          `${date} ${member}: slot bands sum to ${String(band)}, not ${String(tolKcal)}`,
        );
      if (!dayFlagged && Math.abs(total - target) > tolKcal + EPS)
        r.failures.push(
          `${date} ${member}: day total ${total.toFixed(1)} outside ${String(target)} ± ${String(tolKcal)}`,
        );
      if (
        dayFlagged &&
        !reasoned.some(
          (f) => f.kind === "member_day_kcal" && f.date === date && f.memberId === member,
        )
      )
        r.failures.push(`${date} ${member}: member-day with a flagged slot is not flagged`);
    }
  }
  return r;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/**
 * OQ-8 as the owner ruled it (R-62, R-63), written here rather than read from the planner's
 * constants (pre-CP2 finding 1): a main meal repeats a dish only at a day difference of 7 or more,
 * a snack or workout meal at 4 or more; a pair uses the larger gap of its two slots.
 */
export const OWNER_MAIN_GAP_DAYS = 7;
export const OWNER_SHORT_GAP_DAYS = 4;
export const OWNER_SHORT_SLOT_KEYS: readonly string[] = ["snack", "pre_workout", "post_workout"];

export function repeatGap(slotKey: string): number {
  return OWNER_SHORT_SLOT_KEYS.includes(slotKey) ? OWNER_SHORT_GAP_DAYS : OWNER_MAIN_GAP_DAYS;
}

export interface GapResult {
  pairs: number;
  relaxed: number;
  violations: string[];
}

/**
 * Two meals serving the same dish to a shared attendee must be at least the pair's gap apart (day
 * difference). The only exception is a later meal whose relaxation the plan persisted as a
 * `frequency_relaxed` flag with a reason (pre-CP2 finding 2); a meal marked relaxed without one is
 * a violation.
 */
export function checkRepeatGaps(meals: readonly StoredMeal[], flags: readonly Flag[]): GapResult {
  const r: GapResult = { pairs: 0, relaxed: 0, violations: [] };
  const backed = (m: StoredMeal) =>
    m.frequencyRelaxed !== null &&
    flags.some(
      (f) =>
        f.kind === "frequency_relaxed" &&
        f.date === m.date &&
        f.slotKey === m.slotKey &&
        f.memberId === (m.memberScope === "shared" ? null : m.memberScope) &&
        f.reason.trim() !== "",
    );
  const sorted = [...meals].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 1)
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (a === undefined || b === undefined || a.dishId !== b.dishId || a.id === b.id) continue;
      const eaters = (m: StoredMeal) =>
        new Set(m.attendees.length > 0 ? m.attendees : m.plates.map((p) => p.memberId));
      const ea = eaters(a);
      if (![...eaters(b)].some((x) => ea.has(x))) continue;
      r.pairs += 1;
      const gap = Math.max(repeatGap(a.slotKey), repeatGap(b.slotKey));
      const apart = dayNumber(b.date) - dayNumber(a.date);
      if (apart >= gap) continue;
      const later = apart === 0 ? [a, b] : [b];
      if (later.some(backed)) {
        r.relaxed += 1;
        continue;
      }
      r.violations.push(
        `${a.dishId}: ${a.date} ${a.slotKey} and ${b.date} ${b.slotKey} are ${String(apart)} day(s) apart (gap ${String(gap)})${later.some((m) => m.frequencyRelaxed !== null) ? ", relaxed without a persisted flag" : ""}`,
      );
    }
  return r;
}

export interface CookSheetResult {
  batches: number;
  lines: number;
  maxDiffG: number;
  failures: string[];
}

/**
 * Day `date`'s cook sheet, built by the service from the persisted plan: for every batch and
 * ingredient, its raw grams equal the sum of that meal's plate raw equivalents for the variant.
 * The stored cook_batch rows are checked the same way.
 */
export async function checkCookSheet(
  db: NodePgDatabase,
  ctx: HouseholdContext,
  date: string,
  meals: readonly StoredMeal[],
  toleranceG: number,
): Promise<CookSheetResult> {
  const r: CookSheetResult = { batches: 0, lines: 0, maxDiffG: 0, failures: [] };
  const { sheet, mealIds } = await cookSheetFor(db, ctx, date);
  const day = sheet.days.find((x) => x.date === date);
  if (day === undefined || day.meals.length === 0) {
    r.failures.push(`no cook sheet for ${date}`);
    return r;
  }
  const compare = (
    label: string,
    sheetRaw: Record<string, number>,
    platesRaw: Record<string, number>,
  ) => {
    for (const id of new Set([...Object.keys(sheetRaw), ...Object.keys(platesRaw)])) {
      r.lines += 1;
      const diff = Math.abs((sheetRaw[id] ?? 0) - (platesRaw[id] ?? 0));
      r.maxDiffG = Math.max(r.maxDiffG, diff);
      if (diff > toleranceG)
        r.failures.push(
          `${label} ${id}: ${String(sheetRaw[id] ?? 0)} g vs plates ${String(platesRaw[id] ?? 0)} g`,
        );
    }
  };
  const platesRawOf = (meal: StoredMeal, variantId: string) => {
    const sum: Record<string, number> = {};
    for (const p of meal.plates)
      for (const i of p.items)
        if (i.variantId === variantId)
          for (const [id, g] of Object.entries(i.raw)) sum[id] = (sum[id] ?? 0) + g;
    return sum;
  };
  for (const cookMeal of day.meals) {
    const key = `${cookMeal.slotKey}|${cookMeal.memberScope}`;
    const meal = meals.find((m) => m.id === mealIds[key]);
    if (meal === undefined) {
      r.failures.push(`cook-sheet meal ${key} has no stored meal`);
      continue;
    }
    for (const b of cookMeal.batches) {
      r.batches += 1;
      const raw: Record<string, number> = {};
      for (const x of [...b.raw, ...b.discardedFat])
        raw[x.ingredientId] = (raw[x.ingredientId] ?? 0) + x.rawG;
      compare(`${meal.slotKey} ${b.variantId}`, raw, platesRawOf(meal, b.variantId));
    }
    for (const stored of meal.batches)
      compare(
        `${meal.slotKey} stored batch ${stored.variantId}`,
        stored.raw,
        platesRawOf(meal, stored.variantId),
      );
  }
  return r;
}

/** Distinct core ingredients (leaf 1.2.3: category ≠ herb_spice, slug ≠ water) of the stored plates. */
export async function coreIngredients(
  pool: pg.Pool,
  householdId: string,
  dates: readonly string[],
): Promise<string[]> {
  const { rows } = await pool.query<{ slug: string }>(
    `SELECT DISTINCT i.slug
       FROM plate_item pi
       JOIN plate p ON p.id = pi.plate_id
       JOIN plan_meal m ON m.id = p.plan_meal_id
       JOIN plan_day d ON d.id = m.plan_day_id
       JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id
       JOIN ingredient i ON i.id = vi.ingredient_id
      WHERE m.household_id = $1 AND d.date = ANY($2::date[])
        AND i.category::text <> 'herb_spice' AND i.slug <> 'water'
      ORDER BY i.slug`,
    [householdId, dates],
  );
  return rows.map((row) => row.slug);
}

/** SC-2 (OQ-8, R-63): median reduction ≥ 8 % and no seed below 0 %. */
export function sc2Aggregate(reductions: readonly number[]) {
  const sorted = [...reductions].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? NaN
      : sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? NaN);
  const min = sorted[0] ?? NaN;
  const max = sorted.at(-1) ?? NaN;
  return { median, min, max, pass: sorted.length > 0 && median >= 0.08 && min >= 0 };
}

export async function householdConfig(db: NodePgDatabase, ctx: HouseholdContext) {
  return loadHouseholdConfig(db, ctx);
}
