"use client";
// The assistant's reading of an onboarding answer (R2-ONB-3 "Free text is parsed with Claude using
// structured output. The parse result is shown for confirmation."; leaf-1.4.7 SPEC-Q-5). The
// page's deterministic parse stays the answer; 800 ms after typing stops, the text is sent to
// `POST /onboarding/parse`, and when the assistant reads it differently the page shows its reading
// with "Use this reading" and "Keep mine". Nothing changes until the admin taps Use this reading,
// and editing the text drops it. Without a credential (503) or on any error nothing is shown.
import { useEffect, useRef, useState } from "react";
import { ApiProblem } from "@mealplanner/api-contract/client";
import {
  targetsText,
  type NeverEatItem,
  type PersonAnswer,
  type TargetNumbers,
  type TargetParse,
} from "@mealplanner/core/onboarding";
import { api, c } from "../config/api";
import type { OnboardingParse } from "./types";

export const PARSE_DEBOUNCE_MS = 800;

type Field = "people" | "targets" | "never_eat";
type Reading = { text: string; value: OnboardingParse };

export interface ModelReadings {
  /** The assistant's reading of `text` under `key`, once it has one. */
  reading(key: string, text: string): OnboardingParse | undefined;
  /** The reading the admin accepted for exactly this text. */
  accepted(key: string, text: string): OnboardingParse | undefined;
  /** Whether the admin chose to keep their own reading of this text. */
  kept(key: string, text: string): boolean;
  accept(key: string): void;
  keep(key: string): void;
  /**
   * R-88: "reading" while the assistant may still answer for `text`, "ready" once it has, "off"
   * when it cannot (no credential, or its reading of this text failed or was refused).
   */
  status(key: string, text: string): "reading" | "ready" | "off";
}

/** Readings of several answers of one field (`key` → text; targets are one text per person). */
export function useModelReadings(
  field: Field,
  texts: Readonly<Record<string, string>>,
  people: readonly string[] = [],
  /** R-88: the people's ages, same order, for `never_eat`. */
  ages: readonly (number | null)[] = [],
): ModelReadings {
  const [readings, setReadings] = useState<ReadonlyMap<string, Reading>>(new Map());
  const [accepted, setAccepted] = useState<ReadonlyMap<string, Reading>>(new Map());
  const [kept, setKept] = useState<ReadonlyMap<string, string>>(new Map());
  // No credential (503): stop asking for this page view.
  const unavailable = useRef(false);
  const [off, setOff] = useState(false);
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  const latest = useRef(texts);
  latest.current = texts;
  const textsKey = JSON.stringify(texts);
  const peopleKey = JSON.stringify([people, ages]);

  useEffect(() => {
    const current = JSON.parse(textsKey) as Record<string, string>;
    const [names, years] = JSON.parse(peopleKey) as [string[], (number | null)[]];
    const timers = Object.entries(current)
      .filter(([, text]) => text.trim() !== "" && text.length <= 2000)
      .map(([key, text]) =>
        setTimeout(() => {
          if (unavailable.current) return;
          void api
            .call(c.onboardingParse, {
              body: {
                field,
                text,
                ...(field === "never_eat" ? { people: names, ages: years } : {}),
              },
            })
            .then((value) => {
              if (latest.current[key] !== text) return;
              setReadings((m) => new Map(m).set(key, { text, value }));
            })
            .catch((e: unknown) => {
              if (e instanceof ApiProblem && e.problem.status === 503) {
                unavailable.current = true;
                setOff(true);
              } else setFailed((m) => new Map(m).set(key, text));
            });
        }, PARSE_DEBOUNCE_MS),
      );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [field, textsKey, peopleKey]);

  const of = (m: ReadonlyMap<string, Reading>, key: string, text: string) => {
    const r = m.get(key);
    return r !== undefined && r.text === text ? r.value : undefined;
  };
  return {
    reading: (key, text) => of(readings, key, text),
    accepted: (key, text) => of(accepted, key, text),
    kept: (key, text) => kept.get(key) === text,
    accept: (key) => {
      const r = readings.get(key);
      if (r !== undefined && latest.current[key] === r.text)
        setAccepted((m) => new Map(m).set(key, r));
    },
    keep: (key) => {
      const text = latest.current[key];
      if (text !== undefined) setKept((m) => new Map(m).set(key, text));
    },
    status: (key, text) => {
      if (of(readings, key, text) !== undefined) return "ready";
      if (off || text.trim() === "" || text.length > 2000 || failed.get(key) === text) return "off";
      return "reading";
    },
  };
}

/** "The assistant read this as …" with Use this reading / Keep mine (SPEC-Q-5). */
export function ParseConfirm({
  label,
  lines,
  onUse,
  onKeep,
}: {
  /** What was read, for the accessible name ("the people", "Omar's numbers"). */
  readonly label: string;
  readonly lines: readonly string[];
  readonly onUse: () => void;
  readonly onKeep: () => void;
}) {
  return (
    <section
      aria-label={`The assistant's reading of ${label}`}
      data-parse-confirm={label}
      className="flex flex-col gap-2 rounded-xl border-[1.5px] border-aubergine bg-aubergine-tint p-3.5 text-ink"
    >
      <span className="text-sm font-extrabold text-aubergine-text">The assistant read this as</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUse}
          className="min-h-11 rounded-lg bg-agent px-4 font-extrabold text-on-agent"
        >
          Use this reading
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="min-h-11 rounded-lg border-[1.5px] border-ink bg-card px-4 font-extrabold text-ink"
        >
          Keep mine
        </button>
      </div>
    </section>
  );
}

