"use client";
// "Next week, if you save" (PlanningBalance.dc.html; UX-4 "with these weights, tomorrow would change
// 2 meals"; leaf-1.4.7 SPEC-Q-6/7). A second after the sliders stop, the draft weights are
// previewed for the next 7 days through `POST /plans/preview` (a worker job that writes no plan);
// the panel shows the proposed figures against the current ones and the meals that would change.
// "Save & replan" applies the weights and replans the same dates with the same seed, so the plan
// made is the plan previewed.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, applyChanges, c, problemText } from "../config/api";
import type { PlanPreview } from "./types";

/** The seed of the preview and of "Save & replan" (the same seed gives the same plan, PLN-11). */
export const PREVIEW_SEED = 1;
const DEBOUNCE_MS = 1000;
/** Change lines shown before "and n more". */
const SHOWN = 5;

export type PreviewWeights = {
  macroPrecision: number;
  appeal: number;
  ingredientEconomy: number;
  variety: number;
  fairness: number;
};

/** The 7 days from tomorrow in the household's time zone. */
export function nextWeek(timezone: string, now = new Date()): string[] {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1 + i);
    return d.toISOString().slice(0, 10);
  });
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Change = PlanPreview["changes"][number];

function changeText(ch: Change, names: ReadonlyMap<string, string>) {
  const when = `${DAY[new Date(`${ch.date}T12:00:00Z`).getUTCDay()] ?? ""} ${ch.slotLabel.toLowerCase()}`;
  const who = ch.memberScope === "shared" ? "" : ` (${names.get(ch.memberScope) ?? "own dish"})`;
  const lower = (s: string | undefined) => (s ?? "").toLowerCase();
  switch (ch.kind) {
    case "dish":
      return {
        lead: `${when}${who}: ${lower(ch.before?.dishName)} → `,
        strong: lower(ch.after?.dishName),
        tail: "",
      };
    case "variant":
      return {
        lead: `${when}: unchanged dish, `,
        strong: `${lower(ch.before?.variants.join(", "))} → ${lower(ch.after?.variants.join(", "))}`,
        tail: ch.memberId === null ? "" : ` for ${names.get(ch.memberId) ?? "one person"}`,
      };
    case "added":
      return { lead: `${when}${who}: new, `, strong: lower(ch.after?.dishName), tail: "" };
    case "removed":
      return { lead: `${when}${who}: `, strong: lower(ch.before?.dishName), tail: " not planned" };
  }
}

type State =
  | { kind: "working" }
  | { kind: "ready"; preview: PlanPreview }
  | { kind: "failed"; message: string };

