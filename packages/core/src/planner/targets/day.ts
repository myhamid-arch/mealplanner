// PLN-4 steps 1 and 3: the day kind of a member on a date, and the slots the member attends.
// Attendance rules: SPEC-Q-3 (BLD-8 R-25).
import {
  weekdayOf,
  type DayKind,
  type HouseholdConfig,
  type MemberRow,
  type SlotTypeRow,
} from "../../types/index.js";
import { TargetResolverError } from "./errors.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Throws unless `date` is a real calendar date written `YYYY-MM-DD`. */
export function assertIsoDate(date: string): void {
  const match = ISO_DATE.exec(date);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    match === null ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new TargetResolverError("invalid_date", `"${date}" is not an ISO calendar date`);
}

export function findMember(cfg: HouseholdConfig, memberId: string): MemberRow {
  const member = cfg.members.find((m) => m.id === memberId);
  if (member === undefined)
    throw new TargetResolverError("unknown_member", `member ${memberId} is not in this household`);
  return member;
}

/** PLN-2/PLN-11 order of the day: default time, then sort order, then key. */
export function compareSlots(a: SlotTypeRow, b: SlotTypeRow): number {
  if (a.defaultTime !== b.defaultTime) return a.defaultTime < b.defaultTime ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * PLN-4 step 1: `training` if the training schedule has the weekday and no `rest` override
 * exists for the date, or a `training` override exists; otherwise `default`.
 */
export function dayKindOf(cfg: HouseholdConfig, memberId: string, date: string): DayKind {
  const overrides = cfg.dayOverrides.filter((o) => o.memberId === memberId && o.date === date);
  if (overrides.some((o) => o.kind === "training")) return "training";
  if (overrides.some((o) => o.kind === "rest")) return "default";
  const weekday = weekdayOf(date);
  return cfg.trainingSchedules.some((t) => t.memberId === memberId && t.weekday === weekday)
    ? "training"
    : "default";
}

/**
 * PLN-4 step 3. Active slots the member attends on the date, in the order of the day:
 * - a non-training slot is attended unless a schedule row for the weekday says `attends = false`;
 * - a training slot is attended only on training days, unless a schedule row says `attends = false`;
 * - `day_override(absent_slot)` removes a slot and `day_override(extra_slot)` adds one for that date;
 * - an inactive slot is never attended.
 * Also used for untargeted members (SPEC-Q-2), whose plates still need their attendance.
 */
export function attendedSlots(
  cfg: HouseholdConfig,
  memberId: string,
  date: string,
): { dayKind: DayKind; slots: SlotTypeRow[] } {
  assertIsoDate(date);
  findMember(cfg, memberId);
  const dayKind = dayKindOf(cfg, memberId, date);
  const weekday = weekdayOf(date);
  const overrides = cfg.dayOverrides.filter((o) => o.memberId === memberId && o.date === date);
  const absent = new Set(
    overrides.filter((o) => o.kind === "absent_slot").map((o) => o.slotTypeId),
  );
  const extra = new Set(overrides.filter((o) => o.kind === "extra_slot").map((o) => o.slotTypeId));

  const slots = cfg.slotTypes.filter((slot) => {
    if (!slot.active) return false;
    if (absent.has(slot.id)) return false;
    if (extra.has(slot.id)) return true;
    const row = cfg.memberSlotSchedules.find(
      (s) => s.memberId === memberId && s.slotTypeId === slot.id && s.weekday === weekday,
    );
    if (row !== undefined && !row.attends) return false;
    return slot.isTrainingSlot ? dayKind === "training" : true;
  });
  return { dayKind, slots: slots.sort(compareSlots) };
}
