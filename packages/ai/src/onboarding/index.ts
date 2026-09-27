// @mealplanner/ai/onboarding: the model-backed onboarding free-text parse (R2-ONB-3; BLD-8 R-55,
// R-56). The web route wires the database port (R-2).
export {
  ONBOARDING_PARSE_DISABLED_REASON,
  ONBOARDING_PARSE_EFFORT,
  createOnboardingModel,
  parseOnboardingText,
  parseRequest,
  systemBlocks,
  type OnboardingGenerationRecord,
  type OnboardingParseDeps,
  type OnboardingParseFailure,
  type OnboardingParseInput,
  type OnboardingParseResult,
} from "./parse.js";
export {
  ENERGY_AGREEMENT,
  MAX_TEXT,
  NeverEatOutputSchema,
  ONBOARDING_FIELDS,
  PeopleOutputSchema,
  TargetsOutputSchema,
  checkOutput,
  type Checked,
  type OnboardingField,
  type ParsedValue,
} from "./schema.js";
