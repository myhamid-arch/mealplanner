// Reading stored proposals (FBK-8, FBK-9) for the Insights screen, the feed's assistant notes and
// the chat cards: the payload is `{ title, ops }` and the evidence `{ reviewIds, count, metrics }`
// (1.3.3); anything else is read defensively.
import type { z } from "zod";
import type { ProposalDto } from "@mealplanner/api-contract/contract";

export type Proposal = z.output<typeof ProposalDto>;

export interface ProposalOp {
  kind: string;
  payload: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function proposalTitle(p: Pick<Proposal, "payload" | "kind">): string {
  const title = isRecord(p.payload) ? p.payload.title : undefined;
  return typeof title === "string" && title.trim() !== "" ? title : p.kind;
}

export function proposalOps(p: Pick<Proposal, "payload">): ProposalOp[] {
  const ops = isRecord(p.payload) ? p.payload.ops : undefined;
  if (!Array.isArray(ops)) return [];
  return ops.flatMap((op) =>
    isRecord(op) && typeof op.kind === "string" && isRecord(op.payload)
      ? [{ kind: op.kind, payload: op.payload }]
      : [],
  );
}

export function evidenceReviewIds(evidence: unknown): string[] {
  if (!isRecord(evidence) || !Array.isArray(evidence.reviewIds)) return [];
  return evidence.reviewIds.filter((x): x is string => typeof x === "string");
}

/** The evidence size (distinct reviews, or miss days / meals), when recorded. */
export function evidenceCount(evidence: unknown): number | null {
  if (!isRecord(evidence)) return null;
  return typeof evidence.count === "number" ? evidence.count : null;
}

/** "3 reviews", "1 review", or null when the proposal carries no evidence. */
export function evidenceText(evidence: unknown): string | null {
  const ids = evidenceReviewIds(evidence);
  const n = ids.length > 0 ? ids.length : evidenceCount(evidence);
  if (n === null || n === 0) return null;
  return ids.length > 0
    ? `${String(n)} ${n === 1 ? "review" : "reviews"}`
    : `evidence ${String(n)}`;
}

export const PROPOSAL_BUDGET = 5;
export const PROPOSAL_EXPIRY_DAYS = 14;
