// Test households: fixture F1 (BLD-2) as a HouseholdConfig, and a copy with realistic personal
// data (names, birth years, uuids, emails) for the pseudonymisation checks (G2, R-32 item 4).
import type {
  ExclusionRow,
  HouseholdConfig,
  PreferenceRow,
} from "@mealplanner/core/types";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./catalogue.js";

// Core's fixtures sit outside this package's TypeScript project, so they are imported from core's
// build output by absolute path (this module also runs compiled, from dist/test/).
type FixturesModule = typeof import("../../../../core/dist/test/fixtures/index.js");
type ConfigModule = typeof import("../../../../core/dist/test/planner/targets/config.js");
const coreDist = (path: string) =>
  pathToFileURL(join(repoRoot(), "packages/core/dist/test", path)).href;
const { F1 } = (await import(coreDist("fixtures/index.js"))) as FixturesModule;
const { configFromFixture } = (await import(
  coreDist("planner/targets/config.js")
)) as ConfigModule;

/** A Tuesday: Adult B trains (07:00), Adult A does not; every member attends dinner. */
export const F1_DINNER_DATE = "2026-09-29";

function preference(
  householdId: string,
  memberId: string | null,
  entityType: PreferenceRow["entityType"],
  entityKey: string,
  score: number,
  id: string,
): PreferenceRow {
  return {
    id,
    householdId,
    memberId,
    entityType,
    entityKey,
    score,
    evidenceWeight: 1,
    source: "explicit",
    locked: false,
    hard: "none",
    updatedAt: new Date(0),
  };
}

/** F1 with its exclusion (C3: sesame, allergy) and its liked cuisines (household level, +0.5). */
export function f1Config(): HouseholdConfig {
  const cfg = configFromFixture(F1);
  const householdId = cfg.household.id;
  const exclusions: ExclusionRow[] = [
    {
      id: "excl-c3-sesame",
      householdId,
      memberId: "c3",
      kind: "dietary_flag",
      key: "contains_sesame",
      reason: "allergy",
      hard: true,
    },
  ];
  const preferences = ["italian", "levantine", "american", "british", "indian"].map((key, i) =>
    preference(householdId, null, "cuisine", key, 0.5, `pref-cuisine-${String(i)}`),
  );
  return { ...cfg, exclusions, preferences };
}

export const REALISTIC = {
  householdId: "6f1d2c3e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
  householdName: "Haddad family",
  members: [
    { key: "adult_a", id: "0b7e4a52-3c1d-4e8f-a9b0-c1d2e3f4a5b6", name: "Omar Haddad", email: "omar.haddad@example.ae" },
    { key: "adult_b", id: "1c8f5b63-4d2e-4f90-b0c1-d2e3f4a5b6c7", name: "Layla Haddad", email: "layla.haddad@example.ae" },
    { key: "c1", id: "2d906c74-5e3f-4a01-81d2-e3f4a5b6c7d8", name: "Mariam Haddad", email: "mariam.h@example.ae" },
    { key: "c2", id: "3ea17d85-6f40-4b12-92e3-f4a5b6c7d8e9", name: "Yusuf Haddad", email: "yusuf.h@example.ae" },
    { key: "c3", id: "4fb28e96-7051-4c23-a3f4-a5b6c7d8e9fa", name: "Zayd Haddad", email: "zayd.h@example.ae" },
  ],
} as const;

/**
 * F1 with realistic personal data everywhere a config can hold it: uuids for the household,
 * members, slots and rows; full names; birth years; emails in member notes; names in a slot
 * constraints note and in the region note; and member-level preferences.
 */
export function realisticF1(): HouseholdConfig {
  const base = f1Config();
  const idOf = new Map<string, string>(REALISTIC.members.map((m) => [m.key, m.id]));
  const hid = REALISTIC.householdId;
  const memberId = (key: string | null) => (key === null ? null : (idOf.get(key) ?? key));
  const slotUuid = (slotId: string) =>
    `9${slotId.replace(/[^a-z]/g, "").padEnd(7, "0").slice(0, 7)}-0000-4000-8000-${slotId.length.toString().padStart(12, "0")}`;
  const slotIds = new Map(base.slotTypes.map((s) => [s.id, slotUuid(s.id)]));
  const slotId = (id: string) => slotIds.get(id) ?? id;
  return {
    ...base,
    household: { ...base.household, id: hid, name: REALISTIC.householdName, regionNote: "Khalifa City, Abu Dhabi (Omar's office in Musaffah)" },
    members: base.members.map((m) => {
      const real = REALISTIC.members.find((r) => r.key === m.id);
      return {
        ...m,
        id: memberId(m.id) ?? m.id,
        householdId: hid,
        displayName: real?.name ?? m.displayName,
        notes: real === undefined ? null : `Contact ${real.email}`,
      };
    }),
    targetProfiles: base.targetProfiles.map((p) => ({ ...p, id: `${hid}-${p.id}`, householdId: hid, memberId: memberId(p.memberId) ?? p.memberId })),
    tolerances: base.tolerances.map((t) => ({ ...t, householdId: hid, memberId: memberId(t.memberId) ?? t.memberId })),
    slotTypes: base.slotTypes.map((s) => ({
      ...s,
      id: slotId(s.id),
      householdId: hid,
      constraintsNote: s.key === "dinner" ? "Zayd eats first; Layla prefers dinner by 19:30" : s.constraintsNote,
    })),
    memberSlotSchedules: base.memberSlotSchedules.map((s) => ({ ...s, householdId: hid, memberId: memberId(s.memberId) ?? s.memberId, slotTypeId: slotId(s.slotTypeId) })),
    trainingSchedules: base.trainingSchedules.map((t) => ({ ...t, householdId: hid, memberId: memberId(t.memberId) ?? t.memberId })),
    planningWeights: { ...base.planningWeights, householdId: hid },
    exclusions: base.exclusions.map((e) => ({ ...e, id: `${hid}-excl`, householdId: hid, memberId: memberId(e.memberId) })),
    preferences: [
      ...base.preferences.map((p) => ({ ...p, householdId: hid })),
      preference(hid, memberId("adult_a"), "ingredient", "salmon", 0.8, `${hid}-p1`),
      preference(hid, memberId("c3"), "cuisine", "japanese", 0.9, `${hid}-p2`),
      preference(hid, memberId("adult_b"), "method", "deep_fried", -0.7, `${hid}-p3`),
    ],
  };
}
