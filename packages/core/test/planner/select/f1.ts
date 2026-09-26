// F1 (BLD-2) as a planner configuration: the target-resolver test config plus the F1 rows it leaves
// out, the C3 sesame allergy and the liked cuisines as household +0.5 preferences (R2-ONB-3).
import { F1 } from "../../fixtures/index.js";
import { HOUSEHOLD_ID, configFromFixture } from "../targets/config.js";
import {
  FixtureSchema,
  type ExclusionRow,
  type HouseholdConfig,
  type PreferenceRow,
} from "../../../src/types/index.js";

export { F1_WEEK, slotId } from "../targets/config.js";

export function f1Exclusions(): ExclusionRow[] {
  return FixtureSchema.parse(F1).exclusions.map((e, i) => ({
    id: `exclusion-${String(i + 1)}`,
    householdId: HOUSEHOLD_ID,
    memberId: e.member ?? null,
    kind: e.kind,
    key: e.key,
    reason: e.reason,
    hard: true,
  }));
}

export function f1CuisinePreferences(): PreferenceRow[] {
  return FixtureSchema.parse(F1).cuisines.liked.map((key) => ({
    id: `pref-cuisine-${key}`,
    householdId: HOUSEHOLD_ID,
    memberId: null,
    entityType: "cuisine",
    entityKey: key,
    score: 0.5,
    evidenceWeight: 0,
    source: "explicit",
    locked: false,
    hard: "none",
    updatedAt: new Date(0),
  }));
}

/** F1 with its exclusion and cuisine rows; `sesameAllergy: false` is G3's negative control. */
export function f1PlanConfig(opts: { sesameAllergy?: boolean } = {}): HouseholdConfig {
  const cfg = configFromFixture(F1);
  cfg.exclusions = opts.sesameAllergy === false ? [] : f1Exclusions();
  cfg.preferences = f1CuisinePreferences();
  return cfg;
}
