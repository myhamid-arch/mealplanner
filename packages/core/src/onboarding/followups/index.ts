// @mealplanner/core/onboarding/followups: first-days follow-up questions and the "Getting set up"
// checklist (R2-ONB-6; BLD-8 R-55, R-56).
export {
  DINNER_TIMES,
  FOLLOWUP_KINDS,
  FOLLOWUP_STATUSES,
  FollowupError,
  NUT_FLAG,
  followupOps,
  followupQueue,
  proposeFollowups,
  schoolChildren,
  type Followup,
  type FollowupChoice,
  type FollowupConfig,
  type FollowupKind,
  type FollowupQueue,
  type FollowupState,
  type FollowupStatus,
} from "./engine.js";
export {
  FIRST_RATINGS,
  checklist,
  setupDay,
  type Checklist,
  type ChecklistItem,
  type ChecklistKey,
  type SetupFacts,
} from "./checklist.js";
