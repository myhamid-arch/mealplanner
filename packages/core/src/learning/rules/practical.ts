// FBK-3 practical tags (W-23, R-82, R-83). The packing tags (`hard_to_pack`, `went_soggy_in_box`,
// `cold_is_bad`) on ≥ 2 reviews of one dish eaten at packed slots propose a household `dish`
// exclusion scoped to the household's packed slots: the dish stays on the menu elsewhere. Seed
// dishes are global, so the dish itself is never edited. `took_too_long` has no slot meaning and
// becomes a digest note. Proposals go through the FBK-8 guardrails like every other rule's.
import type { SlotTypeRow } from "../../types/index.js";
import {
  PACKING_TAGS,
  PRACTICAL_EXCLUSION_REASON,
  PRACTICAL_MIN_REVIEWS,
  PRIORITY,
  REVIEW_WINDOW_DAYS,
  SLOW_TAG,
} from "./config.js";
import { groupBy, reviewIds, type RuleContext } from "./context.js";
import type { InsightNote, InsightReview, ProposalDraft } from "./types.js";

const PACKING: ReadonlySet<string> = new Set(PACKING_TAGS);

/** Tag counts over reviews, for the rationale and the evidence metrics (sorted by tag). */
function tagCounts(reviews: readonly InsightReview[], tags: ReadonlySet<string>) {
  const counts = new Map<string, number>();
  for (const r of reviews)
    for (const tag of new Set(r.tags))
      if (tags.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

const words = (tag: string) => tag.replaceAll("_", " ");

/** The household's active packed slots, by key. */
function packedSlots(ctx: RuleContext): SlotTypeRow[] {
  return ctx.input.config.slotTypes
    .filter((s) => s.active && s.isPacked)
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The dish a packing review is about, when it was eaten at a packed slot: the review's meal (its
 * `plan_meal` context or target) must be in a packed slot and serve that dish (SPEC-Q-5). A review
 * without a meal cannot show the dish came out of a box.
 */
function packedDishId(
  ctx: RuleContext,
  review: InsightReview,
  packed: ReadonlySet<string>,
): string | undefined {
  const meal = ctx.mealOf(review);
  const dish = ctx.dishOf(review);
  if (meal === undefined || dish === undefined || meal.dishId !== dish.id) return undefined;
  return packed.has(meal.slotTypeId) ? dish.id : undefined;
}

/** FBK-3 packing tags → a `dish` exclusion scoped to the packed slots (a proposal). */
export function practicalPacking(ctx: RuleContext): ProposalDraft[] {
  const slots = packedSlots(ctx);
  if (slots.length === 0) return [];
  // Reviews may come from a packed slot that is no longer active; any packed slot counts.
  const everPacked = new Set(ctx.input.config.slotTypes.filter((s) => s.isPacked).map((s) => s.id));
  const tagged = ctx
    .reviewsWithin(REVIEW_WINDOW_DAYS)
    .filter((r) => r.tags.some((t) => PACKING.has(t)));
  const slotKeys = slots.map((s) => s.key);
  const where = slots.map((s) => s.label).join(" and ");
  const out: ProposalDraft[] = [];
  for (const [dishId, group] of groupBy(tagged, (r) => packedDishId(ctx, r, everPacked))) {
    const reviews = [...new Map(group.map((r) => [r.id, r])).values()];
    const dish = ctx.dishes.get(dishId);
    if (dish === undefined || reviews.length < PRACTICAL_MIN_REVIEWS) continue;
    const counts = tagCounts(reviews, PACKING);
    const said = Object.entries(counts)
      .map(([tag, n]) => `${words(tag)} ×${n.toString()}`)
      .join(", ");
    out.push({
      origin: "rule",
      rule: "practical_packing",
      title: `Keep ${dish.name} out of ${where}`,
      rationale: `${reviews.length.toString()} reviews of ${dish.name} from packed meals said: ${said}. Stop planning it for ${where}; it stays on the menu at other meals.`,
      ops: [
        {
          kind: "exclusion.add",
          payload: {
            memberId: null,
            kind: "dish",
            key: dish.id,
            reason: PRACTICAL_EXCLUSION_REASON,
            hard: false,
            slotKeys,
          },
        },
      ],
      evidence: { reviewIds: reviewIds(reviews), count: reviews.length, metrics: counts },
      priority: PRIORITY.practical,
    });
  }
  return out;
}

/** FBK-3 `took_too_long` on ≥ 2 reviews of one dish, at any slot → a digest note, no op (SPEC-Q-4). */
export function practicalNotes(ctx: RuleContext): InsightNote[] {
  const slow = ctx.reviewsWithin(REVIEW_WINDOW_DAYS).filter((r) => r.tags.includes(SLOW_TAG));
  const out: InsightNote[] = [];
  for (const [dishId, group] of groupBy(slow, (r) => ctx.dishOf(r)?.id)) {
    const reviews = [...new Map(group.map((r) => [r.id, r])).values()];
    const dish = ctx.dishes.get(dishId);
    if (dish === undefined || reviews.length < PRACTICAL_MIN_REVIEWS) continue;
    out.push({
      rule: "practical_time",
      title: `${dish.name} takes too long`,
      rationale: `${reviews.length.toString()} reviews said ${dish.name} took too long to make. Keep it for days with more time, or ask for a quicker version.`,
      subject: { dishId, tags: { [SLOW_TAG]: reviews.length } },
      evidence: { reviewIds: reviewIds(reviews), count: reviews.length, metrics: {} },
    });
  }
  return out;
}
