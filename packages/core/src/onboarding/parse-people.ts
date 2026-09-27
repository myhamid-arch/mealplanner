// Question 1, "Who eats at home?": one line of names and ages (R2-ONB-1), e.g.
// "Omar 41, Sara 39, Layla 18 F" or "Layla (18, F) and Adam (15, M)".
import type { Sex } from "../types/index.js";
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

export function parsePeople(text: string): PersonAnswer[] {
  const people: PersonAnswer[] = [];
  const chunks = text
    .replace(/\(([^)]*)\)/g, (_, inner: string) => ` ${inner.replace(/[,;]/g, " ")} `)
    .split(/[,;\n]+|\s+and\s+|\s+&\s+/i);
  for (const chunk of chunks) {
    const tokens = chunk
      .replace(/[:=–—-]/g, " ")
      .split(/\s+/)
      .filter((t) => t !== "");
    const name: string[] = [];
    let age: number | null = null;
    let sex: Sex | null = null;
    for (const token of tokens) {
      const bare = token.replace(/[.]+$/, "");
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
    const display = name.join(" ").trim();
    if (display !== "") people.push({ name: display.slice(0, 80), age, sex });
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
