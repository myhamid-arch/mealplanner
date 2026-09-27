// Response shapes of the W-5 endpoints, from the contract (ARC-5: one contract).
import type { z } from "zod";
import type {
  FollowupAnswerDto,
  OnboardingParseDto,
  PlanPreviewDto,
  SetupFollowupsDto,
} from "@mealplanner/api-contract/contract";

export type SetupFollowups = z.output<typeof SetupFollowupsDto>;
export type FollowupAnswer = z.output<typeof FollowupAnswerDto>;
export type PlanPreview = z.output<typeof PlanPreviewDto>;
export type OnboardingParse = z.output<typeof OnboardingParseDto>;
