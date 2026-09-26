// The insights run (FBK-7): rules over the household's reviews and plans, then LLM synthesis
// (injected, R-2), then the FBK-8 guardrails; survivors are stored as pending proposals and the
// reviews read are marked processed, in one household transaction. Returns the digest the caller
// posts to the admin's conversation (SPEC-Q-7).
import { and, eq, inArray } from "drizzle-orm";
import {
  INSIGHTS_REVIEW_TRIGGER,
  RuleContext,
  SYNTHESIS_REJECTED_LIMIT,
  fingerprintOf,
  runRules,
  type DroppedDraft,
  type InsightInput,
  type InsightNote,
  type InsightReview,
  type SynthesisDrop,
  type SynthesisInput,
  type SynthesisResult,
  type Synthesize,
} from "@mealplanner/core/learning/rules";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
import { review } from "../../schema/index.js";
import { inHouseholdTransaction } from "../changes/apply.js";
import { loadInsightInput } from "./load.js";
import { previewDrafts, storeDrafts, type ProposalRow } from "./store.js";

export const SYNTHESIS_NOT_WIRED =
  "insight synthesis is disabled: no synthesiser was configured for this run";

export interface RunInsightsOptions {
  /** FBK-7 stage 2; `synthesizeInsights` from @mealplanner/ai/insights, wired in apps/*. */
  synthesize?: Synthesize;
  now?: Date;
}

export interface InsightDigest {
  runAt: Date;
  /** Proposals stored by this run (pending). */
  stored: ProposalRow[];
  /** Drafts the guardrails dropped, with reasons. */
  dropped: DroppedDraft[];
  /** Findings that are not proposals (FBK-7 rule 3 while no revision op exists). */
  notes: InsightNote[];
  ruleCandidates: number;
  synthesis:
    | { status: "ok"; generationId: string; proposals: number; dropped: SynthesisDrop[] }
    | { status: "disabled"; reason: string }
    | { status: "failed"; code: string; message: string; generationId: string | null };
  reviewsProcessed: number;
}

/** FBK-7 trigger: ≥ 10 reviews not yet processed by an insights run. */
export async function insightsDue(db: Executor, ctx: HouseholdContext): Promise<boolean> {
  const rows = await createRepos(db, ctx).review.list({ processedAt: null });
  return rows.length >= INSIGHTS_REVIEW_TRIGGER;
}

/** A short label for what a review is about (dish names are scrubbed by the synthesiser). */
function about(ctx: RuleContext, r: InsightReview, labels: ReadonlyMap<string, string>): string {
  const dish = ctx.dishOf(r);
  if (r.targetType === "component") {
    const found = ctx.components.get(r.targetId);
    if (found !== undefined) return `${found.dish.name} — ${found.component.name}`;
  }
  if (r.targetType === "variant") {
    const found = ctx.variants.get(r.targetId);
    if (found !== undefined) return `${found.dish.name} — ${found.variant.label}`;
  }
  if (dish !== undefined) return dish.name;
  if (r.targetType === "ingredient") return labels.get(r.targetId) ?? "an ingredient";
  if (r.targetType === "cuisine" || r.targetType === "method")
    return `${r.targetType} ${r.targetId}`;
  return r.targetType.replace("_", " ");
}

