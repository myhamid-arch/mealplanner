// Public types of @mealplanner/core/onboarding (R2-ONB-3). The five answers are parsed into these
// structured forms, shown for confirmation, and then turned into one change set by `inferSetup`.
// The chat path (R2-ONB-5) produces the same `OnboardingAnswers`.
import type { ChangeOp } from "../changes/index.js";
import type { DietaryFlag, ExclusionReason, Sex } from "../types/index.js";

/** Question 1: one person from "Omar 41, Sara 39, Layla 18 F". */
export interface PersonAnswer {
  name: string;
  /** Whole years; null when the answer gave none. */
  age: number | null;
  sex: Sex | null;
}

/** Question 2: one day's numbers, from any of the R2-ONB-3 formats. */
export interface DayTargets {
  kcal: number;
  proteinG: number;
  /** Total carbohydrate (R-20, R-28 OQ-7). */
  carbsG: number;
  fatG: number;
  satFatMaxG?: number;
  solubleFibreMinG?: number;
  fibreMinG?: number;
  sodiumMaxMg?: number;
}

export interface TargetNumbers extends DayTargets {
  /** Only when the answer names training-day numbers ("the training profile is only created if the user asks"). */
  training?: DayTargets;
}

export type TargetParse = { ok: true; value: TargetNumbers } | { ok: false; reason: string };

export type TrainingTime = "morning" | "evening";

/** Question 3: the tap cards. Weekdays are 0 = Monday … 6 = Sunday (R-24). */
export interface WeekAnswer {
  school: { people: string[]; weekdays: number[] } | null;
  work: { people: string[]; weekdays: number[] } | null;
  training: { person: string; weekdays: number[]; time: TrainingTime }[];
  /** "We snack between meals": on by default. */
  snacks: boolean;
}

/**
 * R-88: what a rule covers, as the assistant mapped it onto the catalogue: one dietary flag, one
 * or more ingredient categories, or specific ingredient slugs. Checked again in `inferSetup`.
 */
export interface NeverEatTarget {
  kind: "dietary_flag" | "category" | "ingredient";
  keys: string[];
}

/** Question 5: one rule, before it is resolved against the catalogue. */
export interface NeverEatItem {
  /** A person's name from question 1, or "everyone". */
  who: string;
  /** The food as written: "sesame", "pork", "liver". */
  term: string;
  reason: ExclusionReason;
  /** R-88: the assistant's mapping; absent → the term is matched by `resolveTerm`. */
  target?: NeverEatTarget;
  /** R-88: the assistant's plain-words summary ("chicken on the bone: drumsticks, wings"). */
  summary?: string;
}

/** R-88: a question the assistant asks when the never-eat answer can be read more than one way. */
export interface NeverEatQuestion {
  who: string;
  /** The words the question is about. */
  said: string;
  question: string;
  /** The first option is the safest reading; it applies until another is chosen. */
  options: { label: string; items: NeverEatItem[] }[];
}

/** The confirmed answers. `null` means the question was skipped (R2-ONB-2: defaults apply). */
export interface OnboardingAnswers {
  people: PersonAnswer[] | null;
  targets: { person: string; numbers: TargetNumbers }[] | null;
  week: WeekAnswer | null;
  /** Cuisine keys (02 §3). */
  cuisines: string[] | null;
  neverEat: NeverEatItem[] | null;
}

/** The model-backed parser (R2-ONB-3 "parsed with Claude using structured output"); stubbed in tests. */
export interface FreeTextParser {
  people(text: string): Promise<PersonAnswer[]>;
  targets(text: string): Promise<TargetParse>;
  neverEat(text: string, people: readonly string[]): Promise<NeverEatItem[]>;
}

export interface InferContext {
  /** The year ages are counted from (birth_year = referenceYear − age). */
  referenceYear: number;
  /** Used when question 1 is skipped (SPEC-Q-9). */
  adminName: string;
  /** The household's slot types (seeded from PLN-2 at sign-up). */
  slots: readonly { id: string; key: string; label: string; active: boolean }[];
  cuisines: readonly { key: string; label: string }[];
  ingredients: readonly {
    slug: string;
    name: string;
    aliases: readonly string[];
    dietaryFlags: readonly string[];
    /** Catalogue category (W-28: "seafood", "chicken" match by it); absent → never matched by it. */
    category?: string;
  }[];
  /** Household sat-fat default in % of energy (R-28: 6). */
  satFatDefaultPct: number;
  newId: () => string;
}

/** Where an inferred setting is adjusted after saving (SC-7). */
export type AdjustTarget =
  | { screen: "family" }
  | {
      screen: "member";
      memberId: string;
      section: "profile" | "targets" | "meals" | "training" | "never-serve";
    }
  | { screen: "schedule"; slotKey: string }
  | { screen: "tastes"; section: "cuisines" | "never-serve" };

export interface Explanation {
  /** 1 … 5: the answer this came from. */
  answer: 1 | 2 | 3 | 4 | 5;
  text: string;
  adjust: AdjustTarget;
  /** The URL of `adjust`. */
  href: string;
}

export interface InferredSetup {
  changeOps: ChangeOp[];
  explanations: Explanation[];
  /** New members by name, with the ids used in `changeOps`. */
  members: { name: string; id: string }[];
  /** Ingredient slugs each dietary-flag exclusion covers, for the confirmation text. */
  coverage: { memberId: string | null; flag: DietaryFlag; slugs: string[] }[];
  /** Never-eat terms that matched nothing in the catalogue; shown, not saved. */
  unresolved: NeverEatItem[];
}
