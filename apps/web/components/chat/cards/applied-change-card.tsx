"use client";

import Link from "next/link";
import { useState } from "react";
import { changeSetsUndo } from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../../admin/api";
import { FormError } from "../../admin/field";
import { Button } from "../../ui/button";
import { Chip } from "../../ui/chip";
import { useChatData } from "../context";
import type { Description } from "../describe";
import { ChangeDiff } from "../diff";
import type { AppliedChangeCard as Card } from "./parse";

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The body of an applied change: badge, diff, Undo and the change-log link. */
export function AppliedBody({
  changeSetId,
  summary,
  descriptions,
  appliedAt,
  badge = "APPLIED · you asked",
}: {
  readonly changeSetId: string;
  readonly summary?: string;
  readonly descriptions: readonly Description[];
  readonly appliedAt?: string;
  readonly badge?: string;
}) {
  const { names, changes, refresh } = useChatData();
  const known = changes.get(changeSetId);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUndone = undone || known?.undone === true;
  const blocked = !isUndone && known !== undefined && !known.undoAvailable;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-full bg-sea-tint px-2.5 py-0.5 text-xs font-extrabold text-sea-text">
          {badge}
        </span>
        {summary !== undefined && <span className="font-extrabold">{summary}</span>}
        {appliedAt !== undefined && (
          <span className="ml-auto text-[13px] text-ink-soft">
            {TIME.format(new Date(appliedAt))}
          </span>
        )}
      </div>
      <ChangeDiff descriptions={descriptions} names={names} />
      {isUndone ? (
        <Chip tone="neutral" icon="refresh" size="sm">
          Undone
        </Chip>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="border-[1.5px] border-ink bg-card"
            loading={busy}
            disabled={blocked}
            aria-label={`Undo: ${summary ?? "this change"}`}
            onClick={() => {
              setBusy(true);
              setError(null);
              void api
                .call(changeSetsUndo, { params: { id: changeSetId } })
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
          <Link href="/changelog" className="px-1.5 text-sm font-extrabold">
            In change log
          </Link>
        </div>
      )}
      {blocked && known.reason !== null && (
        <span className="text-[13px] text-ink-soft">Can't undo: {known.reason}</span>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}

/** AGT-7 `applied_change`: summary, diff, Undo and a timestamp. */
export function AppliedChangeCardView({ card }: { readonly card: Card }) {
  return (
    <div className="rounded-xl border-[1.5px] border-sea bg-card p-4" data-card="applied_change">
      <AppliedBody
        changeSetId={card.changeSetId}
        summary={card.summary}
        descriptions={card.descriptions}
        appliedAt={card.appliedAt}
      />
    </div>
  );
}
