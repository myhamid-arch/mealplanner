// Question 2, "Who follows macro targets?": numbers in any format (R2-ONB-3), e.g.
// "2150 cal, 180p 200c 70f", "1655 / 130 / 160 / 55", "Protein: 180 g · Carbs 200g · Fat 70 g",
// with optional "sat fat 22 g", "soluble fibre 10 g", "fibre 30 g", "sodium 2300 mg" and an
// optional "training days: …" part with its own numbers. Carbohydrate is total (R-28, OQ-7).
import type { DayTargets, TargetParse } from "./types.js";

const NUM = String.raw`(\d{1,5}(?:[.,]\d+)?)`;

interface Found {
  value: number;
  rest: string;
}

/** Finds the first match of any pattern (each with one number group), and blanks it out. */
function take(text: string, patterns: readonly RegExp[]): Found | null {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m === null) continue;
    const raw: string | undefined = m.slice(1).find(Boolean);
    if (raw === undefined) continue;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) continue;
    return {
      value,
      rest: text.slice(0, m.index) + " ".repeat(m[0].length) + text.slice(m.index + m[0].length),
    };
  }
  return null;
}

/**
 * "<number> <label>" or "<label> <number>", the label not glued to other letters. `glued` only
 * matches with nothing between number and label ("180p", "P180", "70 g fat" is not glued); those
 * bind first so "F70 kcal 2150" reads fat 70 and 2150 kcal.
 */
function labelled(label: string, unit = String.raw`g`, glued = false): RegExp[] {
  const gap = glued ? "" : String.raw`\s*`;
  const unitPart = glued ? "" : String.raw`(?:${unit})?\s*`;
  const op = glued ? "" : String.raw`(?:[:=]|max|min|at most|at least|≤|>=|<=|≥)?\s*`;
  return [
    new RegExp(String.raw`${NUM}${gap}${unitPart}(?:${label})(?![a-z])`, "i"),
    new RegExp(String.raw`(?<![a-z])(?:${label})${gap}${op}${NUM}`, "i"),
  ];
}

const KCAL = String.raw`kcals?|kilocalories|calories|cals?|energy`;
const PROTEIN = String.raw`protein|prot|pro|p`;
const CARBS = String.raw`carbohydrates?|carbs?|cho|c`;
const FAT = String.raw`fats?|f`;
const SAT_FAT = String.raw`sat(?:urated)?\.?\s*fats?|saturates|satfat`;
const SOLUBLE = String.raw`soluble\s*fib(?:re|er)`;
const FIBRE = String.raw`fib(?:re|er)`;
const SODIUM = String.raw`sodium|na`;

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function parseDay(input: string): { ok: true; value: DayTargets } | { ok: false; reason: string } {
  let text = ` ${input.toLowerCase().replace(/\s+/g, " ")} `;
  const extras: Partial<DayTargets> = {};
  const grab = (patterns: RegExp[]): number | undefined => {
    const found = take(text, patterns);
    if (found === null) return undefined;
    text = found.rest;
    return found.value;
  };

  const satFat = grab(labelled(SAT_FAT));
  const soluble = grab(labelled(SOLUBLE));
  const fibre = grab(labelled(FIBRE));
  const sodiumMg = take(text, [
    new RegExp(String.raw`${NUM}\s*mg\s*(?:${SODIUM})(?![a-z])`, "i"),
    new RegExp(String.raw`(?<![a-z])(?:${SODIUM})\s*(?:[:=]|max|at most|≤|<=)?\s*${NUM}\s*mg`, "i"),
  ]);
  if (sodiumMg !== null) {
    text = sodiumMg.rest;
    extras.sodiumMaxMg = round(sodiumMg.value);
  } else {
    const sodiumG = grab(labelled(SODIUM));
    if (sodiumG !== undefined) extras.sodiumMaxMg = round(sodiumG * 1000);
  }
  if (satFat !== undefined) extras.satFatMaxG = round(satFat);
  if (soluble !== undefined) extras.solubleFibreMinG = round(soluble);
  if (fibre !== undefined) extras.fibreMinG = round(fibre);

  let kcal = grab(labelled(KCAL, String.raw`k`, true));
  let protein = grab(labelled(PROTEIN, "g", true));
  let carbs = grab(labelled(CARBS, "g", true));
  let fat = grab(labelled(FAT, "g", true));
  kcal ??= grab(labelled(KCAL, String.raw`k`));
  protein ??= grab(labelled(PROTEIN));
  carbs ??= grab(labelled(CARBS));
  fat ??= grab(labelled(FAT));

  const labelledCount = [kcal, protein, carbs, fat].filter((v) => v !== undefined).length;
  if (labelledCount === 0) {
    // Bare numbers in order: kcal / P / C / F, or P / C / F.
    const bare = [...text.matchAll(new RegExp(NUM, "g"))].map((m) =>
      Number((m[1] ?? "").replace(",", ".")),
    );
    if (bare.length === 4) [kcal, protein, carbs, fat] = bare;
    else if (bare.length === 3) [protein, carbs, fat] = bare;
    else
      return {
        ok: false,
        reason:
          bare.length === 0
            ? "No numbers found. Try “2150 kcal, 180p 200c 70f”."
            : `Found ${String(bare.length)} numbers; expected calories, protein, carbs and fat.`,
      };
  }
  if (protein === undefined || carbs === undefined || fat === undefined) {
    const missing = [
      protein === undefined ? "protein" : null,
      carbs === undefined ? "carbs" : null,
      fat === undefined ? "fat" : null,
    ].filter((x) => x !== null);
    return { ok: false, reason: `Missing ${missing.join(" and ")}.` };
  }
  // Calories left out: from the macros (4 / 4 / 9 kcal per g).
  kcal ??= Math.round(protein * 4 + carbs * 4 + fat * 9);
  if (kcal < 800 || kcal > 6000)
    return { ok: false, reason: `${String(kcal)} kcal a day is outside 800–6000.` };
  for (const [name, grams] of [
    ["protein", protein],
    ["carbs", carbs],
    ["fat", fat],
  ] as const) {
    if (grams < 0 || grams > 800)
      return { ok: false, reason: `${String(grams)} g of ${name} is outside 0–800 g.` };
  }
  return {
    ok: true,
    value: {
      kcal: Math.round(kcal),
      proteinG: round(protein),
      carbsG: round(carbs),
      fatG: round(fat),
      ...extras,
    },
  };
}

const TRAINING_SPLIT = /(?:^|[\s.;,(])(?:on\s+)?training(?:\s+days?)?\s*(?:[:=–—-]|\))?/i;

export function parseTargets(text: string): TargetParse {
  const split = TRAINING_SPLIT.exec(text);
  const main = split === null ? text : text.slice(0, split.index);
  const training = split === null ? null : text.slice(split.index + split[0].length);
  const day = parseDay(main);
  if (!day.ok) return day;
  if (training === null || training.trim() === "") return { ok: true, value: day.value };
  const trainingDay = parseDay(training);
  if (!trainingDay.ok) return { ok: false, reason: `Training days: ${trainingDay.reason}` };
  return { ok: true, value: { ...day.value, training: trainingDay.value } };
}

/** "2150 kcal · P180 C200 F70" (carbs are total). */
export function targetsText(t: DayTargets): string {
  return `${String(t.kcal)} kcal · P${String(t.proteinG)} C${String(t.carbsG)} F${String(t.fatG)}`;
}
