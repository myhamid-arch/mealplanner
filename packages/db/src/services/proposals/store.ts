// Proposal storage with the FBK-8 guardrails (leaf-1.3.3 ADR-1, BLD-8 R-33): every draft — rule,
// insights or agent_chat — is stored only through `createProposals`, which runs the guardrails
// against the household's current state inside the household's change-set lock.
import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { isProtected, type ParsedChangeOp } from "@mealplanner/core/changes";
import {
  ACCEPTANCE_COOLDOWN_DAYS,
  DAY_MS,
  REJECTION_COOLDOWN_DAYS,
  proposalExpiry,
  selectProposals,
  type CheckedDraft,
  type DroppedDraft,
  type ExistingProposal,
  type ProposalDraft,
  type ProposalPayload,
} from "@mealplanner/core/learning/rules";
import type { HouseholdContext, Json, ProposalStatus } from "@mealplanner/core/types";
import { createRepos, createWriteRepos, type Executor, type TableRows } from "../../repos/index.js";
import { proposal } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";
import { inHouseholdTransaction } from "../changes/apply.js";
import { DbChangeTx } from "../changes/tx.js";
import { loadHouseholdConfig } from "../config/index.js";

export type ProposalRow = TableRows["proposal"];

const UUID_SCHEMA = z.uuid();

export interface CreateProposalsOptions {
  /** The run time; defaults to the system clock. */
  now?: Date;
  /** For agent_chat proposals: the conversation and message that made them. */
  conversationId?: string | null;
  messageId?: string | null;
}

export interface CreateProposalsResult {
  stored: ProposalRow[];
  dropped: DroppedDraft[];
}

/** Evidence size of a stored proposal (SPEC-Q-9). */
function evidenceCount(evidence: Json): number {
  const count = (evidence as { count?: unknown } | null)?.count;
  return typeof count === "number" ? count : 0;
}

/**
 * Marks pending proposals whose expiry has passed as `expired` (FBK-8: 14 days). Returns how many
 * changed.
 */
export async function expireProposals(
  db: Executor,
  ctx: HouseholdContext,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .update(proposal)
    .set({ status: "expired" })
    .where(
      and(
        eq(proposal.householdId, ctx.householdId),
        eq(proposal.status, "pending"),
        lte(proposal.expiresAt, now),
      ),
    )
    .returning({ id: proposal.id });
  return rows.length;
}

/** Pending proposals, and decided ones inside the cooldown windows, for the guardrails. */
async function existingProposals(
  db: Executor,
  ctx: HouseholdContext,
  now: Date,
): Promise<ExistingProposal[]> {
  const window = Math.max(ACCEPTANCE_COOLDOWN_DAYS, REJECTION_COOLDOWN_DAYS) * DAY_MS;
  const rows = await createRepos(db, ctx).proposal.list();
  return rows
    .filter(
      (p) =>
        p.status === "pending" ||
        (p.decidedAt !== null && now.getTime() - p.decidedAt.getTime() < window),
    )
    .map((p) => ({
      id: p.id,
      origin: p.origin,
      status: p.status,
      fingerprint: p.fingerprint,
      evidenceCount: evidenceCount(p.evidence),
      decidedAt: p.decidedAt,
      expiresAt: p.expiresAt,
    }));
}

/** Verified state of the ingredients named by `ingredient.verify` ops in the drafts. */
async function verifiedIngredients(
  db: Executor,
  ctx: HouseholdContext,
  drafts: readonly ProposalDraft[],
): Promise<Set<string>> {
  const r = createRepos(db, ctx);
  const verified = new Set<string>();
  for (const d of drafts)
    for (const op of d.ops) {
      if (op.kind !== "ingredient.verify") continue;
      // Only well-formed ids reach the database: a failed query would abort the transaction.
      // (Malformed drafts are dropped as invalid by the guardrails.)
      const id = UUID_SCHEMA.safeParse((op.payload as { ingredientId?: unknown }).ingredientId);
      if (!id.success) continue;
      const row = await r.ingredient.get({ id: id.data });
      if (row?.verifiedAt != null) verified.add(row.id);
    }
  return verified;
}

