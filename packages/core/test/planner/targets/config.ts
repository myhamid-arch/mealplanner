// In-memory HouseholdConfig from a BLD-2 fixture, with the same rows the db fixture loader
// (packages/db/src/services/config/fixtures.ts) writes: default slots (PLN-2) with the fixture's
// active set, members, target profiles, tolerances, training days and attendance rows. Ids are
// readable keys: members by key, slots `slot:<key>`.
import { F1 } from "../../fixtures/index.js";
import {
  DEFAULT_PLANNING_WEIGHTS,
  DEFAULT_SLOTS,
  FixtureSchema,
  type FixtureInput,
  type HouseholdConfig,
  type SlotTypeRow,
} from "../../../src/types/index.js";

export const HOUSEHOLD_ID = "household-test";

export const slotId = (key: string): string => `slot:${key}`;

export function configFromFixture(input: FixtureInput): HouseholdConfig {
  const fixture = FixtureSchema.parse(input);
  const householdId = HOUSEHOLD_ID;
  const active = new Set(fixture.slots.active);
  const slotTypes: SlotTypeRow[] = [
    ...DEFAULT_SLOTS.map((s) => ({
      id: slotId(s.key),
      householdId,
      key: s.key,
      label: s.label,
      icon: s.icon,
      sortOrder: s.sortOrder,
      defaultTime: s.defaultTime,
      isShared: s.isShared,
      isPacked: s.isPacked,
      reheatAvailable: s.reheatAvailable,
      isTrainingSlot: s.isTrainingSlot,
      constraintsNote: null,
      active: active.has(s.key),
    })),
    ...fixture.slots.custom.map((s) => ({
      id: slotId(s.key),
      householdId,
      key: s.key,
      label: s.label,
      icon: s.icon,
      sortOrder: s.sortOrder,
      defaultTime: s.defaultTime,
      isShared: s.isShared,
      isPacked: s.isPacked,
      reheatAvailable: s.reheatAvailable,
      isTrainingSlot: false,
      constraintsNote: s.constraintsNote ?? null,
      active: true,
    })),
  ];
  const profile = (
    memberId: string,
    kind: "default" | "training",
    t: (typeof fixture.members)[number]["targets"] & object,
  ) => {
    const p = kind === "default" ? t.default : t.training;
    if (p === undefined) return [];
    return [
      {
        id: `${memberId}:${kind}`,
        householdId,
        memberId,
        kind,
        kcal: p.kcal,
        proteinG: p.proteinG,
        carbsG: p.carbsG,
        fatG: p.fatG,
        satFatMaxG: p.satFatMaxG ?? null,
        solubleFibreMinG: p.solubleFibreMinG ?? null,
        fibreMinG: p.fibreMinG ?? null,
        sodiumMaxMg: p.sodiumMaxMg ?? null,
      },
    ];
  };
  return {
    household: {
      id: householdId,
      name: fixture.household.name,
      locale: "en-AE",
      timezone: "Asia/Dubai",
      unitSystem: "metric",
      countryCode: "AE",
      regionNote: fixture.household.regionNote ?? null,
      membersSeePlates: true,
      agentMayApply: true,
      requireTotpForAdmins: false,
      kitchenSeesNames: true,
      membersReviewForSiblings: true,
      insightFrequency: "weekly",
      defaultPrecision: "strict",
      satFatDefaultPct: 10,
      deletionRequestedAt: null,
      deletionRequestedByUserId: null,
      suspendedAt: null,
      createdAt: new Date(0),
    },
    members: fixture.members.map((m) => ({
      id: m.key,
      householdId,
      displayName: m.displayName,
      color: m.color,
      birthYear: m.birthYear ?? null,
      sex: m.sex ?? null,
      isTargeted: m.targets !== undefined,
      appetite: m.appetite,
      notes: null,
      archivedAt: null,
    })),
    targetProfiles: fixture.members.flatMap((m) =>
      m.targets === undefined
        ? []
        : [...profile(m.key, "default", m.targets), ...profile(m.key, "training", m.targets)],
    ),
    tolerances: fixture.members.flatMap((m) =>
      m.tolerance === undefined ? [] : [{ memberId: m.key, householdId, ...m.tolerance }],
    ),
    slotTypes,
    memberSlotSchedules: fixture.schedules.flatMap((s) =>
      s.weekdays.map((weekday) => ({
        householdId,
        memberId: s.member,
        slotTypeId: slotId(s.slot),
        weekday,
        attends: s.attends,
      })),
    ),
    trainingSchedules: fixture.members.flatMap((m) =>
      m.training.map((t) => ({
        householdId,
        memberId: m.key,
        weekday: t.weekday,
        sessionTime: t.sessionTime,
        intensity: t.intensity ?? null,
      })),
    ),
    dayOverrides: [],
    mealDistributions: [],
    slotTargetOverrides: [],
    portionBiases: [],
    planningWeights: { householdId, ...DEFAULT_PLANNING_WEIGHTS, updatedAt: new Date(0) },
    weightPresets: [],
    exclusions: [],
    preferences: [],
    frequencyRules: [],
    adjusters: [],
    mealOverrides: [],
  };
}

export function f1Config(): HouseholdConfig {
  return configFromFixture(F1);
}

/** The F1 reference week, Monday 2026-09-28 to Sunday 2026-10-04. */
export const F1_WEEK = [
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
] as const;
