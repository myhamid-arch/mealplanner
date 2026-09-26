// The meals of a date (R2-MEAL-1/2, PLN-11, SPEC-Q-10): who attends which slot, shared or
// individual, with one-off meal overrides, in planning order.
import type { HouseholdConfig, SlotTypeRow } from "../../types/index.js";
import { attendedSlots, compareSlots } from "../targets/day.js";
import type { MealKind } from "./types.js";

export type MealSpec = {
  date: string;
  slot: SlotTypeRow;
  kind: MealKind;
  /** `shared` or the member id of an individual meal. */
  memberScope: string;
  attendees: string[];
  splitMembers: string[];
  split: boolean;
};

export const SHARED_SCOPE = "shared";

export function mealKey(date: string, slotTypeId: string, memberScope: string): string {
  return `${date}|${slotTypeId}|${memberScope}`;
}

/**
 * Meals of one date in planning order (PLN-11): shared meals in time order, then individual meals
 * per member (members in configuration order), each member's in time order.
 *
 * - A slot with `is_shared = false`, or a `make_individual` override for the date, gives one
 *   individual meal per attendee.
 * - A `split_member` override takes its members out of the shared meal; each gets an individual
 *   meal marked `split`. If every attendee is split out, there is no shared meal.
 */
export function mealsOfDate(cfg: HouseholdConfig, date: string): MealSpec[] {
  const members = cfg.members.filter((m) => m.archivedAt === null);
  const attendance = new Map<string, string[]>();
  const slots = new Map<string, SlotTypeRow>();
  for (const m of members)
    for (const slot of attendedSlots(cfg, m.id, date).slots) {
      slots.set(slot.id, slot);
      const list = attendance.get(slot.id) ?? [];
      list.push(m.id);
      attendance.set(slot.id, list);
    }

  const shared: MealSpec[] = [];
  const individual: MealSpec[] = [];
  const ordered = [...slots.values()].sort(compareSlots);
  for (const slot of ordered) {
    const attendees = attendance.get(slot.id) ?? [];
    const overrides = cfg.mealOverrides.filter(
      (o) => o.planDate === date && o.slotTypeId === slot.id,
    );
    const makeIndividual = !slot.isShared || overrides.some((o) => o.kind === "make_individual");
    const own = (memberId: string, split: boolean): MealSpec => ({
      date,
      slot,
      kind: "individual",
      memberScope: memberId,
      attendees: [memberId],
      splitMembers: [],
      split,
    });
    if (makeIndividual) {
      for (const m of attendees) individual.push(own(m, false));
      continue;
    }
    const splitIds = new Set(
      overrides.filter((o) => o.kind === "split_member").flatMap((o) => o.memberIds),
    );
    const stay = attendees.filter((m) => !splitIds.has(m));
    const out = attendees.filter((m) => splitIds.has(m));
    if (stay.length > 0)
      shared.push({
        date,
        slot,
        kind: "shared",
        memberScope: SHARED_SCOPE,
        attendees: stay,
        splitMembers: out,
        split: false,
      });
    for (const m of out) individual.push(own(m, true));
  }
  const memberOrder = new Map(members.map((m, i) => [m.id, i]));
  individual.sort(
    (a, b) =>
      (memberOrder.get(a.memberScope) ?? 0) - (memberOrder.get(b.memberScope) ?? 0) ||
      compareSlots(a.slot, b.slot),
  );
  return [...shared, ...individual];
}
