// REC-3 generation context, pseudonymised (05 §3; ARC-10; SPEC-Q-9, SPEC-Q-13).
// Names, ages, birth years, member ids and household ids never leave this module: attendees are
// labelled "Adult A", "Child A", …, and household free text is scrubbed of member names.
import {
  attendedSlots,
  resolveSlotTargets,
  type SlotTarget,
} from "@mealplanner/core/planner/targets";
import type { MemberCtx } from "@mealplanner/core/planner/solver";
import type { ExclusionRow, HouseholdConfig, MemberRow } from "@mealplanner/core/types";

export type GenerationContext = {
  slot: {
    key: string;
    label: string;
    isPacked: boolean;
    reheat: boolean;
    constraintsNote?: string;
  };
  /** Dishes requested, default 3. */
  count: number;
  /** From household and attendee appeal, and variety. */
  cuisines: { prefer: string[]; avoidRecent: string[] };
  /** Ingredients already in the window: "prefer these". */
  palette: { slug: string; timesUsed: number }[];
  attendees: Array<{
    /** Pseudonymous, e.g. "Adult A". */
    label: string;
    targeted: boolean;
    plateTarget?: { kcal: number; protein: number; carbs: number; fat: number };
    likes: string[];
    dislikes: string[];
  }>;
  /** Union over attendees, hard. */
  exclusions: { ingredients: string[]; categories: string[]; dietaryFlags: string[] };
  /** Names of existing similar or recent dishes. */
  avoidDishes: string[];
  /** Free text when the admin asked in chat. */
  adminRequest?: string;
  locale: { country: "AE"; regionNote?: string };
};

/** A targeted attendee's plate problem for the REC-5 step 7 solve (never sent to the model). */
export type SolveTarget = { label: string; target: SlotTarget; member: MemberCtx };

export type GenerationContextInput = {
  config: HouseholdConfig;
  /** ISO date of the meal. */
  date: string;
  slotKey: string;
  count?: number;
  palette?: { slug: string; timesUsed: number }[];
  avoidRecentCuisines?: string[];
  avoidDishes?: string[];
  adminRequest?: string;
};

export const DEFAULT_DISH_COUNT = 3;
/** Preference scores at or beyond ±0.5 are sent as likes and dislikes (SPEC-Q-9). */
export const PREFERENCE_THRESHOLD = 0.5;
/** Age from which a member is labelled an adult. */
export const ADULT_AGE = 18;

const SENT_PREFERENCE_TYPES = new Set(["ingredient", "cuisine", "method"]);

export class GenerationContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationContextError";
  }
}

