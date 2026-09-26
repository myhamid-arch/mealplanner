// FBK-7 rule 3: a recipe note tag repeated ≥ 2 times on one dish (or one variant) → a recipe
// revision. While the registry has no revision op (RECIPE_REVISION_OP is null; BLD-8 R-33, W-2)
// the finding is a digest note, not a proposal.
import type { ChangeOp } from "../../changes/index.js";
import {
  PRIORITY,
  RECIPE_NOTE_MIN_REPEATS,
  RECIPE_NOTE_TAGS,
  RECIPE_REVISION_OP,
  REVIEW_WINDOW_DAYS,
} from "./config.js";
import { groupBy, reviewIds, type RuleContext } from "./context.js";
import type { InsightNote, InsightReview, ProposalDraft } from "./types.js";

const NOTE_TAGS: ReadonlySet<string> = new Set(RECIPE_NOTE_TAGS);

export interface RecipeNoteFinding {
  dishId: string;
  variantId: string | null;
  /** Each repeated tag and how many reviews carry it. */
  tags: Record<string, number>;
  reviews: InsightReview[];
  label: string;
}

/** The dish (and variant, for variant reviews) whose recipe a review's note tags are about. */
function subjectOf(ctx: RuleContext, review: InsightReview): string | undefined {
  if (review.targetType === "variant") {
    const found = ctx.variants.get(review.targetId);
    return found === undefined ? undefined : `${found.dish.id}#${found.variant.id}`;
  }
  return ctx.dishOf(review)?.id;
}

export function recipeNoteFindings(ctx: RuleContext): RecipeNoteFinding[] {
  const noted = ctx
    .reviewsWithin(REVIEW_WINDOW_DAYS)
    .filter((r) => r.tags.some((t) => NOTE_TAGS.has(t)));
  const out: RecipeNoteFinding[] = [];
  for (const [subject, group] of groupBy(noted, (r) => subjectOf(ctx, r))) {
    const counts = new Map<string, number>();
    for (const review of group)
      for (const tag of new Set(review.tags))
        if (NOTE_TAGS.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n >= RECIPE_NOTE_MIN_REPEATS).sort();
    if (repeated.length === 0) continue;
    const [dishId = subject, variantId = null] = subject.split("#");
    const dish = ctx.dishes.get(dishId);
    if (dish === undefined) continue;
    const variant = variantId === null ? undefined : ctx.variants.get(variantId)?.variant;
    const repeatedTags = new Set(repeated.map(([t]) => t));
    out.push({
      dishId,
      variantId,
      tags: Object.fromEntries(repeated),
      reviews: group.filter((r) => r.tags.some((t) => repeatedTags.has(t))),
      label: variant === undefined ? dish.name : `${dish.name} (${variant.label})`,
    });
  }
  return out;
}

function describe(finding: RecipeNoteFinding): { title: string; rationale: string } {
  const tags = Object.entries(finding.tags)
    .map(([tag, n]) => `${tag.replaceAll("_", " ")} ×${n.toString()}`)
    .join(", ");
  return {
    title: `Revise the recipe for ${finding.label}`,
    rationale: `Reviews repeat the same notes on ${finding.label}: ${tags}. Regenerate the recipe to address them.`,
  };
}

/** Rule 3 as digest notes (the current behaviour). */
export function recipeNotes(ctx: RuleContext): InsightNote[] {
  return recipeNoteFindings(ctx).map((f) => ({
    rule: "recipe_notes",
    ...describe(f),
    subject: { dishId: f.dishId, variantId: f.variantId, tags: f.tags },
    evidence: { reviewIds: reviewIds(f.reviews), count: f.reviews.length, metrics: {} },
  }));
}

/** Rule 3 as proposals, once a revision op exists (`opKind`, normally RECIPE_REVISION_OP). */
export function recipeRevisionProposals(
  ctx: RuleContext,
  opKind: string | null = RECIPE_REVISION_OP,
): ProposalDraft[] {
  if (opKind === null) return [];
  return recipeNoteFindings(ctx).map((f) => ({
    origin: "rule",
    rule: "recipe_notes",
    ...describe(f),
    // The op is validated by the registry's ChangeOpSchema in the guardrails, like every draft.
    ops: [
      {
        kind: opKind,
        payload: { dishId: f.dishId, variantId: f.variantId, notes: Object.keys(f.tags) },
      } as unknown as ChangeOp,
    ],
    evidence: { reviewIds: reviewIds(f.reviews), count: f.reviews.length, metrics: {} },
    priority: PRIORITY.recipeNotes,
  }));
}
