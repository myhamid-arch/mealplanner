// Pure helpers of the Today, Plan, Plate and Kitchen screens (unit-tested in logic.test.ts).
// Nutrition display follows R-20 / R-28: carbohydrate is shown as total (available + fibre)
// wherever it is compared with a target; the kcal band is per day (±tolerance.kcal), each slot
// carrying its share; saturated fat defaults to 6 % of energy and fibre to 14 g per 1,000 kcal
// (25 % soluble); untargeted members (children) get no targets.
import type { Tone } from "@mealplanner/ui-tokens/tokens";

export const FIT_STATUSES = ["in_tolerance", "flexible_miss", "infeasible", "untargeted"] as const;
export type FitStatus = (typeof FIT_STATUSES)[number];

// Dates ------------------------------------------------------------------------------------------

/** The calendar date at `at` in `timeZone`, as YYYY-MM-DD (UTC if the zone is invalid). */
export function localDate(at: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Minutes since midnight at `at` in `timeZone`. */
export function localMinutes(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    return get("hour") * 60 + get("minute");
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function isIsoDate(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(utc(value).getTime()) &&
    utc(value).toISOString().slice(0, 10) === value
  );
}

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday (R-24). */
export function weekdayOf(date: string): number {
  return (utc(date).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayOf(date));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(utc(date));

/** "Sunday 27 September" */
export function longDay(date: string): string {
  return fmt(date, { weekday: "long", day: "numeric", month: "long" });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sunday 27 Sep" (the mockups' three-letter months; en-GB would print "Sept") */
export function mediumDay(date: string): string {
  return `${weekdayName(date)} ${dayMonth(date)}`;
}

/** "Mon 28" */
export function shortDay(date: string): string {
  return fmt(date, { weekday: "short", day: "numeric" });
}

/** "Sunday" */
export function weekdayName(date: string): string {
  return fmt(date, { weekday: "long" });
}

/** "28 Sep" */
export function dayMonth(date: string): string {
  const d = utc(date);
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

/** "20:30:00" → "20:30" */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function minutesOf(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

// Numbers ----------------------------------------------------------------------------------------

export function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Grams and kcal as the mockups print them: whole numbers, one decimal below 10. */
export function num(value: number): string {
  const abs = Math.abs(value);
  return abs > 0 && abs < 10 && !Number.isInteger(round(value, 1))
    ? round(value, 1).toFixed(1)
    : String(Math.round(value));
}

// Macros -----------------------------------------------------------------------------------------

export interface MacroValues {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface NutrientLike {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
}

/** R-20 / R-28: carbohydrate on the target's basis (total = available + fibre). */
export function carbsOn(n: NutrientLike, basis: string | null | undefined = "total"): number {
  return basis === "available" ? n.carbs : n.carbs + n.fibre;
}

/** The carb label for a basis ("Carbs g (total)"). */
export function carbLabel(basis: string | null | undefined = "total"): string {
  return basis === "available" ? "Carbs g (available)" : "Carbs g (total)";
}

/** kcal / P / C (on the basis) / F of a nutrient set. */
export function macrosOf(n: NutrientLike, basis: string | null | undefined = "total"): MacroValues {
  return { kcal: n.kcal, protein: n.protein, carbs: carbsOn(n, basis), fat: n.fat };
}

export function sumMacros(values: readonly MacroValues[]): MacroValues {
  return values.reduce(
    (s, v) => ({
      kcal: s.kcal + v.kcal,
      protein: s.protein + v.protein,
      carbs: s.carbs + v.carbs,
      fat: s.fat + v.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** "438 kcal · P33 C44 F15" */
export function macroLine(m: MacroValues): string {
  return `${String(Math.round(m.kcal))} kcal · P${String(Math.round(m.protein))} C${String(
    Math.round(m.carbs),
  )} F${String(Math.round(m.fat))}`;
}

// Fit ---------------------------------------------------------------------------------------------

export interface FitLook {
  label: string;
  tone: Tone;
  icon: "check" | "approx" | "cross" | "dash";
}

/** UX-6: fit carries a text and an icon, never colour alone. */
export function fitLook(status: FitStatus): FitLook {
  switch (status) {
    case "in_tolerance":
      return { label: "On target", tone: "basil", icon: "check" };
    case "flexible_miss":
      return { label: "Close to target", tone: "saffron", icon: "approx" };
    case "infeasible":
      return { label: "Missed target", tone: "pomegranate", icon: "cross" };
    case "untargeted":
      return { label: "No targets", tone: "neutral", icon: "dash" };
  }
}

/** A summary over targeted plates: all on target, or how many missed. */
export function fitSummary(statuses: readonly FitStatus[]): {
  targeted: number;
  onTarget: number;
  text: string;
  tone: Tone;
} {
  const targeted = statuses.filter((s) => s !== "untargeted");
  const onTarget = targeted.filter((s) => s === "in_tolerance").length;
  if (targeted.length === 0)
    return { targeted: 0, onTarget: 0, text: "No targeted meals", tone: "neutral" };
  if (onTarget === targeted.length)
    return {
      targeted: targeted.length,
      onTarget,
      text: `All ${String(targeted.length)} targeted meals on target`,
      tone: "basil",
    };
  const missed = targeted.length - onTarget;
  return {
    targeted: targeted.length,
    onTarget,
    text: `${String(missed)} of ${String(targeted.length)} targeted meals off target`,
    tone: targeted.some((s) => s === "infeasible") ? "pomegranate" : "saffron",
  };
}

// Daily goals (R-28) ------------------------------------------------------------------------------

export const SAT_FAT_DEFAULT_PCT = 6;
export const FIBRE_G_PER_1000_KCAL = 14;
export const SOLUBLE_SHARE = 0.25;

/** Saturated-fat cap for a day: the member's own, else pct % of the day's kcal (9 kcal/g). */
export function satFatCap(dayKcal: number, ownMaxG: number | null, pct = SAT_FAT_DEFAULT_PCT) {
  return ownMaxG ?? (dayKcal * pct) / 100 / 9;
}

/** Fibre goals for a day: the member's own, else 14 g per 1,000 kcal, a quarter of it soluble. */
export function fibreGoals(
  dayKcal: number,
  own: { fibreMinG: number | null; solubleFibreMinG: number | null },
) {
  const fibre = own.fibreMinG ?? (dayKcal / 1000) * FIBRE_G_PER_1000_KCAL;
  return { fibre, soluble: own.solubleFibreMinG ?? fibre * SOLUBLE_SHARE };
}

// Cuisine colours (WeekPlan legend) --------------------------------------------------------------

/**
 * Cuisine families of the WeekPlan legend (Levantine, American / British, Italian, Indian, East
 * Asian), extended to every key in data/cuisines.json, coloured with UX-5 accents.
 */
const FAMILIES: ReadonlyArray<{ family: string; tone: Tone; keys: readonly string[] }> = [
  {
    family: "Levantine & Gulf",
    tone: "tomato",
    keys: ["levantine", "emirati_gulf", "persian", "turkish", "north_african", "east_african"],
  },
  {
    family: "American / British",
    tone: "sea",
    keys: ["american", "british", "tex_mex", "mexican"],
  },
  {
    family: "Italian & Mediterranean",
    tone: "basil",
    keys: ["italian", "mediterranean", "greek", "spanish", "french"],
  },
  { family: "Indian", tone: "saffron", keys: ["indian", "pakistani"] },
  {
    family: "East Asian",
    tone: "aubergine",
    keys: ["chinese", "japanese", "korean", "thai", "vietnamese"],
  },
];

const CUISINE_FAMILY = new Map(
  FAMILIES.flatMap((f) => f.keys.map((k) => [k, { family: f.family, tone: f.tone }] as const)),
);

export const CUISINE_FAMILIES = FAMILIES.map((f) => ({ family: f.family, tone: f.tone }));

export function cuisineFamily(key: string): { family: string; tone: Tone } {
  return CUISINE_FAMILY.get(key) ?? { family: "Other", tone: "olive" };
}

export function titleCase(key: string): string {
  const s = key.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Week header strip (UX-4) ------------------------------------------------------------------------

export interface WeekStats {
  distinctIngredients: number;
  targeted: number;
  onTarget: number;
  /** Whole percent of targeted plates in tolerance, or null with no targeted plate. */
  onTargetPct: number | null;
  cuisines: number;
}

/**
 * The header strip: distinct raw ingredients across the week's cook-sheet batches, targeted
 * plates in tolerance, and distinct cuisines of the planned dishes.
 */
export function weekStats(
  sheets: ReadonlyArray<{
    meals: ReadonlyArray<{
      cuisineKey: string;
      batches: ReadonlyArray<{ raw: ReadonlyArray<{ ingredientId: string; rawG: number }> }>;
    }>;
  }>,
  plateStatuses: readonly FitStatus[],
): WeekStats {
  const ingredients = new Set<string>();
  const cuisines = new Set<string>();
  for (const s of sheets)
    for (const m of s.meals) {
      cuisines.add(m.cuisineKey);
      for (const b of m.batches)
        for (const r of b.raw) if (r.rawG > 0) ingredients.add(r.ingredientId);
    }
  const targeted = plateStatuses.filter((s) => s !== "untargeted");
  const onTarget = targeted.filter((s) => s === "in_tolerance").length;
  return {
    distinctIngredients: ingredients.size,
    targeted: targeted.length,
    onTarget,
    onTargetPct: targeted.length === 0 ? null : Math.round((onTarget / targeted.length) * 100),
    cuisines: cuisines.size,
  };
}

// Recipe ratings (leaf-1.4.4 SPEC-Q-11) -----------------------------------------------------------

export interface RatingSummary {
  mean: number;
  count: number;
}

/**
 * Mean rating of a dish over reviews of the dish, its components and variants, and meals and
 * plates of the dish. `dishOf` maps a review target (type + id) to the dish it belongs to.
 */
export function ratingsByDish(
  reviews: ReadonlyArray<{
    targetType: string;
    targetId: string;
    planMealId: string | null;
    rating: number | null;
    parentReviewId: string | null;
  }>,
  dishOf: (targetType: string, targetId: string, planMealId: string | null) => string | null,
): Map<string, RatingSummary> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const r of reviews) {
    if (r.rating === null || r.parentReviewId !== null) continue;
    const dishId = dishOf(r.targetType, r.targetId, r.planMealId);
    if (dishId === null) continue;
    const s = sums.get(dishId) ?? { total: 0, count: 0 };
    s.total += r.rating;
    s.count += 1;
    sums.set(dishId, s);
  }
  return new Map(
    [...sums].map(([id, s]) => [id, { mean: round(s.total / s.count, 1), count: s.count }]),
  );
}

// The day's target (R-28, CP3 finding 1) ------------------------------------------------------------

export interface ProfileLike {
  memberId: string;
  kind: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  satFatMaxG: number | null;
  fibreMinG: number | null;
  solubleFibreMinG: number | null;
}

export interface ScheduleFacts {
  training: ReadonlyArray<{ memberId: string; weekday: number }>;
  dayOverrides: ReadonlyArray<{ memberId: string; date: string; kind: string }>;
}

/**
 * PLN-4 step 1, as the target resolver (core `dayKindOf`) decides it: a `training` override, else
 * a `rest` override, else the training schedule's weekday.
 */
export function dayKindOf(
  s: ScheduleFacts,
  memberId: string,
  date: string,
): "training" | "default" {
  const overrides = s.dayOverrides.filter((o) => o.memberId === memberId && o.date === date);
  if (overrides.some((o) => o.kind === "training")) return "training";
  if (overrides.some((o) => o.kind === "rest")) return "default";
  const wd = weekdayOf(date);
  return s.training.some((t) => t.memberId === memberId && t.weekday === wd)
    ? "training"
    : "default";
}

/**
 * The member's target profile for the day (PLN-4 step 2: the day kind's profile, else default).
 * With the schedules (admins) the day kind is resolved exactly. Without them (members may not read
 * schedules) the profile is the one nearest the day's slot targets: slot targets are the chosen
 * profile split by share, so they differ from it by rounding only, while default and training
 * profiles differ by whole meals (F1: 2150 vs 2390 kcal).
 */
export function dayProfile<P extends ProfileLike>(
  profiles: readonly P[],
  memberId: string,
  date: string,
  schedules: ScheduleFacts | null,
  slotSum: MacroValues | null,
): P | null {
  const own = profiles.filter((p) => p.memberId === memberId);
  const byKind = (kind: string) => own.find((p) => p.kind === kind);
  const fallback = byKind("default") ?? own[0] ?? null;
  if (own.length === 0) return null;
  if (schedules !== null) return byKind(dayKindOf(schedules, memberId, date)) ?? fallback;
  if (own.length === 1 || slotSum === null) return fallback;
  const distance = (p: P) =>
    Math.abs(p.kcal - slotSum.kcal) +
    Math.abs(p.proteinG - slotSum.protein) +
    Math.abs(p.carbsG - slotSum.carbs) +
    Math.abs(p.fatG - slotSum.fat);
  return [...own].sort((a, b) => distance(a) - distance(b))[0] ?? fallback;
}

/** A profile's day target as macros (carbs on the profile's own basis, total by R-28). */
export function profileMacros(p: ProfileLike): MacroValues {
  return { kcal: p.kcal, protein: p.proteinG, carbs: p.carbsG, fat: p.fatG };
}

// The day target on Plan and Plate (W-7, BLD-8 R-58/R-60) ---------------------------------------

/** A plate's slot target as far as the day target needs it. */
export interface PlateTargetLike {
  memberId: string;
  target: MacroValues | null;
}

/**
 * W-7: a member's day target for a date, from the day kind's target profile (the resolver's PLN-4
 * steps 1–2 via `dayProfile`), never the sum of the plates' targets: those are R-28 re-targeted and
 * sum to the day target only by chance (F1 Sunday: 2146 against 2150). `dayPlates` are the plates
 * of that date; without schedules they only choose between the member's profiles.
 */
export function dayTarget(
  profiles: readonly ProfileLike[],
  memberId: string,
  date: string,
  schedules: ScheduleFacts | null,
  dayPlates: readonly PlateTargetLike[],
): { kcal: number; kind: string; label: string | null } | null {
  const own = dayPlates.filter((p) => p.memberId === memberId && p.target !== null);
  const slotSum = own.length === 0 ? null : sumMacros(own.map((p) => p.target ?? macrosZero()));
  const profile = dayProfile(profiles, memberId, date, schedules, slotSum);
  if (profile === null) return null;
  // The day kind is known with the schedules (admins); otherwise only a training profile says it.
  const kind =
    schedules !== null
      ? dayKindOf(schedules, memberId, date)
      : profile.kind === "training"
        ? "training"
        : null;
  return {
    kcal: profile.kcal,
    kind: profile.kind,
    label: kind === null ? null : kind === "training" ? "training day" : "rest day",
  };
}

function macrosZero(): MacroValues {
  return { kcal: 0, protein: 0, carbs: 0, fat: 0 };
}

// Moving a meal to another day (UX-4, W-5 addendum; BLD-8 R-58, R-60; SPEC-Q-3, SPEC-Q-7) --------

/** The parts of a plan meal and day the move rules read. */
export interface MovableMeal {
  id: string;
  date: string;
  slotTypeId: string;
  memberScope: string;
  dishName: string;
  locked: boolean;
  status: string;
}
export interface MoveDay {
  date: string;
  status: string;
  meals: readonly MovableMeal[];
}

/** Why a meal cannot be moved (as the server would refuse it), or null when it can. */
export function unmovable(
  meal: MovableMeal,
  day: MoveDay | undefined,
  today: string,
): string | null {
  if (meal.date < today) return "It is in the past.";
  if (meal.locked) return "It is locked. Unlock it to move it.";
  if (meal.status !== "planned") return `It is already ${meal.status}.`;
  if (day !== undefined && day.status !== "draft")
    return "That day is already sent to the kitchen.";
  return null;
}

export interface MoveOption {
  date: string;
  /** `move` onto an empty slot, `swap` with the meal there, or `blocked` with a reason. */
  kind: "move" | "swap" | "blocked";
  occupant: string | null;
  reason: string | null;
}

/**
 * The other days of `dates` a meal can go to: same slot and member scope, from today on. A day
 * without a plan, a day sent to the kitchen, or a locked or finished meal there blocks the move.
 */
export function moveOptions(
  meal: MovableMeal,
  days: ReadonlyMap<string, MoveDay>,
  dates: readonly string[],
  today: string,
): MoveOption[] {
  return dates
    .filter((d) => d !== meal.date && d >= today)
    .map((date) => {
      const day = days.get(date);
      const blocked = (reason: string, occupant: string | null = null): MoveOption => ({
        date,
        kind: "blocked",
        occupant,
        reason,
      });
      if (day === undefined) return blocked("Not planned yet.");
      if (day.status !== "draft") return blocked("Already sent to the kitchen.");
      const there = day.meals.find(
        (m) => m.slotTypeId === meal.slotTypeId && m.memberScope === meal.memberScope,
      );
      if (there === undefined) return { date, kind: "move", occupant: null, reason: null };
      if (there.locked) return blocked(`${there.dishName} there is locked.`, there.dishName);
      if (there.status !== "planned")
        return blocked(`${there.dishName} there is already ${there.status}.`, there.dishName);
      return { date, kind: "swap", occupant: there.dishName, reason: null };
    });
}
