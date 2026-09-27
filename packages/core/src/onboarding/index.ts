// @mealplanner/core/onboarding: the onboarding inference engine (R2-ONB-3).
export type * from "./types.js";
export {
  CUISINE_LIKE_SCORE,
  FIBRE_G_PER_1000_KCAL,
  inferSetup,
  OnboardingError,
  SOLUBLE_SHARE,
  TRAINING_TIMES,
} from "./infer.js";
export { adjustHref, MEMBER_COLOR_ORDER } from "./explain.js";
export { appetiteForAge, isChild, parsePeople } from "./parse-people.js";
export { parseTargets, targetsText } from "./parse-targets.js";
export { parseNeverEat } from "./parse-never-eat.js";
export { flagCoverage, matchIngredients, resolveTerm, type Resolution } from "./resolve.js";
export { listJoin, weekdayText, WEEKDAY_SHORT } from "./text.js";