export interface ReadingEntry<T> {
  key: string;
  text: string;
  /** What was read, for the accessible name. */
  label: string;
  /** The page's own (deterministic) reading of the text. */
  mine: T;
}

type Kind =
  | { field: "people"; lines: (v: PersonAnswer[]) => string[] }
  | { field: "targets"; lines: (v: TargetNumbers) => string[] }
  | { field: "never_eat"; lines: (v: NeverEatItem[]) => string[] };

function modelValue(field: Field, r: OnboardingParse): unknown {
  if (field === "people" && "people" in r) return r.people;
  if (field === "targets" && "targets" in r) return r.targets.ok ? r.targets : undefined;
  if (field === "never_eat" && "neverEat" in r) return r.neverEat;
  return undefined;
}

/** The value a confirmed reading gives an answer, or the page's own reading. */
export function readingOr<T>(
  field: Field,
  readings: ModelReadings,
  key: string,
  text: string,
  mine: T,
): T {
  const r = readings.accepted(key, text);
  const v = r === undefined ? undefined : modelValue(field, r);
  return v === undefined ? mine : (v as T);
}

/** One confirmation block per answer the assistant read differently (SPEC-Q-5). */
export function ModelParseConfirm<T>({
  kind,
  readings,
  entries,
}: {
  readonly kind: Kind;
  readonly readings: ModelReadings;
  readonly entries: readonly ReadingEntry<T>[];
}) {
  return (
    <>
      {entries.map((e) => {
        const r = readings.reading(e.key, e.text);
        if (r === undefined || readings.accepted(e.key, e.text) !== undefined) return null;
        if (readings.kept(e.key, e.text)) return null;
        const v = modelValue(kind.field, r);
        if (v === undefined || JSON.stringify(v) === JSON.stringify(e.mine)) return null;
        const lines =
          kind.field === "people"
            ? kind.lines(v as PersonAnswer[])
            : kind.field === "targets"
              ? kind.lines((v as Extract<TargetParse, { ok: true }>).value)
              : kind.lines(v as NeverEatItem[]);
        return (
          <ParseConfirm
            key={e.key}
            label={e.label}
            lines={lines.length === 0 ? ["Nothing to read"] : lines}
            onUse={() => {
              readings.accept(e.key);
            }}
            onKeep={() => {
              readings.keep(e.key);
            }}
          />
        );
      })}
    </>
  );
}

/** Lines of the assistant's reading, in the words the questions use. */
export const READING_LINES = {
  people: (people: PersonAnswer[]) =>
    people.map(
      (p) =>
        `${p.name}${p.age === null ? "" : `, ${String(p.age)}`}${p.sex === null || p.sex === "unspecified" ? "" : `, ${p.sex}`}`,
    ),
  targets: (t: TargetNumbers) => [
    `${targetsText(t)} (total carbs)`,
    ...(t.training === undefined ? [] : [`Training days: ${targetsText(t.training)}`]),
  ],
};
