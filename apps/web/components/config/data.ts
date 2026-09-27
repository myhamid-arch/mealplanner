"use client";
// One read of everything the configuration screens show, through the typed client.
import type { z } from "zod";
import { api, c, useLoad, type Loaded } from "./api";

export type Member = z.output<typeof c.MemberDto>;
export type TargetProfile = z.output<typeof c.TargetProfileDto>;
export type Tolerance = z.output<typeof c.ToleranceDto>;
export type Slot = z.output<typeof c.SlotDto>;
export type Schedules = z.output<typeof c.SchedulesDto>;
export type Exclusion = z.output<typeof c.ExclusionDto>;
export type Preference = z.output<typeof c.PreferenceDto>;
export type Weights = z.output<typeof c.WeightsDto>;
export type Preset = z.output<typeof c.PresetDto>;
export type Household = z.output<typeof c.HouseholdDto>;
export type Cuisine = z.output<typeof c.CuisineDto>;
export type Ingredient = z.output<typeof c.IngredientDto>;
export type DetailLevelRow = z.output<typeof c.DetailLevelDto>;
export type FrequencyRule = z.output<typeof c.FrequencyRuleDto>;

export interface HouseholdData {
  household: Household;
  members: Member[];
  targets: TargetProfile[];
  tolerances: Tolerance[];
  slots: Slot[];
  schedules: Schedules;
  exclusions: Exclusion[];
  preferences: Preference[];
  frequencyRules: FrequencyRule[];
  weights: Weights;
  presets: Preset[];
  cuisines: Cuisine[];
  ingredients: Ingredient[];
  levels: DetailLevelRow[];
}

/** Admin view of the household configuration. */
export async function loadHousehold(): Promise<HouseholdData> {
  const [
    household,
    members,
    targets,
    slots,
    schedules,
    exclusions,
    preferences,
    frequencyRules,
    weights,
    presets,
    cuisines,
    ingredients,
    levels,
  ] = await Promise.all([
    api.call(c.householdGet, {}),
    api.call(c.membersList, {}),
    api.call(c.targetsList, {}),
    api.call(c.slotsList, {}),
    api.call(c.schedulesGet, {}),
    api.call(c.exclusionsList, {}),
    api.call(c.preferencesList, {}),
    api.call(c.frequencyRulesList, {}),
    api.call(c.weightsGet, {}),
    api.call(c.presetsList, {}),
    api.call(c.cuisinesList, {}),
    api.call(c.ingredientsList, { query: { limit: 500 } }),
    api.call(c.detailLevelsList, {}),
  ]);
  return {
    household,
    members: (members.members ?? []).filter((m) => m.archivedAt === null),
    targets: targets.targets,
    tolerances: targets.tolerances,
    slots: [...(slots.slots ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    schedules,
    exclusions: exclusions.exclusions ?? [],
    preferences: preferences.preferences ?? [],
    frequencyRules: frequencyRules.rules ?? [],
    weights,
    presets: presets.presets ?? [],
    cuisines: cuisines.cuisines ?? [],
    ingredients: ingredients.ingredients ?? [],
    levels: levels.levels ?? [],
  };
}

export function useHousehold(): Loaded<HouseholdData> {
  return useLoad(loadHousehold);
}

export function levelOf(data: HouseholdData, memberId: string | null, section: string) {
  return (
    data.levels.find((l) => l.memberId === memberId && l.section === section)?.level ?? "basic"
  );
}

export function memberAge(member: Member, year: number): number | null {
  return member.birthYear === null ? null : year - member.birthYear;
}

/** Slot ids a member attends on at least one weekday (coarse default: every day), per day kind. */
export function attendedSlots(
  data: HouseholdData,
  memberId: string,
  dayKind: "default" | "training",
): Slot[] {
  const trains = data.schedules.training.some((t) => t.memberId === memberId);
  return data.slots.filter((slot) => {
    if (!slot.active) return false;
    if (slot.isTrainingSlot && (dayKind === "default" || !trains)) return false;
    const rows = data.schedules.slotSchedules.filter(
      (r) => r.memberId === memberId && r.slotTypeId === slot.id,
    );
    return rows.length < 7 || rows.some((r) => r.attends);
  });
}

export function hhmm(time: string): string {
  return time.slice(0, 5);
}
