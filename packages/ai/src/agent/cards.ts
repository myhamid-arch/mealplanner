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

export interface JobProgressCard {
  type: "job_progress";
  jobId: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
}

export interface InsightDigestCard {
  type: "insight_digest";
  runAt: string;
  proposals: { id: string; kind: string; title: string; rationale: string }[];
  dropped: { title: string; reason: string }[];
  notes: Json[];
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