export function PlanPreviewPanel({
  draft,
  saved,
  timezone,
  members,
  replanned,
  onReset,
  onSaved,
}: {
  readonly draft: PreviewWeights;
  readonly saved: PreviewWeights;
  readonly timezone: string;
  readonly members: readonly { id: string; displayName: string }[];
  /** "Save & replan" has queued the replan (kept by the screen across its reload). */
  readonly replanned: boolean;
  readonly onReset: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const [state, setState] = useState<State>({ kind: "working" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const run = useRef(0);
  const key = JSON.stringify(draft);
  const dirty = key !== JSON.stringify(saved);

  useEffect(() => {
    const id = ++run.current;
    const abort = new AbortController();
    setState({ kind: "working" });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { jobId } = await api.call(c.plansPreview, {
            body: {
              dates: nextWeek(timezone),
              weights: JSON.parse(key) as PreviewWeights,
              seed: PREVIEW_SEED,
            },
          });
          for await (const event of api.events(
            c.jobsEvents,
            { params: { id: jobId } },
            { signal: abort.signal },
          )) {
            if (id !== run.current) return;
            if (event.type === "done") {
              setState({ kind: "ready", preview: c.PlanPreviewDto.parse(event.payload) });
              return;
            }
            if (event.type === "failed" || event.type === "cancelled") {
              setState({ kind: "failed", message: "The preview could not be made." });
              return;
            }
          }
        } catch (e) {
          if (id === run.current && !abort.signal.aborted)
            setState({ kind: "failed", message: problemText(e) });
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key, timezone]);

  const save = async () => {
    setSaving(true);
    try {
      await applyChanges("Change planning weights", [{ kind: "weights.set", payload: draft }]);
      await api.call(c.plansGenerate, { body: { dates: nextWeek(timezone), seed: PREVIEW_SEED } });
      setSaveError(null);
      await onSaved();
    } catch (e) {
      setSaveError(problemText(e));
    } finally {
      setSaving(false);
    }
  };

  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const preview = state.kind === "ready" ? state.preview : null;
  const meals =
    preview === null
      ? 0
      : new Set(preview.changes.map((ch) => `${ch.date}|${ch.slotKey}|${ch.memberScope}`)).size;
  const delta =
    preview === null
      ? 0
      : preview.proposed.distinctIngredients - preview.current.distinctIngredients;

  return (
    <section
      aria-labelledby="preview-title"
      aria-busy={state.kind === "working"}
      data-surface="rail"
      data-preview={state.kind}
      className="flex w-full shrink-0 flex-col gap-3.5 rounded-[20px] bg-rail p-[22px] text-rail-ink-strong lg:w-[360px]"
    >
      <h2 id="preview-title" className="m-0 text-[22px] text-rail-ink-strong">
        Next week, if you save
      </h2>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col rounded-[14px] bg-rail-raised p-3">
          <span className="text-xs font-extrabold text-rail-ink-muted">Different ingredients</span>
          <span className="tabular font-mono text-2xl" data-metric="ingredients">
            {preview === null ? "–" : preview.proposed.distinctIngredients}{" "}
            {preview !== null && delta !== 0 && (
              <span className="text-sm text-rail-ink">
                <span className="sr-only">, </span>
                {delta > 0 ? "+" : "−"}
                {Math.abs(delta)}
                <span className="sr-only"> against the current plan</span>
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-col rounded-[14px] bg-rail-raised p-3">
          <span className="text-xs font-extrabold text-rail-ink-muted">Meals on target</span>
          <span className="tabular font-mono text-2xl" data-metric="on-target">
            {preview?.proposed.inTolerancePct == null
              ? "–"
              : `${String(preview.proposed.inTolerancePct)}%`}
          </span>
        </div>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.kind === "working" && (
          <span className="text-[13px] font-extrabold text-rail-ink-muted">
            Working out next week…
          </span>
        )}
        {state.kind === "failed" && (
          <span role="alert" className="text-[13px] font-extrabold text-rail-ink-strong">
            {state.message}
          </span>
        )}
        {preview !== null && (
          <>
            <span className="text-[13px] font-extrabold text-rail-ink-muted" data-changes={meals}>
              {meals === 0
                ? "No meals would change"
                : `${String(meals)} ${meals === 1 ? "meal" : "meals"} would change`}
            </span>
            {preview.changes.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {preview.changes.slice(0, SHOWN).map((ch) => {
                  const t = changeText(ch, names);
                  return (
                    <li
                      key={`${ch.date}|${ch.slotKey}|${ch.memberScope}|${ch.memberId ?? ""}`}
                      className="rounded-xl bg-rail-raised p-2.5"
                    >
                      {t.lead}
                      <strong>{t.strong}</strong>
                      {t.tail}
                    </li>
                  );
                })}
                {preview.changes.length > SHOWN && (
                  <li className="text-[13px] text-rail-ink-muted">
                    and {preview.changes.length - SHOWN} more
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="mt-1 flex gap-2.5">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onReset}
          className="min-h-[46px] grow rounded-xl border-[1.5px] border-rail-ink-muted bg-transparent font-extrabold text-rail-ink-strong disabled:opacity-60"
        >
          Reset
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="min-h-[46px] grow rounded-xl bg-action font-extrabold text-on-action disabled:opacity-60"
        >
          Save &amp; replan
        </button>
      </div>
      {replanned && (
        <Link href="/plan" className="text-sm font-extrabold text-rail-ink-strong underline">
          Replanning next week: open the plan
        </Link>
      )}
      {saveError !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-rail-ink-strong">
          {saveError}
        </p>
      )}
    </section>
  );
}
