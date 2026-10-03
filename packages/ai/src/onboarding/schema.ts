// Structured-output schemas of the onboarding free-text parse (R2-ONB-3; leaf-1.4.7 SPEC-Q-3) and the
// semantic checks the deterministic parsers of @mealplanner/core/onboarding apply. A model answer
// that fails either is refused, never repaired: the page then keeps the deterministic parse.
import { z } from "zod";
import {
  DIETARY_FLAGS,
  EXCLUSION_REASONS,
  INGREDIENT_CATEGORIES,
  SEXES,
} from "@mealplanner/core/types";
import type {
  DayTargets,
  NeverEatItem,
  NeverEatQuestion,
  PersonAnswer,
  TargetNumbers,
  TargetParse,
} from "@mealplanner/core/onboarding";

export const ONBOARDING_FIELDS = ["people", "targets", "never_eat"] as const;
export type OnboardingField = (typeof ONBOARDING_FIELDS)[number];

/** Longest free-text answer sent to the model. */
export const MAX_TEXT = 2000;

export const PeopleOutputSchema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      age: z.number().int().nullable(),
      sex: z.enum(SEXES).nullable(),
    }),
  ),
});

const DaySchema = z.object({
  kcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  satFatMaxG: z.number().nullable(),
  solubleFibreMinG: z.number().nullable(),
  fibreMinG: z.number().nullable(),
  sodiumMaxMg: z.number().nullable(),
});

export const TargetsOutputSchema = z.object({
  /** Null when the text gives no daily numbers; `problem` then says what is missing. */
  day: DaySchema.nullable(),
  /** Only when the text names training-day numbers. */
  training: DaySchema.nullable(),
  problem: z.string().nullable(),
});

/**
 * R-88: one never-eat rule mapped onto the catalogue. Exactly one of `flag`, `categories` or
 * `slugs` says what it covers; the checks below hold it to the catalogue.
 */
const NeverEatRuleSchema = z.object({
  who: z.string(),
  /** The words the rule comes from, as typed. */
  said: z.string(),
  reason: z.enum(EXCLUSION_REASONS),
  flag: z.enum(DIETARY_FLAGS).nullable(),
  categories: z.array(z.enum(INGREDIENT_CATEGORIES)),
  slugs: z.array(z.string()),
  /** What stays allowed, in a few words ("boneless breast and mince"), or "". */
  keeps: z.string(),
});

export const NeverEatOutputSchema = z.object({
  rules: z.array(NeverEatRuleSchema),
  /** Asked only when a reading changes what is planned and the text does not settle it. */
  questions: z.array(
    z.object({
      who: z.string(),
      said: z.string(),
      question: z.string(),
      options: z.array(z.object({ label: z.string(), rules: z.array(NeverEatRuleSchema) })),
    }),
  ),
  /** Words that name no food the catalogue has, with why, in plain words. */
  unclear: z.array(z.object({ who: z.string(), said: z.string(), why: z.string() })),
});

/** R-88: the catalogue rows the never-eat reading maps onto and is checked against. */
export interface CatalogueRow {
  slug: string;
  name: string;
  category: string;
  dietaryFlags: readonly string[];
}

export type PeopleOutput = z.output<typeof PeopleOutputSchema>;
export type TargetsOutput = z.output<typeof TargetsOutputSchema>;
export type NeverEatOutput = z.output<typeof NeverEatOutputSchema>;

export type ParsedValue =
  | { field: "people"; people: PersonAnswer[] }
  | { field: "targets"; targets: TargetParse }
  | {
      field: "never_eat";
      neverEat: NeverEatItem[];
      questions: NeverEatQuestion[];
      unclear: { who: string; said: string; why: string }[];
    };

export type Checked = { ok: true; value: ParsedValue } | { ok: false; issues: string[] };

// The limits of the deterministic parsers (parse-people.ts, parse-targets.ts).
const MAX_AGE = 120;
const MAX_NAME = 80;
const MIN_KCAL = 800;
const MAX_KCAL = 6000;
const MAX_MACRO_G = 800;
const MAX_PEOPLE = 20;
const MAX_RULES = 40;
const MAX_TERM = 200;
const MAX_TEXT_FIELD = 300;
const MAX_KEEPS = 120;
/** Per statement (R-88): one question per assumption, so a statement rarely needs more. */
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
/** Stated calories must agree with 4P + 4C + 9F within this share (a swapped number fails it). */
export const ENERGY_AGREEMENT = 0.12;

