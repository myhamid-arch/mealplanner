"use client";

import Link from "next/link";
import { useState } from "react";
import {
  changeSetsUndo,
  proposalsAccept,
  proposalsReject,
} from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../admin/api";
import { FormError } from "../admin/field";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { Stamp } from "./stamp";

export type Decision =
  | { state: "pending" }
  | { state: "accepted"; changeSetId: string }
  | { state: "undone" }
  | { state: "rejected"; note: string | null };

/**
 * Accept / Reject… for one proposal (FBK-9, AGT-7): Accept applies its ops as one change set and
 * turns into Undo; Reject asks for an optional one-line reason (fed back to the insights engine).
 * `layout="stacked"` is the phone digest's two equal buttons.
 */
export function ProposalActions({
  proposalId,
  title,
  initial = { state: "pending" },
  layout = "row",
  onChanged,
  extra,
}: {
  readonly proposalId: string;
  /** For accessible names ("Accept: Never plan freekeh for Adam"). */
  readonly title: string;
  readonly initial?: Decision;
  readonly layout?: "row" | "stacked";
  readonly onChanged?: (d: Decision) => void | Promise<void>;
  /** More buttons after Accept (the chat card's Edit). */
  readonly extra?: React.ReactNode;
}) {
  const [decision, setDecision] = useState<Decision>(initial);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(what: string, work: () => Promise<Decision>) {
    setBusy(what);
    setError(null);
    try {
      const d = await work();
      setDecision(d);
      await onChanged?.(d);
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const accept = () =>
    run("accept", async () => {
      const r = await api.call(proposalsAccept, { params: { id: proposalId } });
      return { state: "accepted", changeSetId: r.changeSetId };
    });
  const reject = () =>
    run("reject", async () => {
      const trimmed = note.trim();
      await api.call(proposalsReject, {
        params: { id: proposalId },
        body: trimmed === "" ? {} : { note: trimmed },
      });
      setRejecting(false);
      return { state: "rejected", note: trimmed === "" ? null : trimmed };
    });
  const undo = (changeSetId: string) =>
    run("undo", async () => {
      await api.call(changeSetsUndo, { params: { id: changeSetId } });
      return { state: "undone" };
    });

  if (decision.state === "accepted")
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Stamp>
            <Chip tone="basil" icon="check" size="sm">
              Accepted
            </Chip>
          </Stamp>
          <Button
            variant="secondary"
            className="border-[1.5px] border-ink bg-card"
            loading={busy === "undo"}
            onClick={() => {
              void undo(decision.changeSetId);
            }}
            aria-label={`Undo: ${title}`}
          >
            Undo
          </Button>
          <Link href="/changelog" className="px-1.5 text-sm font-extrabold">
            In change log
          </Link>
        </div>
        <FormError>{error}</FormError>
      </div>
    );
  if (decision.state === "undone")
    return (
      <Chip tone="neutral" icon="refresh" size="sm">
        Accepted, then undone
      </Chip>
    );
  if (decision.state === "rejected")
    return (
      <Chip tone="neutral" icon="cross" size="sm">
        {decision.note === null ? "Rejected" : `Rejected: “${decision.note}”`}
      </Chip>
    );

  const grow = layout === "stacked" ? "grow" : "";
  return (
    <div className="flex flex-col gap-2">
      {rejecting ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void reject();
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-extrabold">
            Why not? (optional, one line)
            <input
              type="text"
              value={note}
              maxLength={200}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              className="min-h-11 rounded-[10px] border-[1.5px] border-line-strong bg-card px-3 font-semibold text-ink"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" loading={busy === "reject"}>
              Reject
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRejecting(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            className={grow}
            loading={busy === "accept"}
            disabled={busy !== null}
            onClick={() => {
              void accept();
            }}
            aria-label={`Accept: ${title}`}
          >
            Accept
          </Button>
          {extra}
          <Button
            variant="secondary"
            className={`border-[1.5px] border-line-strong bg-card ${grow}`}
            disabled={busy !== null}
            onClick={() => {
              setRejecting(true);
            }}
            aria-label={`Reject: ${title}`}
          >
            Reject…
          </Button>
        </div>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}
