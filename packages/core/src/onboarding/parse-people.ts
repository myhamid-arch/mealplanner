// Question 1, "Who eats at home?": one line of names and ages (R2-ONB-1), e.g.
// "Omar 41, Sara 39, Layla 18 F" or "Layla (18, F) and Adam (15, M)".
import type { Sex } from "../types/index.js";
import { isSelfWord } from "./text.js";
import type { PersonAnswer } from "./types.js";

const SEX_WORDS: Readonly<Record<string, Sex>> = {
  f: "female",
  female: "female",
  girl: "female",
  woman: "female",
  m: "male",
  male: "male",
  boy: "male",
  man: "male",
};

const AGE_UNIT = /^(y|yo|yrs?|years?|years?old|old)$/i;

// W-10a (leaf-1.4.9 SPEC-Q-6): relation phrases around a name ("my wife Sara", "our three kids
// Layla", "Sara (my wife)") are not part of it.
const DETERMINERS: ReadonlySet<string> = new Set(["my", "our", "his", "her", "their", "the"]);
const COUNTS: ReadonlySet<string> = new Set([
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "both",
]);
const ADJECTIVES: ReadonlySet<string> = new Set([
  "little",
  "big",
  "older",
  "younger",
  "eldest",
  "oldest",
  "youngest",
  "middle",
  "teenage",
  "step",
  "grown",
  "lovely",
]);
/** Relation words (singular → plural), lower case. */
const RELATIONS: ReadonlyMap<string, string> = new Map([
  ["wife", "wives"],
  ["husband", "husbands"],
  ["partner", "partners"],
  ["spouse", "spouses"],
  ["son", "sons"],
  ["daughter", "daughters"],
  ["stepson", "stepsons"],
  ["stepdaughter", "stepdaughters"],
  ["kid", "kids"],
  ["child", "children"],
  ["stepkid", "stepkids"],
  ["stepchild", "stepchildren"],
  ["boy", "boys"],
  ["girl", "girls"],
  ["twin", "twins"],
  ["baby", "babies"],
  ["teen", "teens"],
  ["teenager", "teenagers"],
  ["mum", "mums"],
  ["mom", "moms"],
  ["mother", "mothers"],
  ["dad", "dads"],
  ["father", "fathers"],
  ["parent", "parents"],
  ["brother", "brothers"],
  ["sister", "sisters"],
  ["grandma", "grandmas"],
  ["grandpa", "grandpas"],
  ["granny", "grannies"],
  ["grandmother", "grandmothers"],
  ["grandfather", "grandfathers"],
  ["grandson", "grandsons"],
  ["granddaughter", "granddaughters"],
  ["nephew", "nephews"],
  ["niece", "nieces"],
  ["cousin", "cousins"],
  ["uncle", "uncles"],
  ["aunt", "aunts"],
  ["auntie", "aunties"],
  ["flatmate", "flatmates"],
  ["roommate", "roommates"],
  ["lodger", "lodgers"],
  ["friend", "friends"],
]);
const PLURALS: ReadonlyMap<string, string> = new Map(
  [...RELATIONS].map(([one, many]) => [many, one]),
);

type Relation = { word: string; plural: boolean } | null;

