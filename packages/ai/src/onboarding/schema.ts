// Structured-output schemas of the onboarding free-text parse (R2-ONB-3; leaf-1.4.7 SPEC-Q-3) and the
// semantic checks the deterministic parsers of @mealplanner/core/onboarding apply. A model answer
// that fails either is refused, never repaired: the page then keeps the deterministic parse.
import { z } from "zod";
import { EXCLUSION_REASONS, SEXES } from "@mealplanner/core/types";
import type {
  DayTargets,
  NeverEatItem,
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

export const NeverEatOutputSchema = z.object({
  rules: z.array(
    z.object({
      who: z.string(),
      term: z.string(),
      reason: z.enum(EXCLUSION_REASONS),
    }),
  ),
});

export type PeopleOutput = z.output<typeof PeopleOutputSchema>;
export type TargetsOutput = z.output<typeof TargetsOutputSchema>;
export type NeverEatOutput = z.output<typeof NeverEatOutputSchema>;

export type ParsedValue =
  | { field: "people"; people: PersonAnswer[] }
  | { field: "targets"; targets: TargetParse }
  | { field: "never_eat"; neverEat: NeverEatItem[] };

export type Checked = { ok: true; value: ParsedValue } | { ok: false; issues: string[] };

// The limits of the deterministic parsers (parse-people.ts, parse-targets.ts).
const MAX_AGE = 120;
const MAX_NAME = 80;
const MIN_KCAL = 800;
const MAX_KCAL = 6000;
const MAX_MACRO_G = 800;
const MAX_PEOPLE = 20;
const MAX_RULES = 40;
const MAX_TERM = 80;
/** Stated calories must agree with 4P + 4C + 9F within this share (a swapped number fails it). */
export const ENERGY_AGREEMENT = 0.12;

function checkPeople(out: PeopleOutput): Checked {
  const issues: string[] = [];
  if (out.people.length === 0) issues.push("no people");
  if (out.people.length > MAX_PEOPLE) issues.push(`${String(out.people.length)} people (at most ${String(MAX_PEOPLE)})`);
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
    issues.push(`${label}: ${String(d.kcal)} kcal is outside ${String(MIN_KCAL)}–${String(MAX_KCAL)}`);
  for (const [name, g] of [
    ["protein", d.proteinG],
    ["carbs", d.carbsG],
    ["fat", d.fatG],
  ] as const)
    if (g < 0 || g > MAX_MACRO_G) issues.push(`${label}: ${String(g)} g of ${name} is outside 0–${String(MAX_MACRO_G)} g`);
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
    if (v !== null && (v < 0 || v > 10_000)) issues.push(`${label}: ${name} ${String(v)} is out of range`);
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
    if (out.training !== null) return { ok: false, issues: ["training-day numbers without daily numbers"] };
    const reason = out.problem?.trim();
    return {
      ok: true,
      value: {
        field: "targets",
        targets: { ok: false, reason: reason === undefined || reason === "" ? "No numbers found." : reason.slice(0, 200) },
      },
    };
  }
  const issues: string[] = [];
  const day = checkDay("daily", out.day, issues);
  const training = out.training === null ? undefined : checkDay("training days", out.training, issues);
  if (issues.length > 0) return { ok: false, issues };
  const value: TargetNumbers = training === undefined ? day : { ...day, training };
  return { ok: true, value: { field: "targets", targets: { ok: true, value } } };
}

function checkNeverEat(out: NeverEatOutput, people: readonly string[]): Checked {
  const issues: string[] = [];
  if (out.rules.length > MAX_RULES) issues.push(`${String(out.rules.length)} rules (at most ${String(MAX_RULES)})`);
  const names = new Map(people.map((p) => [p.trim().toLowerCase(), p.trim()]));
  const rules: NeverEatItem[] = [];
  for (const r of out.rules) {
    const who = r.who.trim();
    const term = r.term.trim().toLowerCase();
    const person = who.toLowerCase() === "everyone" ? "everyone" : names.get(who.toLowerCase());
    if (person === undefined) issues.push(`"${who}" is not one of the people named`);
    if (term === "" || term.length > MAX_TERM) issues.push(`food "${r.term}" is empty or too long`);
    if (person !== undefined) rules.push({ who: person, term, reason: r.reason });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { field: "never_eat", neverEat: rules } };
}

/** The semantic checks of one field's output (schema checks already passed). */
export function checkOutput(
  field: OnboardingField,
  output: unknown,
  people: readonly string[] = [],
): Checked {
  switch (field) {
    case "people":
      return checkPeople(output as PeopleOutput);
    case "targets":
      return checkTargets(output as TargetsOutput);
    case "never_eat":
      return checkNeverEat(output as NeverEatOutput, people);
  }
}
