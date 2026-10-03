// Small text helpers shared by the deterministic parsers.

/** Lower case, straight apostrophes removed, runs of whitespace collapsed. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "me", "myself", "I", "I'm": the person answering (leaf-1.4.9 SPEC-Q-6). */
export function isSelfWord(name: string): boolean {
  return SELF_WORDS.has(normalise(name));
}

const SELF_WORDS: ReadonlySet<string> = new Set(["me", "myself", "i", "im", "i am"]);

/** A crude English singular: "kidneys" → "kidney", "peaches" → "peach", "tomatoes" → "tomato". */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  // W-28: "tomatoes", "potatoes", "mangoes".
  if (word.length > 5 && word.endsWith("toes")) return word.slice(0, -2);
  if (word === "mangoes") return "mango";
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

/**
 * R-88: short display names for ingredients, lower case, once each: the name before its comma
 * ("Chicken wing, with skin" → chicken wing), unless that would read like another item's
 * ("Tomato" and "Tomatoes, canned"), when the detail stays in brackets: tomatoes (canned).
 */
export function shortNames(names: readonly string[]): string[] {
  const parts = names.map((n) => {
    const [head = n, ...rest] = n.split(",");
    return { head: head.trim().toLowerCase(), rest: rest.join(",").trim().toLowerCase() };
  });
  const count = new Map<string, number>();
  for (const p of parts) {
    const k = words(p.head).join(" ");
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return [
    ...new Set(
      parts.map((p) =>
        (count.get(words(p.head).join(" ")) ?? 0) > 1 && p.rest !== ""
          ? `${p.head} (${p.rest})`
          : p.head,
      ),
    ),
  ];
}

/** "a, b, c, d, e, f and 3 more": a list capped for one line of text. */
export function cappedList(items: readonly string[], max = 6): string {
  return items.length > max
    ? `${items.slice(0, max).join(", ")} and ${String(items.length - max)} more`
    : listJoin(items);
}
