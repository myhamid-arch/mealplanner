"use client";

import type { Json } from "../proposals";
import { AppliedChangeCardView } from "./applied-change-card";
import { InsightDigestCardView } from "./insight-digest-card";
import { IterationLimitCardView } from "./iteration-limit-card";
import { JobProgressCardView } from "./job-progress-card";
import { MacroTableCardView } from "./macro-table-card";
import { parseCard } from "./parse";
import { PlanDayCardView } from "./plan-day-card";
import { ProposalCardView } from "./proposal-card";
import { RecipeCardView } from "./recipe-card";

/** One AGT-7 card, drawn from its structured payload; an unknown or malformed one says so. */
export function ChatCard({ value }: { readonly value: Json }) {
  const parsed = parseCard(value);
  if (!parsed.ok)
    return (
      <div
        className="rounded-card bg-flour px-3.5 py-3 text-sm font-bold text-ink-soft"
        data-card="unreadable"
        data-card-type={parsed.type}
      >
        This card can't be shown ({parsed.type.replace(/_/g, " ")}).
      </div>
    );
  const card = parsed.card;
  switch (card.type) {
    case "proposal":
      return <ProposalCardView card={card} />;
    case "applied_change":
      return <AppliedChangeCardView card={card} />;
    case "plan_day":
      return <PlanDayCardView card={card} />;
    case "recipe":
      return <RecipeCardView card={card} />;
    case "macro_table":
      return <MacroTableCardView card={card} />;
    case "job_progress":
      return <JobProgressCardView card={card} />;
    case "insight_digest":
      return <InsightDigestCardView card={card} />;
    case "iteration_limit":
      return <IterationLimitCardView card={card} />;
  }
}

export function ChatCards({ cards }: { readonly cards: readonly Json[] }) {
  return (
    <div className="flex flex-col gap-3">
      {cards.map((c, i) => (
        <ChatCard key={cardKey(c, i)} value={c} />
      ))}
    </div>
  );
}

function cardKey(c: Json, i: number): string {
  if (typeof c === "object" && c !== null && !Array.isArray(c)) {
    const id = c.proposalId ?? c.changeSetId ?? c.jobId ?? c.date ?? c.runAt;
    if (typeof id === "string") return `${typeof c.type === "string" ? c.type : "card"}-${id}-${String(i)}`;
  }
  return `card-${String(i)}`;
}
