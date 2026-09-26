// FBK-7 rule 4 (repeated plate misses) and FBK-5 quantity feedback from targeted members, both of
// which become meal-split (distribution.set) or preference proposals (SPEC-Q-4, SPEC-Q-14).
import { attendedSlots, slotShares } from "../../planner/targets/index.js";
import type { DayKind } from "../../types/index.js";
import {
  MIN_SLOT_SHARE,
  PLATE_MISS_MIN_DAYS,
  PLATE_MISS_WINDOW_DAYS,
  PRIORITY,
  QUANTITY_MIN_SIGNALS,
  QUANTITY_WINDOW_DAYS,
  SHARE_SHIFT,
  VEGETABLE_BOOST_SCORE,
} from "./config.js";
import { addDays, groupBy, mean, reviewIds, round3, type RuleContext } from "./context.js";
import type { InsightReview, ProposalDraft } from "./types.js";

export type ShiftDirection = "away" | "toward";

export interface ShareShift {
  dayKind: DayKind;
  shares: { slotTypeId: string; share: number }[];
  from: number;
  to: number;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * The member's meal split for the day kind of `date`, with `SHARE_SHIFT` moved away from or toward
 * one slot and the other attended slots rescaled proportionally (SPEC-Q-4). Undefined when the
 * slot is not attended that day, is the only slot, or the shift would leave a slot below
 * `MIN_SLOT_SHARE`.
 */
export function shiftShare(
  ctx: RuleContext,
  memberId: string,
  date: string,
  slotTypeId: string,
  direction: ShiftDirection,
): ShareShift | undefined {
  let attended;
  try {
    attended = attendedSlots(ctx.input.config, memberId, date);
  } catch {
    return undefined;
  }
  const { dayKind, slots } = attended;
  const index = slots.findIndex((s) => s.id === slotTypeId);
  if (index < 0 || slots.length < 2) return undefined;
  const shares = slotShares(ctx.input.config, memberId, dayKind, slots);
  const from = shares[index] ?? 0;
  if (from >= 1) return undefined;
  const to = from + (direction === "toward" ? SHARE_SHIFT : -SHARE_SHIFT);
  const scale = (1 - to) / (1 - from);
  const next = shares.map((s, i) => (i === index ? to : s * scale));
  if (next.some((s) => s < MIN_SLOT_SHARE - 1e-9)) return undefined;
  const rounded = next.map(round4);
  // Put the rounding remainder on the largest other share so the split sums to exactly 1.
  const residual = round4(1 - rounded.reduce((a, b) => a + b, 0));
  if (residual !== 0) {
    let largest = index === 0 ? 1 : 0;
    rounded.forEach((s, i) => {
      if (i !== index && s > (rounded[largest] ?? 0)) largest = i;
    });
    rounded[largest] = round4((rounded[largest] ?? 0) + residual);
  }
  return {
    dayKind,
    shares: slots.map((slot, i) => ({ slotTypeId: slot.id, share: rounded[i] ?? 0 })),
    from: round4(from),
    to: rounded[index] ?? to,
  };
}

function distributionDraft(
  ctx: RuleContext,
  rule: "plate_misses" | "targeted_quantity",
  memberId: string,
  slotTypeId: string,
  shift: ShareShift,
  direction: ShiftDirection,
  why: string,
  evidence: ProposalDraft["evidence"],
  priority: number,
): ProposalDraft {
  const name = ctx.memberName(memberId);
  const slot = ctx.slotLabel(slotTypeId);
  const pct = (x: number) => `${round3(x * 100).toString()} %`;
  return {
    origin: "rule",
    rule,
    title: `${direction === "away" ? "Move calories away from" : "Move calories toward"} ${name}'s ${slot}`,
    rationale: `${why} Change ${name}'s ${shift.dayKind}-day share for ${slot} from ${pct(shift.from)} to ${pct(shift.to)}; the other meals rebalance and the daily targets stay the same.`,
    ops: [
      {
        kind: "distribution.set",
        payload: { memberId, dayKind: shift.dayKind, shares: shift.shares },
      },
    ],
    evidence,
    priority,
  };
}

/**
 * FBK-7 rule 4: a targeted member's plate at one slot is `infeasible` or `flexible_miss` on ≥ 3
 * distinct days in the last 14 → shift share away from the slot when the misses undershoot the
 * kcal target, toward it when they overshoot; nothing when the directions are mixed.
 */
export function plateMisses(ctx: RuleContext): ProposalDraft[] {
  const from = addDays(ctx.input.today, -(PLATE_MISS_WINDOW_DAYS - 1));
  const misses: { date: string; memberId: string; slotTypeId: string; kcal: number | null }[] = [];
  for (const meal of ctx.input.meals) {
    if (meal.date < from || meal.date > ctx.input.today) continue;
    for (const plate of meal.plates) {
      if (plate.fitStatus !== "infeasible" && plate.fitStatus !== "flexible_miss") continue;
      if (!ctx.isTargeted(plate.memberId) || !ctx.isActiveMember(plate.memberId)) continue;
      misses.push({
        date: meal.date,
        memberId: plate.memberId,
        slotTypeId: meal.slotTypeId,
        kcal: plate.kcalDeviation,
      });
    }
  }
  const out: ProposalDraft[] = [];
  const groups = groupBy(misses, (m) => {
    try {
      const { dayKind } = attendedSlots(ctx.input.config, m.memberId, m.date);
      return `${m.memberId}|${m.slotTypeId}|${dayKind}`;
    } catch {
      return undefined;
    }
  });
  for (const group of groups.values()) {
    const days = [...new Set(group.map((m) => m.date))].sort();
    const [first] = group;
    const latest = days.at(-1);
    if (first === undefined || latest === undefined || days.length < PLATE_MISS_MIN_DAYS) continue;
    const deviations = group.map((m) => m.kcal).filter((d): d is number => d !== null && d !== 0);
    if (deviations.length === 0) continue;
    const under = deviations.every((d) => d < 0);
    const over = deviations.every((d) => d > 0);
    if (!under && !over) continue;
    const direction: ShiftDirection = under ? "away" : "toward";
    const shift = shiftShare(ctx, first.memberId, latest, first.slotTypeId, direction);
    if (shift === undefined) continue;
    const meanDev = round3(mean(deviations));
    out.push(
      distributionDraft(
        ctx,
        "plate_misses",
        first.memberId,
        first.slotTypeId,
        shift,
        direction,
        `${ctx.memberName(first.memberId)}'s ${ctx.slotLabel(first.slotTypeId)} missed its target on ${days.length.toString()} of the last ${PLATE_MISS_WINDOW_DAYS.toString()} days, ${under ? "under" : "over"} by ${Math.abs(meanDev).toString()} kcal on average.`,
        {
          reviewIds: [],
          count: days.length,
          metrics: { missDays: days.length, meanKcalDeviation: meanDev },
        },
        PRIORITY.plateMisses,
      ),
    );
  }
  return out;
}

const HUNGRY_TAGS = ["too_little", "still_hungry"];

/**
 * FBK-5 for targeted members (their grams are fixed by targets): ≥ 2 `too_little`/`still_hungry`
 * in 14 days → prefer higher-volume plates (a member-level `component_role:vegetable` boost);
 * ≥ 2 `too_much` at one slot → shift share away from that slot.
 */
export function targetedQuantity(ctx: RuleContext): ProposalDraft[] {
  const recent = ctx
    .reviewsWithin(QUANTITY_WINDOW_DAYS)
    .filter((r) => ctx.isTargeted(r.memberId) && ctx.isActiveMember(r.memberId));
  const out: ProposalDraft[] = [];

  const hungry = recent.filter((r) => r.tags.some((t) => HUNGRY_TAGS.includes(t)));
  for (const [memberId, group] of groupBy(hungry, (r) => r.memberId)) {
    if (group.length < QUANTITY_MIN_SIGNALS) continue;
    const name = ctx.memberName(memberId);
    out.push({
      origin: "rule",
      rule: "targeted_quantity",
      title: `Give ${name} more filling plates`,
      rationale: `${name} said the portion was too little ${group.length.toString()} times in ${QUANTITY_WINDOW_DAYS.toString()} days. ${name}'s grams are set by targets, so prefer dishes with a bigger vegetable component (more volume for the same calories).`,
      ops: [
        {
          kind: "preference.set",
          payload: {
            memberId,
            entityType: "component_role",
            entityKey: "vegetable",
            score: VEGETABLE_BOOST_SCORE,
            source: "proposal",
          },
        },
      ],
      evidence: { reviewIds: reviewIds(group), count: group.length, metrics: {} },
      priority: PRIORITY.targetedQuantity,
    });
  }

  const tooMuch: { review: InsightReview; slotTypeId: string; date: string }[] = [];
  for (const review of recent) {
    if (!review.tags.includes("too_much")) continue;
    const meal = ctx.mealOf(review);
    if (meal !== undefined) tooMuch.push({ review, slotTypeId: meal.slotTypeId, date: meal.date });
  }
  for (const group of groupBy(tooMuch, (t) => `${t.review.memberId}|${t.slotTypeId}`).values()) {
    const [first] = group;
    const reviews = [...new Map(group.map((t) => [t.review.id, t.review])).values()];
    if (first === undefined || reviews.length < QUANTITY_MIN_SIGNALS) continue;
    const latest =
      group
        .map((t) => t.date)
        .sort()
        .at(-1) ?? first.date;
    const shift = shiftShare(ctx, first.review.memberId, latest, first.slotTypeId, "away");
    if (shift === undefined) continue;
    out.push(
      distributionDraft(
        ctx,
        "targeted_quantity",
        first.review.memberId,
        first.slotTypeId,
        shift,
        "away",
        `${ctx.memberName(first.review.memberId)} said ${ctx.slotLabel(first.slotTypeId)} was too much ${reviews.length.toString()} times in ${QUANTITY_WINDOW_DAYS.toString()} days.`,
        { reviewIds: reviewIds(reviews), count: reviews.length, metrics: {} },
        PRIORITY.targetedQuantity,
      ),
    );
  }
  return out;
}
