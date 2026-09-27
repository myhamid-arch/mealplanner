"use client";
// R2-DL-1 … R2-DL-6: the same Basic · Detailed · Expert control in every configurable section's
// header, scoped to that section and member, persisted per (member, section); a one-line hint says
// what the next level adds; lowering the level while your own values would be hidden asks
// "Keep them, just hide" or "Reset to automatic"; "Tell the assistant" hands the change to chat.
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, c, problemText } from "../config/api";
import { SegmentedControl } from "../ui/segmented-control";
import { LEVEL_LABEL, LEVELS, levelRank, type Level } from "./logic";

/** Persists the level of one section; the shown level changes at once, the write follows. */
export function useDetailLevel(memberId: string | null, section: string, stored: Level) {
  const [level, setLevel] = useState<Level>(stored);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLevel(stored);
  }, [stored]);
  const change = async (next: Level) => {
    setLevel(next);
    try {
      await api.call(c.detailLevelsSet, { body: { memberId, section, level: next } });
      setError(null);
    } catch (e) {
      setError(problemText(e));
    }
  };
  return { level, change, error };
}

export interface DetailControlProps {
  /** e.g. "Omar's targets": the control is named "Detail level for Omar's targets". */
  readonly scope: string;
  readonly level: Level;
  readonly onLevel: (level: Level) => Promise<void>;
  /** R2-DL-2: what the level adds, one line per level. */
  readonly hints: Readonly<Record<Level, string>>;
  /** How many of your own values the given (lower) level would hide. */
  readonly hiddenAt?: (level: Level) => number;
  /** Ops that reset what the given level hides back to automatic; applied on "Reset". */
  readonly onReset?: (level: Level) => Promise<void>;
  readonly error?: string | null;
}

/** The segmented control, its hint and the keep/reset prompt (render in the section header). */
export function DetailControl({
  scope,
  level,
  onLevel,
  hints,
  hiddenAt,
  onReset,
  error,
}: DetailControlProps) {
  const [pending, setPending] = useState<Level | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  useEffect(() => {
    if (pending !== null) promptRef.current?.focus();
  }, [pending]);
  const pick = (next: Level) => {
    if (levelRank(next) < levelRank(level) && (hiddenAt?.(next) ?? 0) > 0) {
      setPending(next);
      return;
    }
    setPending(null);
    void onLevel(next);
  };
  const keep = async () => {
    if (pending === null) return;
    const next = pending;
    setPending(null);
    await onLevel(next);
  };
  const reset = async () => {
    if (pending === null) return;
    setBusy(true);
    try {
      await onReset?.(pending);
      const next = pending;
      setPending(null);
      await onLevel(next);
      setFailure(null);
    } catch (e) {
      setFailure(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2" data-detail-control={scope}>
      <SegmentedControl
        label={`Detail level for ${scope}`}
        options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
        value={pending ?? level}
        onValueChange={pick}
      />
      <p id={hintId} className="m-0 text-sm text-ink-soft" data-detail-hint>
        {hints[level]}
      </p>
      {pending !== null && (
        <div
          ref={promptRef}
          tabIndex={-1}
          role="group"
          aria-label="Your changes"
          data-detail-prompt
          className="flex flex-wrap items-center gap-3 rounded-lg bg-saffron-tint p-3 text-saffron-text outline-none"
        >
          <span className="grow font-extrabold">
            You changed some of these yourself. What should happen to them?
          </span>
          <button
            type="button"
            onClick={() => void keep()}
            className="min-h-11 rounded-md bg-ink px-4 font-extrabold text-paper"
          >
            Keep them, just hide
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void reset()}
            className="min-h-11 rounded-md border-[1.5px] border-ink bg-card px-4 font-extrabold text-ink"
          >
            Reset to automatic
          </button>
        </div>
      )}
      {(error ?? failure) !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error ?? failure}
        </p>
      )}
    </div>
  );
}

export type ValueState = "auto" | "yours" | "hidden";

export interface AutoTagProps {
  readonly state: ValueState;
  /** Whether the level lets you set this value yourself (R2-DL-4: Detailed or higher). */
  readonly editable: boolean;
  /** The value's name, for screen readers: "breakfast share". */
  readonly what: string;
  readonly onEdit?: () => void;
  readonly onBackToAuto?: () => void;
}

/**
 * R2-DL-3/4: automatic values always carry `auto`; a value you set is `yours` with "Back to
 * auto"; kept-but-hidden values say so.
 */
export function AutoTag({ state, editable, what, onEdit, onBackToAuto }: AutoTagProps) {
  const base = "inline-flex min-h-8 w-fit items-center rounded-full px-2.5 text-xs font-extrabold";
  if (state === "yours" && editable && onBackToAuto !== undefined)
    return (
      <button
        type="button"
        data-dl="yours"
        onClick={onBackToAuto}
        aria-label={`${what}: yours. Back to auto`}
        className={`${base} min-h-11 bg-action text-on-action`}
      >
        Yours · back to auto
      </button>
    );
  if (state === "yours")
    return (
      <span data-dl="yours" className={`${base} bg-action text-on-action`}>
        yours
      </span>
    );
  if (state === "hidden")
    return (
      <span data-dl="hidden" className={`${base} bg-flour text-ink-soft`}>
        Yours (hidden)
      </span>
    );
  if (editable && onEdit !== undefined)
    return (
      <button
        type="button"
        data-dl="auto"
        onClick={onEdit}
        aria-label={`${what}: automatic. Tap to change`}
        className={`${base} min-h-11 bg-flour text-ink-soft`}
      >
        auto · tap to change
      </button>
    );
  return (
    <span data-dl="auto" className={`${base} bg-flour text-ink-soft`}>
      auto
    </span>
  );
}

/** R2-DL-6: "tell the assistant" (leaf-1.4.3 SPEC-Q-16). */
export function TellAssistant({
  prompt,
  children,
}: {
  readonly prompt: string;
  readonly children?: ReactNode;
}) {
  return (
    <Link href={`/chat?prompt=${encodeURIComponent(prompt)}`} className="text-sm font-extrabold">
      {children ?? "Tell the assistant"}
    </Link>
  );
}
