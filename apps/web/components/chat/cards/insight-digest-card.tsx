"use client";

import Link from "next/link";
import { useChatData } from "../context";
import { ProposalActions, type Decision } from "../proposal-actions";
import type { InsightDigestCard as Card } from "./parse";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** AGT-7 `insight_digest` (ChatPhoneDigest): the run's new proposals, each with Accept / Reject. */
export function InsightDigestCardView({ card }: { readonly card: Card }) {
  const { proposals, refresh } = useChatData();
  return (
    <div className="flex flex-col gap-3" data-card="insight_digest">
      <span className="self-center text-xs font-extrabold text-ink-soft">
        {WHEN.format(new Date(card.runAt))} · insights check-in
      </span>
      {card.proposals.map((p) => {
        const stored = proposals.get(p.id);
        const initial: Decision | "closed" =
          stored === undefined || stored.status === "pending"
            ? { state: "pending" }
            : stored.status === "accepted" && stored.changeSetId !== null
              ? { state: "accepted", changeSetId: stored.changeSetId }
              : stored.status === "rejected"
                ? { state: "rejected", note: stored.decisionNote }
                : "closed";
        return (
          <div
            key={p.id}
            className="flex flex-col gap-2 rounded-card border-2 border-agent bg-card p-3.5"
            data-proposal-id={p.id}
          >
            <span className="font-extrabold">{p.title}</span>
            <span className="text-[13px] text-ink-soft">{p.rationale}</span>
            {initial === "closed" ? (
              <span className="text-sm font-bold text-ink-soft">
                This proposal has {stored?.status}.
              </span>
            ) : (
              <ProposalActions
                key={`${p.id}-${initial.state}`}
                proposalId={p.id}
                title={p.title}
                initial={initial}
                layout="stacked"
                onChanged={() => refresh()}
              />
            )}
          </div>
        );
      })}
      {card.notes.map((n, i) => (
        <div
          key={`note-${String(i)}`}
          className="flex flex-col gap-1 rounded-card bg-card p-3.5 shadow-card"
        >
          <span className="font-extrabold">{n.title}</span>
          <span className="text-[13px] text-ink-soft">{n.rationale}</span>
        </div>
      ))}
      {card.dropped.length > 0 && (
        <span className="text-[13px] text-ink-soft">
          {card.dropped.length} more {card.dropped.length === 1 ? "idea was" : "ideas were"} held
          back ({[...new Set(card.dropped.map((d) => d.reason.replace(/_/g, " ")))].join(", ")}).{" "}
          <Link href="/insights#waiting">See Insights</Link>
        </span>
      )}
    </div>
  );
}
