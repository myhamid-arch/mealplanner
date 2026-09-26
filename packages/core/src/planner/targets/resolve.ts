// PLN-4: per (member, date, slot) macro targets and tolerances.
import {
  DEFAULT_TOLERANCE,
  type HouseholdConfig,
  type MemberRow,
  type SlotTargetOverrideRow,
  type TargetProfileRow,
} from "../../types/index.js";
import { CARB_TARGET_BASIS } from "./config.js";
import { assertIsoDate, attendedSlots } from "./day.js";
import { TargetResolverError } from "./errors.js";
import { apportion, round1, slotShares, slotValues } from "./shares.js";
import type { MacroTolerance, ResolveOptions, SlotTarget } from "./types.js";

/** kcal per gram of fat, for the OQ-4 default sat-fat cap. */
const KCAL_PER_G_FAT = 9;
/** OQ-4 (R-28): total fibre goal when unset, grams per 1,000 kcal of the day's target. */
export const FIBRE_G_PER_1000_KCAL = 14;
/** OQ-4 (R-28): soluble-fibre goal when unset, as a share of the fibre goal. */
export const SOLUBLE_SHARE_OF_FIBRE = 0.25;

/** PLN-4 step 2: the day kind's profile, falling back to `default`. */
function profileFor(cfg: HouseholdConfig, member: MemberRow, dayKind: string): TargetProfileRow {
  const own = cfg.targetProfiles.filter((p) => p.memberId === member.id);
  const profile = own.find((p) => p.kind === dayKind) ?? own.find((p) => p.kind === "default");
  if (profile === undefined)
    throw new TargetResolverError(
      "missing_profile",
      `targeted member ${member.id} has no default target profile`,
    );
  return profile;
}

/**
 * PLN-4 step 6 (SPEC-Q-8): the member's tolerance row, else the 02 §2 defaults. `kcal` here is the
 * daily band (OQ-2, R-28); the caller splits it across slots.
 */
function toleranceFor(
  cfg: HouseholdConfig,
  memberId: string,
): { tol: MacroTolerance; mode: SlotTarget["mode"] } {
  const row = cfg.tolerances.find((t) => t.memberId === memberId);
  if (row === undefined)
    return {
      tol: {
        kcal: DEFAULT_TOLERANCE.kcal,
        protein: DEFAULT_TOLERANCE.proteinG,
        carbs: DEFAULT_TOLERANCE.carbsG,
        fat: DEFAULT_TOLERANCE.fatG,
      },
      mode: cfg.household.defaultPrecision,
    };
  return {
    tol: { kcal: row.kcal, protein: row.proteinG, carbs: row.carbsG, fat: row.fatG },
    mode: row.mode,
  };
}

/**
 * PLN-4. Slot targets of every active targeted member on `date`, members in configuration order
 * and slots in the order of the day. Untargeted and archived members get none (SPEC-Q-2).
 */
export function resolveSlotTargets(
  cfg: HouseholdConfig,
  date: string,
  opts: ResolveOptions = {},
): SlotTarget[] {
  assertIsoDate(date);
  const carbBasis = opts.carbBasis ?? CARB_TARGET_BASIS;
  const targets: SlotTarget[] = [];
  for (const member of cfg.members) {
    if (!member.isTargeted || member.archivedAt !== null) continue;
    const { dayKind, slots } = attendedSlots(cfg, member.id, date);
    if (slots.length === 0) continue;
    const profile = profileFor(cfg, member, dayKind);
    const shares = slotShares(cfg, member.id, dayKind, slots);

    // Step 4, expert layer: slot_target_override rows for the attended slots.
    const overrides: (SlotTargetOverrideRow | undefined)[] = slots.map((slot) =>
      cfg.slotTargetOverrides.find(
        (o) => o.memberId === member.id && o.dayKind === dayKind && o.slotTypeId === slot.id,
      ),
    );
    const fixed = (pick: (o: SlotTargetOverrideRow) => number | null) =>
      overrides.map((o) => (o === undefined ? undefined : (pick(o) ?? undefined)));
    const kcal = slotValues(
      profile.kcal,
      shares,
      fixed((o) => o.kcal),
    );
    const protein = slotValues(
      profile.proteinG,
      shares,
      fixed((o) => o.proteinG),
    );
    const carbs = slotValues(
      profile.carbsG,
      shares,
      fixed((o) => o.carbsG),
    );
    const fat = slotValues(
      profile.fatG,
      shares,
      fixed((o) => o.fatG),
    );

    // Step 5: sat-fat cap and fibre goals by share, with the OQ-4 defaults (R-28).
    const satFatDaily =
      profile.satFatMaxG ?? (profile.kcal * cfg.household.satFatDefaultPct) / 100 / KCAL_PER_G_FAT;
    const fibreDaily = profile.fibreMinG ?? (profile.kcal / 1000) * FIBRE_G_PER_1000_KCAL;
    const solubleFibreDaily = profile.solubleFibreMinG ?? fibreDaily * SOLUBLE_SHARE_OF_FIBRE;
    // Step 6: P/C/F tolerances per meal; the daily kcal band split by share (OQ-2, R-28).
    const { tol, mode } = toleranceFor(cfg, member.id);
    const kcalTol = apportion(Math.round(tol.kcal), shares);

    slots.forEach((slot, i) => {
      const share = shares[i] ?? 0;
      targets.push({
        memberId: member.id,
        date,
        slotKey: slot.key,
        slotTypeId: slot.id,
        dayKind,
        kcal: kcal[i] ?? 0,
        protein: protein[i] ?? 0,
        carbs: carbs[i] ?? 0,
        fat: fat[i] ?? 0,
        satFatMax: round1(satFatDaily * share),
        fibreGoal: round1(fibreDaily * share),
        solubleFibreGoal: round1(solubleFibreDaily * share),
        tol: { ...tol, kcal: kcalTol[i] ?? 0 },
        mode,
        carbBasis,
      });
    });
  }
  return targets;
}
