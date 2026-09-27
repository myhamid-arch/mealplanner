"use client";

import Link from "next/link";
import { useState } from "react";
import {
  changeSetsApply,
  changeSetsPreview,
  proposalsReject,
} from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../../admin/api";
import { FormError } from "../../admin/field";
import { Button } from "../../ui/button";
import { useChatData } from "../context";
import type { Description } from "../describe";
import { ChangeDiff } from "../diff";
import { ProposalActions, type Decision } from "../proposal-actions";
import {
  evidenceReviewIds,
  evidenceText,
  proposalOps,
  type Json,
  type ProposalOp,
} from "../proposals";
import { AppliedBody } from "./applied-change-card";
import type { ProposalCard as Card } from "./parse";

/** The decision a stored proposal already has (the card itself was stored as pending). */
function decisionOf(
  status: string | undefined,
  changeSetId: string | null,
  note: string | null,
): Decision | "closed" {
  if (status === "accepted" && changeSetId !== null) return { state: "accepted", changeSetId };
  if (status === "rejected") return { state: "rejected", note };
  if (status === "expired" || status === "superseded") return "closed";
  return { state: "pending" };
}

type Scalar = string | number | boolean | null;
const isScalar = (v: Json): v is Scalar =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();

/**
 * SPEC-Q-5: Edit opens the proposal's ops as a form of their scalar fields (ids and nested values
 * read-only), previews through `POST /change-sets/preview`, applies the edited ops as one change
 * set, then rejects the proposal with "Edited and applied".
 */
function EditOps({
  proposalId,
  title,
  ops,
  onDone,
  onCancel,
}: {
  readonly proposalId: string;
  readonly title: string;
  readonly ops: readonly ProposalOp[];
  readonly onDone: (changeSetId: string, descriptions: Description[]) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProposalOp[]>(() =>
    ops.map((o) => ({ ...o, payload: { ...o.payload } })),
  );
  const [preview, setPreview] = useState<Description[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { names, refresh } = useChatData();

  const set = (i: number, field: string, value: Scalar) => {
    setPreview(null);
    setDraft((d) =>
      d.map((o, j) => (j === i ? { ...o, payload: { ...o.payload, [field]: value } } : o)),
    );
  };

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const applied = await api.call(changeSetsApply, {
            body: { summary: `${title} (edited)`.slice(0, 200), ops: draft },
          });
          await api.call(proposalsReject, {
            params: { id: proposalId },
            body: { note: "Edited and applied" },
          });
          await refresh();
          onDone(applied.changeSetId, applied.descriptions);
        });
      }}
    >
      <span className="text-sm font-extrabold">Edit before applying</span>
      {draft.map((op, i) => (
        <fieldset key={`${op.kind}-${String(i)}`} className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[13px] font-extrabold text-ink-soft">{op.kind}</legend>
          {Object.entries(op.payload).map(([field, v]) => {
            const id = `edit-${proposalId}-${String(i)}-${field}`;
            if (!isScalar(v) || (typeof v === "string" && UUID.test(v)))
              return (
                <span key={field} className="text-[13px] text-ink-soft">
                  {words(field)}: {typeof v === "string" ? (names.get(v) ?? "(fixed)") : "(fixed)"}
                </span>
              );
            if (typeof v === "boolean")
              return (
                <label
                  key={field}
                  htmlFor={id}
                  className="flex min-h-11 items-center gap-2 text-sm font-bold"
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={v}
                    onChange={(e) => {
                      set(i, field, e.target.checked);
                    }}
                    className="size-[18px] accent-action"
                  />
                  {words(field)}
                </label>
              );
            return (
              <label key={field} htmlFor={id} className="flex flex-col gap-1 text-sm font-bold">
                {words(field)}
                <input
                  id={id}
                  type={typeof v === "number" ? "number" : "text"}
                  step="any"
                  value={v ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    set(
                      i,
                      field,
                      typeof v === "number"
                        ? raw === ""
                          ? null
                          : Number(raw)
                        : raw === "" && v === null
                          ? null
                          : raw,
                    );
                  }}
                  className="min-h-11 rounded-[10px] border-[1.5px] border-line-strong bg-card px-3 font-semibold text-ink"
                />
              </label>
            );
          })}
        </fieldset>
      ))}
      {preview !== null && <ChangeDiff descriptions={preview} names={names} />}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={busy && preview === null}
          onClick={() => {
            void run(async () => {
              setPreview(
                (await api.call(changeSetsPreview, { body: { ops: draft } })).descriptions ?? [],
              );
            });
          }}
        >
          Preview
        </Button>
        <Button type="submit" loading={busy && preview !== null}>
          Apply edited
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** AGT-7 `proposal`: title, rationale, before → after, evidence, Accept / Reject… / Edit. */
export function ProposalCardView({ card }: { readonly card: Card }) {
  const { names, proposals, refresh } = useChatData();
  const stored = proposals.get(card.proposalId);
  const initial = decisionOf(
    stored?.status,
    stored?.changeSetId ?? null,
    stored?.decisionNote ?? null,
  );
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<{ changeSetId: string; descriptions: Description[] } | null>(
    null,
  );
  const ops = stored === undefined ? [] : proposalOps(stored);
  const evidence = evidenceText(card.evidence);
  const reviews = evidenceReviewIds(card.evidence);

  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl border-2 border-agent bg-card p-4"
      data-card="proposal"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-full bg-aubergine-tint px-2.5 py-0.5 text-xs font-extrabold text-aubergine-text">
          PROPOSAL
        </span>
        <span className="font-extrabold">{card.title}</span>
      </div>
      <span className="text-sm text-ink-soft">{card.rationale}</span>
      <ChangeDiff descriptions={card.descriptions} names={names} />
      {evidence !== null && (
        <span className="text-[13px] text-ink-soft">
          Evidence: {reviews.length > 0 ? <Link href="/reviews">{evidence}</Link> : evidence}
        </span>
      )}
      {edited !== null ? (
        <AppliedBody
          changeSetId={edited.changeSetId}
          descriptions={edited.descriptions}
          badge="APPLIED · edited"
        />
      ) : editing ? (
        <EditOps
          proposalId={card.proposalId}
          title={card.title}
          ops={ops}
          onDone={(changeSetId, descriptions) => {
            setEditing(false);
            setEdited({ changeSetId, descriptions });
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : initial === "closed" ? (
        <span className="text-sm font-bold text-ink-soft">
          This proposal has {stored?.status ?? "closed"}.
        </span>
      ) : (
        <ProposalActions
          key={`${card.proposalId}-${initial.state}`}
          proposalId={card.proposalId}
          title={card.title}
          initial={initial}
          onChanged={() => refresh()}
          extra={
            ops.length > 0 ? (
              <Button
                variant="secondary"
                className="border-[1.5px] border-ink bg-card"
                onClick={() => {
                  setEditing(true);
                }}
                aria-label={`Edit: ${card.title}`}
              >
                Edit
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
