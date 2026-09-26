// The household configuration as stored, read in one pass for the planner and the agent digest.
// Planner leaves map these rows onto their own input types (BLD-8 R-14).
import type {
  DayOverrideRow,
  ExclusionRow,
  FrequencyRuleRow,
  HouseholdAdjusterRow,
  HouseholdRow,
  MealDistributionRow,
  MealOverrideRow,
  MemberRow,
  MemberSlotScheduleRow,
  PlanningWeightsRow,
  PortionBiasRow,
  PreferenceRow,
  SlotTargetOverrideRow,
  SlotTypeRow,
  TargetProfileRow,
  ToleranceRow,
  TrainingScheduleRow,
  WeightPresetRow,
} from "./entities.js";

export interface HouseholdConfig {
  household: HouseholdRow;
  /** Active and archived members; archived ones have `archivedAt` set. */
  members: MemberRow[];
  targetProfiles: TargetProfileRow[];
  tolerances: ToleranceRow[];
  slotTypes: SlotTypeRow[];
  memberSlotSchedules: MemberSlotScheduleRow[];
  trainingSchedules: TrainingScheduleRow[];
  dayOverrides: DayOverrideRow[];
  mealDistributions: MealDistributionRow[];
  slotTargetOverrides: SlotTargetOverrideRow[];
  portionBiases: PortionBiasRow[];
  planningWeights: PlanningWeightsRow;
  weightPresets: WeightPresetRow[];
  exclusions: ExclusionRow[];
  preferences: PreferenceRow[];
  frequencyRules: FrequencyRuleRow[];
  adjusters: HouseholdAdjusterRow[];
  mealOverrides: MealOverrideRow[];
}
