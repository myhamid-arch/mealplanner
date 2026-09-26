// Reads the whole household configuration (HouseholdConfig) through the scoped repositories.
import type { HouseholdConfig, HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";

export async function loadHouseholdConfig(
  db: Executor,
  ctx: HouseholdContext,
): Promise<HouseholdConfig> {
  const r = createRepos(db, ctx);
  // Sequential: `db` may be a transaction, which runs on one connection.
  const household = await r.household.get({ id: ctx.householdId });
  const planningWeights = await r.planning_weights.get({ householdId: ctx.householdId });
  if (household === null) throw new Error(`household ${ctx.householdId} not found`);
  if (planningWeights === null)
    throw new Error(`household ${ctx.householdId} has no planning weights`);
  const members = await r.member.list();
  const targetProfiles = await r.target_profile.list();
  const tolerances = await r.tolerance.list();
  const slotTypes = await r.slot_type.list();
  const memberSlotSchedules = await r.member_slot_schedule.list();
  const trainingSchedules = await r.training_schedule.list();
  const dayOverrides = await r.day_override.list();
  const mealDistributions = await r.meal_distribution.list();
  const slotTargetOverrides = await r.slot_target_override.list();
  const portionBiases = await r.portion_bias.list();
  const weightPresets = await r.weight_preset.list();
  const exclusions = await r.exclusion.list();
  const preferences = await r.preference.list();
  const frequencyRules = await r.frequency_rule.list();
  const adjusters = await r.household_adjuster.list();
  const mealOverrides = await r.meal_override.list();
  return {
    household,
    members,
    targetProfiles,
    tolerances,
    slotTypes: [...slotTypes].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
    ),
    memberSlotSchedules,
    trainingSchedules,
    dayOverrides,
    mealDistributions,
    slotTargetOverrides,
    portionBiases,
    planningWeights,
    weightPresets,
    exclusions,
    preferences,
    frequencyRules,
    adjusters,
    mealOverrides,
  };
}
