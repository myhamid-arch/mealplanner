// Small text helpers shared by the deterministic parsers.

/** Lower case, straight apostrophes removed, runs of whitespace collapsed. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A crude English singular: "kidneys" → "kidney", "peaches" → "peach", "eggs" → "egg". */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Words of a phrase, singularised, for comparisons. */
export function words(text: string): string[] {
  return normalise(text)
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "")
    .map(singular);
}

export function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** "a, b and c". */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Mon–Fri" for a run of three or more days, else "Mon, Wed, Fri". Weekdays 0 = Monday. */
export function weekdayText(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "every day";
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (
    first !== undefined &&
    last !== undefined &&
    sorted.length >= 3 &&
    last - first === sorted.length - 1
  )
    return `${WEEKDAY_SHORT[first] ?? ""}–${WEEKDAY_SHORT[last] ?? ""}`;
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}
