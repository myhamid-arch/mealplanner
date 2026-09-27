"use client";
// Small building blocks shared by the onboarding, family and settings screens.
import type { ReactNode } from "react";
import { WEEKDAY_SHORT } from "@mealplanner/core/onboarding";

/** A white recipe-card section with a Fraunces heading and an optional header control. */
export function Section({
  id,
  title,
  control,
  children,
  className = "",
  headingLevel = 2,
}: {
  readonly id?: string;
  readonly title: ReactNode;
  readonly control?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      id={id}
      aria-labelledby={id === undefined ? undefined : `${id}-title`}
      className={`flex min-w-0 scroll-mt-6 flex-col gap-3.5 rounded-2xl bg-card p-4 shadow-card sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Heading id={id === undefined ? undefined : `${id}-title`} className="text-[22px]">
          {title}
        </Heading>
        {control}
      </div>
      {children}
    </section>
  );
}

/** Seven toggle buttons, Monday first (weekday 0 = Monday, R-24). */
export function WeekdayPicker({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: readonly number[];
  readonly onChange: (days: number[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {WEEKDAY_SHORT.map((day, i) => {
        const on = value.includes(i);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange(on ? value.filter((d) => d !== i) : [...value, i].sort((a, b) => a - b));
            }}
            className={`min-h-11 min-w-11 rounded-md px-2 text-sm font-extrabold ${
              on ? "bg-ink text-paper" : "bg-flour text-ink-soft"
            }`}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}

/** A status line under a form: saving, saved, or a plain-language error (UX-7). */
export function SaveStatus({
  error,
  saved,
}: {
  readonly error: string | null;
  readonly saved?: boolean;
}) {
  if (error !== null)
    return (
      <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
        {error}
      </p>
    );
  return (
    <p role="status" className="m-0 min-h-5 text-sm text-ink-soft">
      {saved === true ? "Saved. It's in the change log, where you can undo it." : ""}
    </p>
  );
}

export function LoadingBlock({ label }: { readonly label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only-focusable">{label}</span>
      <div className="h-8 w-48 rounded-md bg-flour skeleton-pulse" />
      <div className="h-40 rounded-2xl bg-flour skeleton-pulse" />
      <div className="h-40 rounded-2xl bg-flour skeleton-pulse" />
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl bg-pomegranate-tint p-5 text-pomegranate-text"
    >
      <p className="m-0 font-extrabold">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-md bg-card px-4 font-extrabold text-ink"
      >
        Try again
      </button>
    </div>
  );
}

/** Numbers typed by people: "1,655" or " 180 " → 1655 / 180; empty → null. */
export function readNumber(text: string): number | null {
  const t = text.replace(/[, ]/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}