function checkPeople(out: PeopleOutput): Checked {
  const issues: string[] = [];
  if (out.people.length === 0) issues.push("no people");
  if (out.people.length > MAX_PEOPLE)
    issues.push(`${String(out.people.length)} people (at most ${String(MAX_PEOPLE)})`);
  const seen = new Set<string>();
  for (const p of out.people) {
    const name = p.name.trim();
    if (name === "" || name.length > MAX_NAME) issues.push(`name "${p.name}" is empty or too long`);
    const key = name.toLowerCase();
    if (seen.has(key)) issues.push(`"${name}" appears twice`);
    seen.add(key);
    if (p.age !== null && (p.age < 0 || p.age > MAX_AGE))
      issues.push(`${name}: age ${String(p.age)} is outside 0–${String(MAX_AGE)}`);
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      field: "people",
      people: out.people.map((p) => ({
        name: p.name.trim(),
        age: p.age,
        // "unspecified" is what the deterministic parse leaves as null.
        sex: p.sex === "unspecified" ? null : p.sex,
      })),
    },
  };
}

function checkDay(label: string, d: z.output<typeof DaySchema>, issues: string[]): DayTargets {
  if (d.kcal < MIN_KCAL || d.kcal > MAX_KCAL)
    issues.push(
      `${label}: ${String(d.kcal)} kcal is outside ${String(MIN_KCAL)}–${String(MAX_KCAL)}`,
    );
  for (const [name, g] of [
    ["protein", d.proteinG],
    ["carbs", d.carbsG],
    ["fat", d.fatG],
  ] as const)
    if (g < 0 || g > MAX_MACRO_G)
      issues.push(`${label}: ${String(g)} g of ${name} is outside 0–${String(MAX_MACRO_G)} g`);
  const fromMacros = 4 * d.proteinG + 4 * d.carbsG + 9 * d.fatG;
  if (Math.abs(fromMacros - d.kcal) > ENERGY_AGREEMENT * d.kcal)
    issues.push(
      `${label}: ${String(d.kcal)} kcal disagrees with its macros (${String(Math.round(fromMacros))} kcal)`,
    );
  for (const [name, v] of [
    ["sat fat", d.satFatMaxG],
    ["soluble fibre", d.solubleFibreMinG],
    ["fibre", d.fibreMinG],
    ["sodium", d.sodiumMaxMg],
  ] as const)
    if (v !== null && (v < 0 || v > 10_000))
      issues.push(`${label}: ${name} ${String(v)} is out of range`);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    kcal: Math.round(d.kcal),
    proteinG: round(d.proteinG),
    carbsG: round(d.carbsG),
    fatG: round(d.fatG),
    ...(d.satFatMaxG === null ? {} : { satFatMaxG: round(d.satFatMaxG) }),
    ...(d.solubleFibreMinG === null ? {} : { solubleFibreMinG: round(d.solubleFibreMinG) }),
    ...(d.fibreMinG === null ? {} : { fibreMinG: round(d.fibreMinG) }),
    ...(d.sodiumMaxMg === null ? {} : { sodiumMaxMg: Math.round(d.sodiumMaxMg) }),
  };
}

function checkTargets(out: TargetsOutput): Checked {
  if (out.day === null) {
    if (out.training !== null)
      return { ok: false, issues: ["training-day numbers without daily numbers"] };
    const reason = out.problem?.trim();
    return {
      ok: true,
      value: {
        field: "targets",
        targets: {
          ok: false,
          reason:
            reason === undefined || reason === "" ? "No numbers found." : reason.slice(0, 200),
        },
      },
    };
  }
  const issues: string[] = [];
  const day = checkDay("daily", out.day, issues);
  const training =
    out.training === null ? undefined : checkDay("training days", out.training, issues);
  if (issues.length > 0) return { ok: false, issues };
  const value: TargetNumbers = training === undefined ? day : { ...day, training };
  return { ok: true, value: { field: "targets", targets: { ok: true, value } } };
}

type NeverEatRule = z.output<typeof NeverEatRuleSchema>;

/** What a set of rules plans: who, why and which flag, categories or slugs, order-free. */
function planKey(items: readonly NeverEatItem[]): string {
  return JSON.stringify(
    items
      .map(
        (i) =>
          `${i.who}|${i.reason}|${i.target?.kind ?? ""}|${[...(i.target?.keys ?? [])].sort().join(",")}`,
      )
      .sort(),
  );
}