async function synthesisInput(
  db: Executor,
  ctx: HouseholdContext,
  input: InsightInput,
  unprocessedIds: ReadonlySet<string>,
  rules: ReturnType<typeof runRules>,
  ingredientNames: ReadonlyMap<string, string>,
): Promise<SynthesisInput> {
  const rc = new RuleContext(input);
  const { config } = input;
  const weights = config.planningWeights;
  const r = createRepos(db, ctx);
  const rejected = (await r.proposal.list({ status: "rejected" }))
    .filter((p) => p.decidedAt !== null)
    .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))
    .slice(0, SYNTHESIS_REJECTED_LIMIT);
  const pending = await r.proposal.list({ status: "pending" });
  return {
    referenceDate: input.today,
    members: config.members
      .filter((m) => m.archivedAt === null)
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        birthYear: m.birthYear,
        isTargeted: m.isTargeted,
      })),
    candidates: rules.candidates,
    notes: rules.notes,
    reviews: input.reviews
      .filter((rv) => unprocessedIds.has(rv.id))
      .map((rv) => ({
        id: rv.id,
        memberId: rv.memberId,
        about: about(rc, rv, ingredientNames),
        rating: rv.rating,
        tags: rv.tags,
        comment: rv.comment,
      })),
    settings: {
      macroPrecision: weights.macroPrecision,
      appeal: weights.appeal,
      ingredientEconomy: weights.ingredientEconomy,
      variety: weights.variety,
      fairness: weights.fairness,
      aiGeneration: weights.aiGeneration,
      adjustersEnabled: weights.adjustersEnabled,
      pendingProposals: pending.length,
    },
    rejected: rejected.map((p) => ({
      title: (p.payload as { title?: unknown }).title?.toString() ?? p.kind,
      kind: p.kind,
      decisionNote: p.decisionNote,
      decidedAt: p.decidedAt?.toISOString() ?? "",
    })),
    references: {
      dishes: input.dishes.map((d) => ({ id: d.id, name: d.name })),
      ingredients: input.ingredients.map((i) => ({ id: i.id, slug: i.slug, name: i.name })),
      slots: config.slotTypes
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, key: s.key, label: s.label })),
    },
  };
}

async function synthesise(
  synthesize: Synthesize | undefined,
  input: () => Promise<SynthesisInput>,
): Promise<SynthesisResult> {
  if (synthesize === undefined)
    return {
      status: "disabled",
      reason: SYNTHESIS_NOT_WIRED,
      proposals: [],
      dropped: [],
      generationId: null,
    };
  try {
    return await synthesize(await input());
  } catch (error) {
    // The rule candidates are still stored; the failure is reported, never swallowed silently.
    return {
      status: "failed",
      code: "error",
      message: error instanceof Error ? error.message : String(error),
      proposals: [],
      dropped: [],
      generationId: null,
    };
  }
}

function synthesisSummary(result: SynthesisResult): InsightDigest["synthesis"] {
  switch (result.status) {
    case "ok":
      return {
        status: "ok",
        generationId: result.generationId,
        proposals: result.proposals.length,
        dropped: result.dropped,
      };
    case "disabled":
      return { status: "disabled", reason: result.reason };
    case "failed":
      return {
        status: "failed",
        code: result.code,
        message: result.message,
        generationId: result.generationId,
      };
  }
}

export async function runInsights(
  db: Executor,
  ctx: HouseholdContext,
  options: RunInsightsOptions = {},
): Promise<InsightDigest> {
  const now = options.now ?? new Date();
  const loaded = await loadInsightInput(db, ctx, now);
  const rules = runRules(loaded.input);
  const unprocessedIds = new Set(loaded.unprocessed.map((r) => r.id));
  const ingredientNames = new Map([...loaded.ingredientRows].map(([id, row]) => [id, row.name]));

  // Synthesis sees only the rule candidates that can still become proposals (not already pending,
  // satisfied, recently decided or protected); over-budget ones stay, since it may reprioritise.
  const preview = await previewDrafts(db, ctx, rules.candidates, now);
  const settled = new Set(
    preview.dropped.filter((d) => d.reason !== "budget").map((d) => d.fingerprint),
  );
  const live = rules.candidates.filter(
    (c) => !settled.has(fingerprintOf(c.ops, loaded.input.config)),
  );
  // The model call runs outside any database transaction.
  const synthesis = await synthesise(options.synthesize, () =>
    synthesisInput(
      db,
      ctx,
      loaded.input,
      unprocessedIds,
      { ...rules, candidates: live },
      ingredientNames,
    ),
  );

  const drafts = [...rules.candidates, ...synthesis.proposals];
  const { stored, dropped } = await inHouseholdTransaction(db, ctx, async (trx) => {
    const result = await storeDrafts(trx, ctx, drafts, now);
    if (unprocessedIds.size > 0)
      await trx
        .update(review)
        .set({ processedAt: now })
        .where(
          and(eq(review.householdId, ctx.householdId), inArray(review.id, [...unprocessedIds])),
        );
    return result;
  });

  return {
    runAt: now,
    stored,
    dropped,
    notes: rules.notes,
    ruleCandidates: rules.candidates.length,
    synthesis: synthesisSummary(synthesis),
    reviewsProcessed: unprocessedIds.size,
  };
}
