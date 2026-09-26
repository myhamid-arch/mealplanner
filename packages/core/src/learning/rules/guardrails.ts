// FBK-8 guardrails, applied to every draft before it is stored (leaf-1.3.3 ADR-1, BLD-8 R-33):
// Zod validation → protected ops → already satisfied → duplicate in the batch → pending duplicate
// → recently accepted → recently rejected (unless the evidence doubled) → pending budget.
import { getOp, type ParsedChangeOp } from "../../changes/index.js";
import type { ProposalOrigin, ProposalStatus } from "../../types/index.js";
import {
  ACCEPTANCE_COOLDOWN_DAYS,
  DAY_MS,
  EVIDENCE_MULTIPLIER,
  NEVER_PROPOSED_KINDS,
  PENDING_BUDGET,
  PROPOSAL_EXPIRY_DAYS,
  REJECTION_COOLDOWN_DAYS,
} from "./config.js";
import { fingerprintOf } from "./fingerprint.js";
import { isSatisfied, type SatisfactionState } from "./satisfied.js";
import { ProposalDraftSchema, type Evidence, type ProposalDraft, type RuleId } from "./types.js";

/** A stored proposal, as far as the guardrails need it. */
export interface ExistingProposal {
  id: string;
  origin: ProposalOrigin;
  status: ProposalStatus;
  fingerprint: string;
  evidenceCount: number;
  decidedAt: Date | null;
  expiresAt: Date;
}

export const DROP_REASONS = [
  "invalid",
  "protected",
  "satisfied",
  "duplicate",
  "pending",
  "recently_accepted",
  "recently_rejected",
  "budget",
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** A draft that passed validation, with its parsed ops and fingerprint. */
export interface CheckedDraft {
  origin: ProposalOrigin;
  rule?: RuleId;
  title: string;
  rationale: string;
  ops: ParsedChangeOp[];
  evidence: Evidence;
  priority: number;
  fingerprint: string;
}

export interface DroppedDraft {
  title: string;
  origin: ProposalOrigin;
  rule?: RuleId;
  fingerprint: string | null;
  reason: DropReason;
  detail: string;
}

export interface GuardrailInput {
  drafts: readonly ProposalDraft[];
  /** Pending proposals, and decided ones from the cooldown windows. */
  existing: readonly ExistingProposal[];
  state: SatisfactionState;
  now: Date;
  /**
   * AGT-5 check of one op against current state (the registry's `isProtected` through a ChangeTx).
   * Without it only statically protected ops are caught; the db service always passes it.
   */
  isProtected?: (op: ParsedChangeOp) => Promise<boolean>;
}

export interface GuardrailResult {
  kept: CheckedDraft[];
  dropped: DroppedDraft[];
}

/** The engine's own origins, which the budget counts and limits (R-33). */
export function isEngineOrigin(origin: ProposalOrigin): boolean {
  return origin === "rule" || origin === "insights";
}

/** FBK-8: pending proposals expire 14 days after they are made. */
export function proposalExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PROPOSAL_EXPIRY_DAYS * DAY_MS);
}

export function isExpired(proposal: Pick<ExistingProposal, "status" | "expiresAt">, now: Date) {
  return proposal.status === "pending" && proposal.expiresAt.getTime() <= now.getTime();
}

/** Priority, then evidence size, then synthesised before rule drafts, then title. */
function rank(a: CheckedDraft, b: CheckedDraft): number {
  return (
    b.priority - a.priority ||
    b.evidence.count - a.evidence.count ||
    Number(b.origin === "insights") - Number(a.origin === "insights") ||
    a.title.localeCompare(b.title) ||
    a.fingerprint.localeCompare(b.fingerprint)
  );
}

function staticallyProtected(op: ParsedChangeOp): boolean {
  return getOp(op.kind)?.protected === true;
}

async function protectedKind(
  draft: CheckedDraft,
  isProtected: GuardrailInput["isProtected"],
): Promise<string | undefined> {
  for (const op of draft.ops) {
    // R-10: never proposed, whatever the origin.
    if (NEVER_PROPOSED_KINDS.includes(op.kind)) return op.kind;
    // FBK-8: the engine never proposes a protected op; only the admin can ask for one in chat.
    if (!isEngineOrigin(draft.origin)) continue;
    if (staticallyProtected(op)) return op.kind;
    if (isProtected !== undefined && (await isProtected(op))) return op.kind;
  }
  return undefined;
}

