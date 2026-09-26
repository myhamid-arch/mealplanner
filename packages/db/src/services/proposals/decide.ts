// FBK-9: accepting a proposal applies its ops as one change set (source `proposal_accept`, DM-6);
// rejecting records an optional one-line reason, which later runs feed back to synthesis.
import { and, eq } from "drizzle-orm";
import { ProposalPayloadSchema } from "@mealplanner/core/learning/rules";
import type { HouseholdContext } from "@mealplanner/core/types";
import type { Executor } from "../../repos/index.js";
import { createWriteRepos } from "../../repos/index.js";
import { proposal } from "../../schema/index.js";
import { applyChangeSet, type AppliedChangeSet } from "../changes/index.js";
import { inHouseholdTransaction } from "../changes/apply.js";
import {
  ProposalNotFoundError,
  ProposalPayloadError,
  ProposalPermissionError,
  ProposalStateError,
} from "./errors.js";
import type { ProposalRow } from "./store.js";

/** FBK-9: "an optional one-line reason". */
export const MAX_DECISION_NOTE_LENGTH = 500;

export interface DecisionOptions {
  now?: Date;
}

export interface AcceptResult {
  proposal: ProposalRow;
  changeSet: AppliedChangeSet;
}

function actingUser(ctx: HouseholdContext): string {
  if (ctx.userId === null)
    throw new ProposalPermissionError("a proposal is decided by a signed-in admin");
  return ctx.userId;
}

/**
 * Locks the proposal row (after the household lock, the order every change-set writer uses) and
 * checks it is still pending and unexpired.
 */
async function lockPending(
  trx: Executor,
  ctx: HouseholdContext,
  proposalId: string,
  now: Date,
): Promise<ProposalRow> {
  const [row] = await trx
    .select()
    .from(proposal)
    .where(and(eq(proposal.id, proposalId), eq(proposal.householdId, ctx.householdId)))
    .for("update");
  if (row === undefined) throw new ProposalNotFoundError(proposalId);
  if (row.status !== "pending") throw new ProposalStateError(proposalId, row.status);
  if (row.expiresAt.getTime() <= now.getTime()) throw new ProposalStateError(proposalId, "expired");
  return row;
}

export async function acceptProposal(
  db: Executor,
  ctx: HouseholdContext,
  proposalId: string,
  options: DecisionOptions = {},
): Promise<AcceptResult> {
  const userId = actingUser(ctx);
  const now = options.now ?? new Date();
  return inHouseholdTransaction(db, ctx, async (trx) => {
    const row = await lockPending(trx, ctx, proposalId, now);
    const payload = ProposalPayloadSchema.safeParse(row.payload);
    if (!payload.success)
      throw new ProposalPayloadError(
        proposalId,
        payload.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    const changeSet = await applyChangeSet(trx, ctx, {
      actor: "user",
      source: "proposal_accept",
      summary: payload.data.title,
      ops: payload.data.ops,
    });
    const updated = await createWriteRepos(trx, ctx).proposal.update(
      { id: proposalId },
      {
        status: "accepted",
        decidedByUserId: userId,
        decidedAt: now,
        changeSetId: changeSet.changeSetId,
      },
    );
    return { proposal: updated, changeSet };
  });
}

export async function rejectProposal(
  db: Executor,
  ctx: HouseholdContext,
  proposalId: string,
  note?: string | null,
  options: DecisionOptions = {},
): Promise<ProposalRow> {
  const userId = actingUser(ctx);
  const now = options.now ?? new Date();
  const trimmed = note?.replace(/\s+/g, " ").trim() ?? "";
  if (trimmed.length > MAX_DECISION_NOTE_LENGTH)
    throw new RangeError(
      `a decision note has at most ${MAX_DECISION_NOTE_LENGTH.toString()} characters`,
    );
  return inHouseholdTransaction(db, ctx, async (trx) => {
    await lockPending(trx, ctx, proposalId, now);
    return createWriteRepos(trx, ctx).proposal.update(
      { id: proposalId },
      {
        status: "rejected",
        decidedByUserId: userId,
        decidedAt: now,
        decisionNote: trimmed === "" ? null : trimmed,
      },
    );
  });
}
