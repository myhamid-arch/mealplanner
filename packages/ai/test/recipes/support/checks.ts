// Pure checkers for G2 (cache stability, pseudonymisation). Each returns a list of problems, so
// the tests and the verify script can also run them on known-bad input (negative controls).
import type { HouseholdConfig } from "@mealplanner/core/types";
import type { RecordedRequest } from "./recorded.js";

/** REC-3's GenerationContext keys, by path; anything else in the sent context is a problem. */
export const REC3_KEYS: Readonly<Record<string, readonly string[]>> = {
  "": [
    "slot",
    "count",
    "cuisines",
    "palette",
    "attendees",
    "exclusions",
    "avoidDishes",
    "adminRequest",
    "locale",
  ],
  slot: ["key", "label", "isPacked", "reheat", "constraintsNote"],
  cuisines: ["prefer", "avoidRecent"],
  "palette[]": ["slug", "timesUsed"],
  "attendees[]": ["label", "targeted", "plateTarget", "likes", "dislikes"],
  "attendees[].plateTarget": ["kcal", "protein", "carbs", "fat"],
  exclusions: ["ingredients", "categories", "dietaryFlags"],
  locale: ["country", "regionNote"],
};

/** Keys of `value` not allowed by REC3_KEYS. */
export function unexpectedKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => unexpectedKeys(v, `${path}[]`));
  if (value === null || typeof value !== "object") return [];
  const allowed = REC3_KEYS[path];
  const problems: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (allowed === undefined || !allowed.includes(key))
      problems.push(`unexpected key ${childPath}`);
    else if (child !== null && typeof child === "object")
      problems.push(...unexpectedKeys(child, childPath));
  }
  return problems;
}

/** The JSON context embedded in the first user message. */
export function sentContext(request: RecordedRequest): unknown {
  const messages = request.body.messages as Array<{ role: string; content: unknown }>;
  const first = messages[0];
  if (typeof first?.content !== "string") throw new Error("first message is not text");
  const at = first.content.indexOf("Context (JSON):\n");
  if (at < 0) throw new Error("no context in the first message");
  return JSON.parse(first.content.slice(at + "Context (JSON):\n".length));
}

export type PersonalData = { label: string; value: string }[];

/** Every personal value a household config holds that must not reach the model. */
export function personalData(
  config: HouseholdConfig,
  emails: readonly string[] = [],
): PersonalData {
  const out: PersonalData = [];
  out.push({ label: "household id", value: config.household.id });
  out.push({ label: "household name", value: config.household.name });
  for (const m of config.members) {
    out.push({ label: "member id", value: m.id });
    out.push({ label: "member name", value: m.displayName });
    for (const word of m.displayName.split(/\s+/))
      if (word.length >= 3) out.push({ label: "member name word", value: word });
    if (m.birthYear !== null) out.push({ label: "birth year", value: String(m.birthYear) });
  }
  for (const e of emails) out.push({ label: "email", value: e });
  return out;
}

/** Personal values found (case-insensitive, as whole words) in the raw request body. */
export function findLeaks(raw: string, data: PersonalData): string[] {
  const lower = raw.toLowerCase();
  const leaks: string[] = [];
  for (const { label, value } of data) {
    const v = value.toLowerCase();
    let at = lower.indexOf(v);
    while (at >= 0) {
      const before = lower[at - 1] ?? " ";
      const after = lower[at + v.length] ?? " ";
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
        leaks.push(`${label} "${value}"`);
        break;
      }
      at = lower.indexOf(v, at + 1);
    }
  }
  return leaks;
}

/** Ages (on `date`) that appear as a number in the context outside plate targets and counts. */
export function ageLeaks(context: unknown, config: HouseholdConfig, date: string): string[] {
  const ages = new Set(
    config.members
      .filter((m) => m.birthYear !== null)
      .map((m) => Number(date.slice(0, 4)) - (m.birthYear ?? 0)),
  );
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (path.endsWith("plateTarget") || path.endsWith("timesUsed") || path === "count") return;
    if (typeof value === "number" && ages.has(value)) found.push(`${path} = ${String(value)}`);
    if (typeof value === "string")
      for (const m of value.matchAll(/\d+/g))
        if (ages.has(Number(m[0]))) found.push(`${path} contains ${m[0]}`);
    if (Array.isArray(value))
      value.forEach((v, i) => {
        walk(v, `${path}[${String(i)}]`);
      });
    else if (value !== null && typeof value === "object")
      for (const [k, v] of Object.entries(value)) walk(v, path === "" ? k : `${path}.${k}`);
  };
  walk(context, "");
  return found;
}

/**
 * Cache stability across requests: identical system blocks (byte for byte in the sent body),
 * each with an ephemeral cache breakpoint, and none of the volatile context inside them.
 */
export function systemStabilityProblems(requests: readonly RecordedRequest[]): string[] {
  const problems: string[] = [];
  const systems = requests.map((r) => JSON.stringify(r.body.system));
  const [first] = systems;
  if (first === undefined) return ["no requests"];
  systems.forEach((s, i) => {
    if (s !== first) problems.push(`request ${String(i)}: system blocks differ from request 0`);
  });
  requests.forEach((r, i) => {
    const blocks = r.body.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    if (!Array.isArray(blocks) || blocks.length !== 2)
      problems.push(`request ${String(i)}: expected 2 system blocks`);
    else
      blocks.forEach((b, j) => {
        if (JSON.stringify(b.cache_control) !== JSON.stringify({ type: "ephemeral" }))
          problems.push(
            `request ${String(i)}: system block ${String(j)} has no ephemeral cache_control`,
          );
      });
    // The system blocks must also appear verbatim in the raw body (no re-serialisation drift).
    for (const b of blocks)
      if (!r.raw.includes(JSON.stringify(b.text)))
        problems.push(`request ${String(i)}: raw body lacks a system block`);
    const text = blocks.map((b) => b.text).join("\n");
    const context = JSON.stringify(sentContext(r));
    for (const volatile of [/\b\d{4}-\d{2}-\d{2}\b/, /\b(Adult|Child) [A-Z]\b/, /"attendees"/])
      if (volatile.test(text))
        problems.push(
          `request ${String(i)}: system text holds volatile content ${String(volatile)}`,
        );
    if (context.length > 0 && text.includes(context))
      problems.push(`request ${String(i)}: context inside system`);
  });
  return problems;
}

/** The catalogue block lists every ingredient once, sorted by slug. */
export function catalogueOrderProblems(catalogueText: string, slugs: readonly string[]): string[] {
  const lines = catalogueText.split("\n").filter((l) => /^[a-z0-9][a-z0-9_-]* \| /.test(l));
  const listed = lines.map((l) => l.split(" | ")[0] ?? "");
  const problems: string[] = [];
  const sorted = [...listed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (listed.join(",") !== sorted.join(","))
    problems.push("catalogue lines are not sorted by slug");
  if (new Set(listed).size !== listed.length) problems.push("a slug is listed twice");
  const missing = slugs.filter((s) => !listed.includes(s));
  if (listed.length !== slugs.length)
    problems.push(`${String(listed.length)} lines for ${String(slugs.length)} ingredients`);
  if (missing.length > 0) problems.push(`missing slugs: ${missing.slice(0, 5).join(", ")}`);
  return problems;
}