function letter(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function isAdult(member: MemberRow, date: string): boolean {
  if (member.birthYear === null) return true;
  return Number(date.slice(0, 4)) - member.birthYear >= ADULT_AGE;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces e-mail addresses with "[email]", then every member's display name (and each word of it
 * of 3+ letters) in household free text with the member's pseudonymous label, or "a family member"
 * for a member not at this meal.
 */
export function scrubNames(text: string, names: ReadonlyMap<string, string>): string {
  // Each whole name maps to its member's label; each word of 3+ letters too, unless several
  // members share it (a family name), in which case it becomes "[family name]".
  const whole = new Map<string, string>();
  const words = new Map<string, Set<string>>();
  for (const [name, label] of names) {
    const trimmed = name.trim();
    if (trimmed === "") continue;
    whole.set(trimmed.toLowerCase(), label);
    for (const word of trimmed.split(/\s+/)) {
      if (word.length < 3) continue;
      const key = word.toLowerCase();
      if (!words.has(key)) words.set(key, new Set());
      words.get(key)?.add(label === "a family member" ? `other:${name}` : label);
    }
  }
  const replacement = new Map<string, string>(whole);
  for (const [word, labels] of words) {
    if (whole.has(word)) continue;
    const [first = ""] = labels;
    replacement.set(
      word,
      labels.size > 1 ? "[family name]" : first.startsWith("other:") ? "a family member" : first,
    );
  }
  // E-mail addresses first, so a name inside one does not leave the rest behind.
  const out = text.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, "[email]");
  if (replacement.size === 0) return out;
  // One pass, longest term first ("Omar Haddad" before "Omar"), so inserted labels are not rescanned.
  const alternatives = [...replacement.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return out.replace(
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "giu"),
    (match) => replacement.get(match.toLowerCase()) ?? match,
  );
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Builds the REC-3 context for one date and slot, and the targeted attendees' solver inputs.
 * Attendance and targets come from the 1.2.2 resolver (SPEC-Q-13).
 */
export function buildGenerationContext(input: GenerationContextInput): {
  context: GenerationContext;
  solveTargets: SolveTarget[];
} {
  const { config, date, slotKey } = input;
  const slot = config.slotTypes.find((s) => s.key === slotKey && s.active);
  if (slot === undefined) throw new GenerationContextError(`no active slot "${slotKey}"`);

  const members = config.members.filter((m) => m.archivedAt === null);
  const attending = members.filter((m) =>
    attendedSlots(config, m.id, date).slots.some((s) => s.id === slot.id),
  );
  if (attending.length === 0)
    throw new GenerationContextError(`nobody attends "${slotKey}" on ${date}`);

  // Labels in configuration order, adults and children lettered separately.
  const labels = new Map<string, string>();
  let adults = 0;
  let children = 0;
  for (const m of attending) {
    labels.set(
      m.id,
      isAdult(m, date) ? `Adult ${letter(adults++)}` : `Child ${letter(children++)}`,
    );
  }
  const nameToLabel = new Map<string, string>();
  for (const m of members) nameToLabel.set(m.displayName, labels.get(m.id) ?? "a family member");
  const scrub = (text: string) => scrubNames(text, nameToLabel);

  const targets = resolveSlotTargets(config, date).filter((t) => t.slotTypeId === slot.id);
  const attendingIds = new Set(attending.map((m) => m.id));
  const hardExclusions = config.exclusions.filter(
    (e) => e.hard && (e.memberId === null || attendingIds.has(e.memberId)),
  );
  const exclusionsOf = (rows: ExclusionRow[]) => ({
    ingredients: sortedUnique(rows.filter((e) => e.kind === "ingredient").map((e) => e.key)),
    categories: sortedUnique(rows.filter((e) => e.kind === "category").map((e) => e.key)),
    dietaryFlags: sortedUnique(rows.filter((e) => e.kind === "dietary_flag").map((e) => e.key)),
  });

  const preferencesOf = (memberId: string | null) =>
    config.preferences.filter(
      (p) => p.memberId === memberId && SENT_PREFERENCE_TYPES.has(p.entityType),
    );
  const ranked = (rows: typeof config.preferences, liked: boolean) =>
    rows
      .filter((p) => (liked ? p.score >= PREFERENCE_THRESHOLD : p.score <= -PREFERENCE_THRESHOLD))
      .sort(
        (a, b) =>
          (liked ? b.score - a.score : a.score - b.score) ||
          `${a.entityType}:${a.entityKey}`.localeCompare(`${b.entityType}:${b.entityKey}`),
      )
      .map((p) => `${p.entityType}:${p.entityKey}`);

  const attendees: GenerationContext["attendees"] = [];
  const solveTargets: SolveTarget[] = [];
  for (const m of attending) {
    const label = labels.get(m.id) ?? "";
    const own = preferencesOf(m.id);
    const target = m.isTargeted ? targets.find((t) => t.memberId === m.id) : undefined;
    attendees.push({
      label,
      targeted: target !== undefined,
      ...(target === undefined
        ? {}
        : {
            plateTarget: {
              kcal: target.kcal,
              protein: target.protein,
              carbs: target.carbs,
              fat: target.fat,
            },
          }),
      likes: ranked(own, true),
      dislikes: ranked(own, false),
    });
    if (target !== undefined) {
      solveTargets.push({
        label,
        // The solver sees the label, never the member id (its explanations reach the model).
        target: { ...target, memberId: label },
        member: {
          memberId: label,
          appetite: m.appetite,
          roleBias: {},
          variantAppeal: {},
          dishAppeal: {},
          exclusions: (() => {
            const x = exclusionsOf(
              hardExclusions.filter((e) => e.memberId === null || e.memberId === m.id),
            );
            return {
              ingredientIds: x.ingredients,
              categories: x.categories,
              dietaryFlags: x.dietaryFlags,
            };
          })(),
          slot: { key: slot.key, isPacked: slot.isPacked, reheatAvailable: slot.reheatAvailable },
        },
      });
    }
  }

  // Cuisines: household likes first, then attendees' liked cuisines, by score.
  const cuisineScores = new Map<string, number>();
  for (const p of config.preferences) {
    if (p.entityType !== "cuisine" || p.score <= 0) continue;
    if (p.memberId !== null && !attendingIds.has(p.memberId)) continue;
    const bonus = p.memberId === null ? 1 : 0;
    cuisineScores.set(
      p.entityKey,
      Math.max(cuisineScores.get(p.entityKey) ?? -Infinity, p.score + bonus),
    );
  }
  const prefer = [...cuisineScores]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);

  const count = input.count ?? DEFAULT_DISH_COUNT;
  if (!(Number.isInteger(count) && count >= 1))
    throw new GenerationContextError(`count must be a positive integer (got ${String(count)})`);

  const note = slot.constraintsNote === null ? undefined : scrub(slot.constraintsNote);
  const regionNote = config.household.regionNote;
  const context: GenerationContext = {
    slot: {
      key: slot.key,
      label: scrub(slot.label),
      isPacked: slot.isPacked,
      reheat: slot.reheatAvailable,
      ...(note === undefined ? {} : { constraintsNote: note }),
    },
    count,
    cuisines: { prefer, avoidRecent: sortedUnique(input.avoidRecentCuisines ?? []) },
    palette: [...(input.palette ?? [])].sort(
      (a, b) => b.timesUsed - a.timesUsed || a.slug.localeCompare(b.slug),
    ),
    attendees,
    exclusions: exclusionsOf(hardExclusions),
    avoidDishes: (input.avoidDishes ?? []).map(scrub),
    ...(input.adminRequest === undefined ? {} : { adminRequest: scrub(input.adminRequest) }),
    locale: {
      country: "AE",
      ...(regionNote === null ? {} : { regionNote: scrub(regionNote) }),
    },
  };
  return { context, solveTargets };
}
