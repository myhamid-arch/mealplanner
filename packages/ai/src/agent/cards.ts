// Chat cards (AGT-7): rendered by the UI from structured tool results, never parsed from text.
import type { ChangeDescription } from "@mealplanner/core/changes";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const CARD_TYPES = [
  "proposal",
  "applied_change",
  "plan_day",
  "recipe",
  "macro_table",
  "job_progress",
  "insight_digest",
  "iteration_limit",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export interface ProposalCard {
  type: "proposal";
  proposalId: string;
  title: string;
  rationale: string;
  /** Before → after per op, from the registry's `describe` (AGT-7). */
  descriptions: ChangeDescription[];
  evidence: Json;
  status: "pending";
}

export interface AppliedChangeCard {
  type: "applied_change";
  changeSetId: string;
  summary: string;
  descriptions: ChangeDescription[];
  appliedAt: string;
}

export interface PlanDayCard {
  type: "plan_day";
  date: string;
  meals: Json[];
}

export interface RecipeCard {
  type: "recipe";
  jobId: string;
  /** Draft dishes (not saved; Save applies `dish.create`, REC-6) with per-attendee example plates. */
  dishes: Json[];
  rejected: Json[];
}

export interface MacroTableCard {
  type: "macro_table";
  date: string;
  rows: Json[];
}

/** A finished plan announced in Updates (W-9b, leaf-1.4.9 SPEC-Q-5): ChatPhoneDigest's row. */
export interface PlanReady {
  title: string;
  /** Short facts, shown joined by " · " ("All meals on target", "3 packed school lunches"). */
  facts: string[];
  href: string;
  action: string;
}

export interface JobProgressCard {
  type: "job_progress";
  jobId: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
  /** Optional (W-9b): a succeeded plan job no agent turn started. */
  ready?: PlanReady;
}

/** A `learning` change set applied without a proposal (FBK-5; W-9a, leaf-1.4.9 SPEC-Q-1). */
export interface AutomaticChange {
  changeSetId: string;
  title: string;
  /** The change set's summary ("Learned from Zayd's review of …"). */
  detail: string;
  appliedAt: string;
  /** Undone when the digest was posted (the card reads the live state from the change log). */
  undone: boolean;
}

export interface InsightDigestCard {
  type: "insight_digest";
  runAt: string;
  proposals: { id: string; kind: string; title: string; rationale: string }[];
  dropped: { title: string; reason: string }[];
  notes: Json[];
  /** Optional (W-9a): "Done automatically" since the previous digest. Older digests lack it. */
  automatic?: AutomaticChange[];
}

export interface IterationLimitCard {
  type: "iteration_limit";
  limit: number;
  ran: { name: string; ok: boolean }[];
  notRun: { name: string }[];
}

export type Card =
  | ProposalCard
  | AppliedChangeCard
  | PlanDayCard
  | RecipeCard
  | MacroTableCard
  | JobProgressCard
  | InsightDigestCard
  | IterationLimitCard;

/** Cards as stored JSON (dates and descriptions are plain values). */
export function cardJson(card: Card): Json {
  return JSON.parse(JSON.stringify(card)) as Json;
}
