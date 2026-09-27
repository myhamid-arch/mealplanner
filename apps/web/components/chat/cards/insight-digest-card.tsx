"use client";

import Link from "next/link";
import { useState } from "react";
import { changeSetsUndo } from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../../admin/api";
import { FormError } from "../../admin/field";
import { Button } from "../../ui/button";
import { Chip } from "../../ui/chip";
import { useChatData } from "../context";
import { ProposalActions, type Decision } from "../proposal-actions";
import type { InsightDigestCard as Card } from "./parse";

type Automatic = Card["automatic"][number];

/**
 * One change learning made without asking (FBK-5; W-9a, ChatPhoneDigest "Done automatically"):
 * what changed, and Undo through the change log's undo (the state is read back from the log).
 */
function AutomaticChange({ item }: { readonly item: Automatic }) {
  const { changes, refresh } = useChatData();
  const known = changes.get(item.changeSetId);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUndone = undone || (known === undefined ? item.undone : known.undone);
  const blocked = !isUndone && known !== undefined && !known.undoAvailable;
  return (
    <div
      className="flex flex-col gap-1.5 rounded-card border-[1.5px] border-sea bg-card p-3.5"
      data-automatic-change={item.changeSetId}
    >
      <span className="self-start rounded-full bg-sea-tint px-2 py-0.5 text-[11px] font-extrabold text-sea-text">
        DONE AUTOMATICALLY
      </span>
      <span className="text-sm">{item.title}.</span>
      {item.detail !== item.title && (
        <span className="text-[13px] text-ink-soft">{item.detail}.</span>
      )}
      {isUndone ? (
        <Chip tone="neutral" icon="refresh" size="sm">
          Undone
        </Chip>
      ) : (
        <Button
          variant="secondary"
          className="self-start border-[1.5px] border-ink bg-card! hover:bg-flour!"
          loading={busy}
          disabled={blocked}
          aria-label={`Undo: ${item.title}`}
          onClick={() => {
            setBusy(true);
            setError(null);
            void api
              .call(changeSetsUndo, { params: { id: item.changeSetId } })
              .then(async () => {
                setUndone(true);
                await refresh();
              })
              .catch((err: unknown) => {
                setError(problemMessage(err));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          Undo
        </Button>
      )}
      {blocked && known.reason !== null && (
        <span className="text-[13px] text-ink-soft">Can't undo: {known.reason}</span>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * AGT-7 `insight_digest` (ChatPhoneDigest): the run's new proposals, each with Accept / Reject,
 * then what was done automatically since the previous digest, each with Undo (W-9a).
 */
export function InsightDigestCardView({ card }: { readonly card: Card }) {
  const { proposals, changes, refresh } = useChatData();
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
              ? changes.get(stored.changeSetId)?.undone === true
                ? { state: "undone" }
                : { state: "accepted", changeSetId: stored.changeSetId }
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
      {card.automatic.map((a) => (
        <AutomaticChange key={a.changeSetId} item={a} />
      ))}
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
          {/* Underlined: inside running text a link must not rely on colour alone (axe
          link-in-text-block). */}
          <Link href="/insights#waiting" className="underline">
            See Insights
          </Link>
        </span>
      )}
    </div>
  );
}
