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

/** A clause's reason, when it states one. */
function reasonOf(clause: string): ExclusionReason | null {
  return REASONS.find(([pattern]) => pattern.test(clause))?.[1] ?? null;
}

interface Segment {
  who: string[];
  reason: ExclusionReason;
  terms: string[];
}

/**
 * W-28: a sentence can name several people with their own foods ("No pork for anyone, Omar hates
 * cheese, Mohamed no seafood"), so it is read clause by clause (split at commas, semicolons and
 * "but"). A clause that names someone starts a new subject; one that names nobody continues the
 * previous subject and reason ("Omar hates cheese, cream cheese"), or means everyone when it opens
 * the sentence. Names with no food yet ("Omar, Sara and Adam are allergic to nuts") carry forward.
 */
export function parseNeverEat(text: string, people: readonly string[]): NeverEatItem[] {
  const items: NeverEatItem[] = [];
  const seen = new Set<string>();
  const allAliases = people.map((p) => normalise(p));
  for (const raw of text.split(/[.!?;\n]+/)) {
    const sentence = normalise(raw);
    if (sentence === "") continue;
    const segments: Segment[] = [];
    let pending: string[] = [];
    let current: Segment | null = null;
    for (const clause of sentence.split(/,|\bbut\b/)) {
      if (clause.trim() === "") continue;
      const named = namedPeople(clause, people);
      const everyone = EVERYONE.test(clause);
      const aliases = [...named.map((n) => n.alias), ...allAliases].sort(
        (a, b) => b.length - a.length,
      );
      const terms = foodPhrases(clause, aliases);
      const reason = reasonOf(clause);
      // R-88: "religious" only for the clause that names pork or alcohol, not its neighbours.
      const fallback: ExclusionReason = /\b(pork|alcohol|pig|wine|beer)\b/.test(clause)
        ? "religious"
        : "other";
      if (named.length > 0 || everyone) {
        const who = [...pending, ...(everyone && named.length === 0 ? ["everyone"] : [])];
        for (const n of named) if (!who.includes(n.person)) who.push(n.person);
        if (terms.length === 0) {
          pending = who;
          if (reason !== null && current !== null && pending.length === 0) current.reason = reason;
          continue;
        }
        pending = [];
        current = { who, reason: reason ?? fallback, terms: [...terms] };
        segments.push(current);
      } else if (terms.length > 0) {
        if (pending.length > 0) {
          current = { who: pending, reason: reason ?? fallback, terms: [...terms] };
          pending = [];
          segments.push(current);
        } else if (current === null) {
          current = { who: ["everyone"], reason: reason ?? fallback, terms: [...terms] };
          segments.push(current);
        } else if (reason !== null && reason !== current.reason) {
          current = { who: current.who, reason, terms: [...terms] };
          segments.push(current);
        } else {
          current.terms.push(...terms);
        }
      } else if (reason !== null && pending.length > 0) {
        // "Omar and Sara, both allergic, to nuts" style fragments: keep the names pending.
        continue;
      }
    }
    // Names left without food: the reason may name a food nowhere, so nothing to add.
    for (const segment of segments) {
      for (const person of segment.who) {
        for (const term of segment.terms) {
          const key = `${person}\u0000${term}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({ who: person, term, reason: segment.reason });
        }
      }
    }
  }
  return items;
}
