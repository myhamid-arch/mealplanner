// PLN-9 §6.3 hard filters, applied before solving: plannable status, slot suitability, exclusions
// (SPEC-Q-6, R-34), `hard = never` preferences, and frequency (SPEC-Q-5).
import { weekdayOf, type FrequencyRuleRow, type SlotTypeRow } from "../../types/index.js";
import { variantAllowed, type MemberCtx } from "../solver/index.js";
import { DEFAULT_MIN_GAP_DAYS } from "./config.js";
import type { Household } from "./members.js";
import type { Pool } from "./pool.js";
import type { PlanDish } from "./types.js";

/** One served meal, as the frequency rules and the economy window read it. */
export type Served = {
  date: string;
  /** `dayNumber(date)`. */
  day: number;
  mealKey: string;
  dishId: string;
  memberIds: readonly string[];
  cuisineKey: string;
  methodKeys: readonly string[];
  /** Core ingredients of the served dish variants (adjusters excluded). */
  core: readonly string[];
  mainProtein: string | null;
  /** Orders meals within a date: slot time, then sort order (SPEC-Q-9 "previous meal"). */
  timeKey: string;
};

/**
 * SPEC-Q-9 "previous meal": the later of two meals by slot time; equal times (individual meals of
 * one slot) are ordered by meal key, so the choice never depends on list order.
 */
export function laterThan(a: Served, b: Served): boolean {
  return a.timeKey > b.timeKey || (a.timeKey === b.timeKey && a.mealKey > b.mealKey);
}

/** `dish.status = active` and no variant `needs_review` (PLN-9 §6.3). */
export function plannable(dish: PlanDish): boolean {
  return (
    dish.status === "active" &&
    dish.components.every((c) => c.variants.every((v) => !v.needsReview))
  );
}

/**
 * Slot suitability (PLN-9 §6.3): the dish lists the slot, or the slot is packed and the dish is a
 * packable lunch dish. Packed slots need `is_packable`; packed without reheat needs
 * `served_cold_ok`.
 */
export function suitsSlot(dish: PlanDish, slot: SlotTypeRow): boolean {
  const listed = dish.slotKeys.includes(slot.key);
  const lunchClass = slot.isPacked && dish.slotKeys.includes("lunch");
  if (!listed && !lunchClass) return false;
  if (slot.isPacked) {
    if (!dish.isPackable) return false;
    if (!slot.reheatAvailable && !dish.servedColdOk) return false;
  }
  return true;
}

/**
 * SPEC-Q-6: every attendee has an allowed variant for every required component. Variants and
 * optional components are then chosen per plate by the solver.
 */
export function passesExclusions(dish: PlanDish, contexts: readonly MemberCtx[]): boolean {
  return contexts.every((ctx) =>
    dish.components.every((c) => !c.required || c.variants.some((v) => variantAllowed(v, ctx))),
  );
}

/**
 * `hard = never` for an attendee on the dish, or on a core ingredient present in every variant of
 * some required component (PLN-9 §6.3). Member-level and household-level rows both count.
 */
export function neverReason(
  dish: PlanDish,
  attendees: readonly string[],
  household: Household,
  pool: Pool,
): string | null {
  const never = (memberId: string, type: "dish" | "ingredient", key: string) =>
    household.prefs.resolve(memberId, type, key)?.hard === "never" ||
    household.prefs.resolve(null, type, key)?.hard === "never";
  for (const m of attendees) {
    if (never(m, "dish", dish.id)) return `${m} never eats ${dish.name}`;
    for (const c of dish.components) {
      if (!c.required) continue;
      const cores = c.variants.map((v) => new Set(pool.variant(v.id)?.core ?? []));
      const first = cores[0];
      if (first === undefined) continue;
      for (const i of first)
        if (cores.every((s) => s.has(i)) && never(m, "ingredient", i))
          return `${m} never eats ${pool.slugById.get(i) ?? i}`;
    }
  }
  return null;
}