function relationOf(token: string): Relation {
  const t = token.toLowerCase().replace(/[’']s$/, "");
  if (RELATIONS.has(t)) return { word: t, plural: false };
  const one = PLURALS.get(t);
  return one === undefined ? null : { word: one, plural: true };
}

function isCount(token: string): boolean {
  return COUNTS.has(token.toLowerCase()) || /^\d{1,2}$/.test(token);
}

/**
 * Removes relation phrases from a person's words: a determiner with an optional count and
 * adjectives before relation words ("our three kids", "my stepdaughter"), wherever it stands, and
 * a bare plural relation (with an optional count: "kids", "two boys") before a name. A bare
 * singular word is kept ("Child C1", "Grandpa" are names). Returns the words left and the last
 * relation removed.
 */
function stripRelations(tokens: readonly string[]): { tokens: string[]; relation: Relation } {
  const out: string[] = [];
  let relation: Relation = null;
  for (let i = 0; i < tokens.length;) {
    let j = i;
    const first = tokens[j] ?? "";
    // "Omar's wife Sara" reads like "his wife Sara".
    const determiner =
      DETERMINERS.has(first.toLowerCase()) ||
      (/^[a-z]+[’']s$/i.test(first) && relationOf(tokens[j + 1] ?? "") !== null);
    if (determiner) j += 1;
    const counted = j < tokens.length && isCount(tokens[j] ?? "");
    if (counted) j += 1;
    while (j < tokens.length && ADJECTIVES.has((tokens[j] ?? "").toLowerCase())) j += 1;
    let found: Relation = null;
    // "twin boys" is one phrase; "kids Child C1" ends at "kids" (F1 names its children "Child …").
    while (j < tokens.length) {
      const r = relationOf(tokens[j] ?? "");
      if (r === null || (found !== null && !r.plural)) break;
      found = r;
      j += 1;
    }
    const nameFollows = tokens.slice(j).some((t) => /[a-z]/i.test(t));
    if (found !== null && (determiner || (found.plural && (counted || nameFollows)))) {
      relation = found;
      i = j;
      continue;
    }
    out.push(tokens[i] ?? "");
    i += 1;
  }
  return { tokens: out, relation };
}

function capitalised(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

export function parsePeople(text: string): PersonAnswer[] {
  const people: PersonAnswer[] = [];
  const chunks = text
    .replace(/\(([^)]*)\)/g, (_, inner: string) => ` ${inner.replace(/[,;]/g, " ")} `)
    .split(/[,;\n]+|\s+and\s+|\s+&\s+/i);
  for (const chunk of chunks) {
    const raw = chunk
      .replace(/[:=–—-]/g, " ")
      .split(/\s+/)
      .filter((t) => t !== "")
      .map((t) => t.replace(/[.]+$/, ""))
      .filter((t) => t !== "");
    const { tokens, relation } = stripRelations(raw);
    const name: string[] = [];
    let age: number | null = null;
    let sex: Sex | null = null;
    for (const bare of tokens) {
      const ageMatch = /^(\d{1,3})(y|yo|yrs?)?$/i.exec(bare);
      if (ageMatch !== null && age === null) {
        const value = Number(ageMatch[1]);
        if (value <= 120) {
          age = value;
          continue;
        }
      }
      if (age !== null && AGE_UNIT.test(bare)) continue;
      const sexWord = SEX_WORDS[bare.toLowerCase()];
      if (sexWord !== undefined && name.length > 0 && (age !== null || bare.length > 1)) {
        sex = sexWord;
        continue;
      }
      if (/[a-z]/i.test(bare)) name.push(bare);
    }
    // "Omar (me) 41": the name is Omar; "me" alone stays, for the viewer (SPEC-Q-6).
    const all = name.join(" ");
    const own = name.filter((w) => !isSelfWord(w)).join(" ");
    const display = (isSelfWord(all) || own === "" ? all : own).trim();
    const previous = people[people.length - 1];
    if (display !== "") {
      people.push({ name: display.slice(0, 80), age, sex });
    } else if (relation !== null && !relation.plural && age !== null) {
      // "my wife 39": no name given, so the relation names her.
      people.push({ name: capitalised(relation.word), age, sex });
    } else if (age !== null && previous !== undefined && previous.age === null) {
      // "Sara, my wife, 39": the age belongs to the person just named.
      previous.age = age;
      if (previous.sex === null) previous.sex = sex;
    }
  }
  return people;
}

/** R2-ONB-3: starting appetite from age (≥ 14 large, 8–13 medium, < 8 small). */
export function appetiteForAge(age: number | null): "small" | "medium" | "large" {
  if (age === null) return "medium";
  if (age >= 14) return "large";
  if (age >= 8) return "medium";
  return "small";
}

/** SPEC-Q-10: 18 and under is a child. */
export function isChild(age: number | null): boolean {
  return age !== null && age <= 18;
}
