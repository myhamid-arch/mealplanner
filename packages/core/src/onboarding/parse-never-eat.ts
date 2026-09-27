// Question 5, "Anything anyone must never eat?": plain sentences (R2-ONB-1), e.g.
// "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver."
// Each sentence gives who (a name from question 1, or everyone), why, and one or more foods.
import type { ExclusionReason } from "../types/index.js";
import type { NeverEatItem } from "./types.js";
import { normalise } from "./text.js";

const REASONS: readonly (readonly [RegExp, ExclusionReason])[] = [
  [/\ballerg|\banaphyla|\bepipen/, "allergy"],
  [/\breligio|\bhalal\b|\bharam\b|\bkosher\b|\bfaith\b/, "religious"],
  [
    /\bmedical|\bdoctor|\bcoeliac|\bceliac|\bintoleran|\bdiabet|\bgout\b|\bkidney disease/,
    "medical",
  ],
  [
    /\bhates?\b|\bdislikes?\b|\bcan ?t stand\b|\bdoesn ?t like\b|\bdon ?t like\b|\bnot keen\b|\bwon ?t eat\b|\brefuses?\b/,
    "dislike",
  ],
];

const EVERYONE =
  /\b(everyone|everybody|anyone|anybody|all of us|the family|whole family|household|nobody|no one|none of us|for all|we all|we don ?t)\b/;

/** Words that carry no food meaning in these sentences. */
const FILLER = new Set(
  (
    "a an the is are am be to of for in on at with without any anything anyone anybody everyone " +
    "everybody nobody one none us we our all family household whole and or also too no not never " +
    "must should eat eats eating have has having can cant cannot doesnt dont wont will please " +
    "strictly because due its it they them he she his her their allergic allergy allergies " +
    "severe severely mild religious reasons reason halal haram kosher faith medical doctor " +
    "hate hates dislike dislikes stand like likes keen refuse refuses intolerant intolerance " +
    "including include includes contain contains containing made from food foods things " +
    "stuff dishes dish meals meal ever at all just only really very very much very"
  ).split(" "),
);

/** Splits a sentence into food phrases on separators and filler words. */
function foodPhrases(sentence: string, names: readonly string[]): string[] {
  let text = ` ${sentence} `;
  for (const name of names) text = text.replace(new RegExp(`\\b${escape(name)}\\b`, "g"), " , ");
  text = text.replace(EVERYONE, " , ");
  const phrases: string[] = [];
  let current: string[] = [];
  for (const token of text.split(/(\s+|[,/&+()])/)) {
    const t = token.trim();
    if (t === "") continue;
    const bare = t.replace(/[^a-z0-9-]/g, "");
    if (bare === "" || FILLER.has(bare)) {
      if (current.length > 0) phrases.push(current.join(" "));
      current = [];
    } else {
      current.push(bare);
    }
  }
  if (current.length > 0) phrases.push(current.join(" "));
  return phrases;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Which people a sentence names: full names, or a first name when only one person has it. */
function namedPeople(
  sentence: string,
  people: readonly string[],
): { person: string; alias: string }[] {
  const found: { person: string; alias: string }[] = [];
  for (const person of people) {
    const full = normalise(person);
    if (new RegExp(`\\b${escape(full)}\\b`).test(sentence)) {
      found.push({ person, alias: full });
      continue;
    }
    const first = full.split(" ")[0] ?? "";
    const sharing = people.filter((p) => normalise(p).split(" ")[0] === first).length;
    if (first !== full && sharing === 1 && new RegExp(`\\b${escape(first)}\\b`).test(sentence))
      found.push({ person, alias: first });
  }
  return found;
}

export function parseNeverEat(text: string, people: readonly string[]): NeverEatItem[] {
  const items: NeverEatItem[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[.!?;\n]+/)) {
    const sentence = normalise(raw);
    if (sentence === "") continue;
    const reason =
      REASONS.find(([pattern]) => pattern.test(sentence))?.[1] ??
      (/\b(pork|alcohol|pig|wine|beer)\b/.test(sentence) ? "religious" : "other");
    const named = namedPeople(sentence, people);
    const who = named.length === 0 ? ["everyone"] : named.map((n) => n.person);
    const aliases = [...named.map((n) => n.alias), ...people.map((p) => normalise(p))];
    const phrases = foodPhrases(
      sentence,
      aliases.sort((a, b) => b.length - a.length),
    );
    for (const person of who) {
      for (const term of phrases) {
        const key = `${person}\u0000${term}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ who: person, term, reason });
      }
    }
  }
  return items;
}