function payloadOf(draft: CheckedDraft): ProposalPayload {
  return { title: draft.title, ops: draft.ops };
}

/**
 * Runs the guardrails and stores the survivors, on an executor that already holds the household
 * lock (inside `inHouseholdTransaction`).
 */
export async function storeDrafts(
  trx: Executor,
  ctx: HouseholdContext,
  drafts: readonly ProposalDraft[],
  now: Date,
  options: Pick<CreateProposalsOptions, "conversationId" | "messageId"> = {},
): Promise<CreateProposalsResult> {
  await expireProposals(trx, ctx, now);
  const config = await loadHouseholdConfig(trx, ctx);
  const tx = new DbChangeTx(trx, ctx, now);
  const { kept, dropped } = await selectProposals({
    drafts,
    existing: await existingProposals(trx, ctx, now),
    state: { config, verifiedIngredientIds: await verifiedIngredients(trx, ctx, drafts) },
    now,
    // AGT-5 conditional checks (allergy relaxing, looser tolerance, reviewed dish) read state only.
    // A check that cannot read its row (another household's id) counts as protected.
    isProtected: (op: ParsedChangeOp) => isProtected(op, tx).catch(() => true),
  });
  const w = createWriteRepos(trx, ctx);
  const stored: ProposalRow[] = [];
  for (const draft of kept) {
    const [lead] = draft.ops;
    if (lead === undefined) continue;
    stored.push(
      await w.proposal.insert({
        id: newId(),
        householdId: ctx.householdId,
        origin: draft.origin,
        conversationId: options.conversationId ?? null,
        messageId: options.messageId ?? null,
        kind: lead.kind,
        payload: payloadOf(draft),
        rationale: draft.rationale,
        evidence: draft.evidence,
        fingerprint: draft.fingerprint,
        status: "pending",
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        changeSetId: null,
        expiresAt: proposalExpiry(now),
      }),
    );
  }
  return { stored, dropped };
}

/**
 * The guardrails without storing anything and without the household lock: which drafts would be
 * kept or dropped now. The insights run uses it to send synthesis only the rule candidates that
 * can still become proposals; `storeDrafts` decides again under the lock.
 */
export async function previewDrafts(
  db: Executor,
  ctx: HouseholdContext,
  drafts: readonly ProposalDraft[],
  now: Date,
): Promise<{ kept: CheckedDraft[]; dropped: DroppedDraft[] }> {
  const config = await loadHouseholdConfig(db, ctx);
  const tx = new DbChangeTx(db, ctx, now);
  return selectProposals({
    drafts,
    existing: await existingProposals(db, ctx, now),
    state: { config, verifiedIngredientIds: await verifiedIngredients(db, ctx, drafts) },
    now,
    isProtected: (op: ParsedChangeOp) => isProtected(op, tx).catch(() => true),
  });
}

/**
 * Stores proposals from any origin through the FBK-8 guardrails (1.3.5's `propose_change` uses
 * this with origin `agent_chat`). Dropped drafts are returned with their reasons.
 */
export async function createProposals(
  db: Executor,
  ctx: HouseholdContext,
  drafts: readonly ProposalDraft[],
  options: CreateProposalsOptions = {},
): Promise<CreateProposalsResult> {
  const now = options.now ?? new Date();
  return inHouseholdTransaction(db, ctx, (trx) => storeDrafts(trx, ctx, drafts, now, options));
}

/**
 * The household's proposals, newest first. `status: "pending"` leaves out pending rows whose
 * expiry has passed (they are marked expired by the next run or decision).
 */
export async function listProposals(
  db: Executor,
  ctx: HouseholdContext,
  options: { status?: ProposalStatus; now?: Date } = {},
): Promise<ProposalRow[]> {
  const now = options.now ?? new Date();
  const rows = await createRepos(db, ctx).proposal.list(
    options.status === undefined ? {} : { status: options.status },
  );
  return rows
    .filter((p) => !(p.status === "pending" && p.expiresAt.getTime() <= now.getTime()))
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime() || b.id.localeCompare(a.id));
}