export async function selectProposals(input: GuardrailInput): Promise<GuardrailResult> {
  const { now } = input;
  const dropped: DroppedDraft[] = [];
  const drop = (d: Omit<DroppedDraft, "fingerprint"> & { fingerprint?: string | null }) =>
    dropped.push({ ...d, fingerprint: d.fingerprint ?? null });

  // 1 Validation, 2 protection, 3 satisfied.
  const checked: CheckedDraft[] = [];
  for (const draft of input.drafts) {
    const parsed = ProposalDraftSchema.safeParse(draft);
    if (!parsed.success) {
      drop({
        title: typeof draft.title === "string" ? draft.title : "(untitled)",
        origin: draft.origin,
        ...(draft.rule === undefined ? {} : { rule: draft.rule }),
        reason: "invalid",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      continue;
    }
    const d = parsed.data;
    const c: CheckedDraft = {
      origin: d.origin,
      ...(d.rule === undefined ? {} : { rule: d.rule }),
      title: d.title,
      rationale: d.rationale,
      ops: d.ops,
      evidence: d.evidence,
      priority: d.priority,
      fingerprint: fingerprintOf(d.ops, input.state.config),
    };
    const base = {
      title: c.title,
      origin: c.origin,
      fingerprint: c.fingerprint,
      ...(c.rule === undefined ? {} : { rule: c.rule }),
    };
    const kind = await protectedKind(c, input.isProtected);
    if (kind !== undefined) {
      drop({ ...base, reason: "protected", detail: `${kind} is never proposed by ${c.origin}` });
      continue;
    }
    if (isSatisfied(c.ops, input.state)) {
      drop({ ...base, reason: "satisfied", detail: "the current settings already do this" });
      continue;
    }
    checked.push(c);
  }

  const live = input.existing.filter((p) => !isExpired(p, now));
  const pending = live.filter((p) => p.status === "pending");
  const within = (p: ExistingProposal, days: number) =>
    p.decidedAt !== null && now.getTime() - p.decidedAt.getTime() < days * DAY_MS;

  // 4 … 7, best-ranked drafts first so a duplicate keeps the strongest.
  checked.sort(rank);
  const seen = new Set<string>();
  const survivors: CheckedDraft[] = [];
  for (const c of checked) {
    const base = {
      title: c.title,
      origin: c.origin,
      fingerprint: c.fingerprint,
      ...(c.rule === undefined ? {} : { rule: c.rule }),
    };
    if (seen.has(c.fingerprint)) {
      drop({
        ...base,
        reason: "duplicate",
        detail: "a stronger draft in this run has the same fingerprint",
      });
      continue;
    }
    seen.add(c.fingerprint);
    if (pending.some((p) => p.fingerprint === c.fingerprint)) {
      drop({ ...base, reason: "pending", detail: "the same proposal is already pending" });
      continue;
    }
    const accepted = live.find(
      (p) =>
        p.status === "accepted" &&
        p.fingerprint === c.fingerprint &&
        within(p, ACCEPTANCE_COOLDOWN_DAYS),
    );
    if (accepted !== undefined) {
      drop({ ...base, reason: "recently_accepted", detail: `accepted as proposal ${accepted.id}` });
      continue;
    }
    const rejected = live
      .filter(
        (p) =>
          p.status === "rejected" &&
          p.fingerprint === c.fingerprint &&
          within(p, REJECTION_COOLDOWN_DAYS),
      )
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    if (rejected !== undefined) {
      const needed = Math.max(1, EVIDENCE_MULTIPLIER * rejected.evidenceCount);
      if (c.evidence.count < needed) {
        drop({
          ...base,
          reason: "recently_rejected",
          detail: `rejected as proposal ${rejected.id}; evidence ${c.evidence.count.toString()} < ${needed.toString()} needed`,
        });
        continue;
      }
    }
    survivors.push(c);
  }

  // 8 Budget: only the engine's own proposals count and are limited (R-33).
  let room = Math.max(0, PENDING_BUDGET - pending.filter((p) => isEngineOrigin(p.origin)).length);
  const kept: CheckedDraft[] = [];
  for (const c of survivors) {
    if (!isEngineOrigin(c.origin)) {
      kept.push(c);
      continue;
    }
    if (room > 0) {
      kept.push(c);
      room -= 1;
      continue;
    }
    drop({
      title: c.title,
      origin: c.origin,
      fingerprint: c.fingerprint,
      ...(c.rule === undefined ? {} : { rule: c.rule }),
      reason: "budget",
      detail: `at most ${PENDING_BUDGET.toString()} pending proposals; this one waits for a later run`,
    });
  }
  return { kept, dropped };
}