function checkNeverEat(
  out: NeverEatOutput,
  people: readonly string[],
  catalogue: readonly CatalogueRow[],
): Checked {
  const issues: string[] = [];
  const names = new Map(people.map((p) => [p.trim().toLowerCase(), p.trim()]));
  const slugs = new Set(catalogue.map((r) => r.slug));
  const categories = new Set(catalogue.map((r) => r.category));
  const whoOf = (who: string): string | undefined => {
    const w = who.trim();
    const person = w.toLowerCase() === "everyone" ? "everyone" : names.get(w.toLowerCase());
    if (person === undefined) issues.push(`"${w}" is not one of the people named`);
    return person;
  };
  const text = (label: string, value: string, max: number) => {
    const v = value.trim();
    if (v === "" || v.length > max) issues.push(`${label} "${value}" is empty or too long`);
    return v;
  };
  const item = (r: NeverEatRule): NeverEatItem | null => {
    const who = whoOf(r.who);
    const said = text("food", r.said, MAX_TERM).toLowerCase();
    const keeps = r.keeps.trim();
    if (keeps.length > MAX_KEEPS) issues.push(`"${r.said}": what stays is too long`);
    const kinds = [r.flag !== null, r.categories.length > 0, r.slugs.length > 0].filter(Boolean);
    if (kinds.length !== 1)
      issues.push(`"${r.said}": exactly one of flag, categories or ingredients must be given`);
    for (const slug of r.slugs)
      if (!slugs.has(slug)) issues.push(`"${r.said}": "${slug}" is not in the catalogue`);
    for (const category of r.categories)
      if (!categories.has(category))
        issues.push(`"${r.said}": no catalogue ingredient is in category "${category}"`);
    if (who === undefined || kinds.length !== 1) return null;
    const target: NeverEatItem["target"] =
      r.flag !== null
        ? { kind: "dietary_flag", keys: [r.flag] }
        : r.categories.length > 0
          ? { kind: "category", keys: [...new Set(r.categories)] }
          : { kind: "ingredient", keys: [...new Set(r.slugs)] };
    return { who, term: said, reason: r.reason, target, ...(keeps === "" ? {} : { keeps }) };
  };
  if (out.rules.length > MAX_RULES)
    issues.push(`${String(out.rules.length)} rules (at most ${String(MAX_RULES)})`);
  if (out.questions.length > MAX_QUESTIONS)
    issues.push(`${String(out.questions.length)} questions (at most ${String(MAX_QUESTIONS)})`);
  const rules = out.rules.map(item).filter((r): r is NeverEatItem => r !== null);
  const questions: NeverEatQuestion[] = [];
  for (const q of out.questions) {
    if (q.options.length < 2 || q.options.length > MAX_OPTIONS)
      issues.push(`question "${q.question}" has ${String(q.options.length)} options (2–4)`);
    // R-88: options that would plan the same are one option (the first label is kept); a question
    // whose options all plan the same is no question, and its rules simply apply.
    const options: NeverEatQuestion["options"] = [];
    const seen = new Set<string>();
    for (const o of q.options) {
      const items = o.rules.map(item).filter((r): r is NeverEatItem => r !== null);
      const plan = planKey(items);
      if (seen.has(plan)) continue;
      seen.add(plan);
      options.push({ label: text("option", o.label, MAX_TERM), items });
    }
    if (options.length === 1) {
      rules.push(...(options[0]?.items ?? []));
      continue;
    }
    questions.push({
      who: whoOf(q.who) ?? q.who,
      said: text("question about", q.said, MAX_TERM),
      question: text("question", q.question, MAX_TEXT_FIELD),
      options,
    });
  }
  const unclear = out.unclear.map((u) => ({
    who: whoOf(u.who) ?? u.who,
    said: text("unclear words", u.said, MAX_TERM),
    why: text("why", u.why, MAX_TEXT_FIELD),
  }));
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { field: "never_eat", neverEat: rules, questions, unclear } };
}

/** The semantic checks of one field's output (schema checks already passed). */
export function checkOutput(
  field: OnboardingField,
  output: unknown,
  people: readonly string[] = [],
  catalogue: readonly CatalogueRow[] = [],
): Checked {
  switch (field) {
    case "people":
      return checkPeople(output as PeopleOutput);
    case "targets":
      return checkTargets(output as TargetsOutput);
    case "never_eat":
      return checkNeverEat(output as NeverEatOutput, people, catalogue);
  }
}