const DAY_NUMBERS = new Map<string, number>();

/** Days since 1970-01-01 of an ISO date (memoised: planning compares dates in hot loops). */
export function dayNumber(date: string): number {
  let n = DAY_NUMBERS.get(date);
  if (n === undefined) {
    n = Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    DAY_NUMBERS.set(date, n);
  }
  return n;
}

/** Monday of the ISO week (weekday 0 = Monday) containing the date. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weekdayOf(date));
  return d.toISOString().slice(0, 10);
}

function ruleMatches(rule: FrequencyRuleRow, s: Served): boolean {
  switch (rule.entityType) {
    case "dish":
      return s.dishId === rule.entityKey;
    case "ingredient":
      return s.core.includes(rule.entityKey);
    case "cuisine":
      return s.cuisineKey === rule.entityKey;
    case "method":
      return s.methodKeys.includes(rule.entityKey);
  }
}

function candidateMatches(rule: FrequencyRuleRow, dish: PlanDish, pool: Pool): boolean {
  const variants = dish.components.flatMap((c) => c.variants);
  switch (rule.entityType) {
    case "dish":
      return dish.id === rule.entityKey;
    case "ingredient":
      return variants.some((v) => pool.variant(v.id)?.core.includes(rule.entityKey) ?? false);
    case "cuisine":
      return dish.cuisineKey === rule.entityKey;
    case "method":
      return variants.some((v) => v.methodKey === rule.entityKey);
  }
}

/**
 * Frequency (PLN-9 §6.3, SPEC-Q-5). `history` holds every other served meal (planned, locked and
 * context). Returns the reason the dish is blocked, or null.
 * - The same dish for an attendee fewer than `min_gap_days` days away, in either direction. The
 *   default is 6; a household-level `frequency_rule` on the dish replaces it for that dish.
 * - Each applicable `frequency_rule` (member-level for an attending member, household-level for
 *   everyone): `min_gap_days` as above, and `max_per_week` over the ISO week of the date.
 */
export function frequencyReason(
  dish: PlanDish,
  date: string,
  attendees: readonly string[],
  history: readonly Served[],
  rules: readonly FrequencyRuleRow[],
  pool: Pool,
): string | null {
  const attending = new Set(attendees);
  const shares = (s: Served) => s.memberIds.some((m) => attending.has(m));
  const householdDishRule = rules.find(
    (r) =>
      r.memberId === null &&
      r.entityType === "dish" &&
      r.entityKey === dish.id &&
      r.minGapDays !== null,
  );
  const gap = householdDishRule?.minGapDays ?? DEFAULT_MIN_GAP_DAYS;
  const day = dayNumber(date);
  for (const s of history)
    if (s.dishId === dish.id && shares(s) && Math.abs(s.day - day) < gap)
      return `${dish.name} was served ${s.date} (min gap ${String(gap)} days)`;

  const week = weekStart(date);
  for (const rule of rules) {
    if (rule === householdDishRule) continue;
    if (rule.memberId !== null && !attending.has(rule.memberId)) continue;
    if (!candidateMatches(rule, dish, pool)) continue;
    const relevant = history.filter(
      (s) =>
        ruleMatches(rule, s) &&
        (rule.memberId === null ? shares(s) : s.memberIds.includes(rule.memberId)),
    );
    if (rule.minGapDays !== null) {
      const near = relevant.find((s) => Math.abs(s.day - day) < (rule.minGapDays ?? 0));
      if (near !== undefined)
        return `${rule.entityType} ${rule.entityKey}: served ${near.date} (min gap ${String(rule.minGapDays)} days)`;
    }
    if (rule.maxPerWeek !== null) {
      const count = relevant.filter((s) => weekStart(s.date) === week).length;
      if (count >= rule.maxPerWeek)
        return `${rule.entityType} ${rule.entityKey}: already ${String(count)} time(s) this week (max ${String(rule.maxPerWeek)})`;
    }
  }
  return null;
}
