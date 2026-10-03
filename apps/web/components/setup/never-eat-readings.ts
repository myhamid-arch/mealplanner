"use client";
// R-88: question 5 read statement by statement. The answer is split into statements
// (`splitStatements`); each is sent to the assistant once, 1 s after typing stops, with the whole
// answer as context. A statement's reading and the answers to its questions stay under its
// normalised text, so editing or adding other statements never re-reads it or asks again. Without
// a credential (503), or when one reading fails or is refused, that statement falls back to the
// deterministic parse.
import { useEffect, useRef, useState } from "react";
import { ApiProblem } from "@mealplanner/api-contract/client";
import type {
  NeverEatItem,
  NeverEatQuestion,
  NeverEatStatement,
} from "@mealplanner/core/onboarding";
import { api, c } from "../config/api";

export const STATEMENT_DEBOUNCE_MS = 1000;

export interface NeverReading {
  neverEat: NeverEatItem[];
  questions: NeverEatQuestion[];
  unclear: { who: string; said: string; why: string }[];
}

export type StatementState =
  /** Typed; read once typing stops. */
  | { status: "waiting" }
  | { status: "reading" }
  | { status: "read"; reading: NeverReading }
  /** No assistant for this page view (503), or its reading of this statement failed. */
  | { status: "fallback"; why: "unavailable" | "failed" };

export interface NeverEatReadings {
  state(statement: NeverEatStatement): StatementState;
  /** The option chosen for each of a statement's questions; undefined until answered. */
  picks(statement: NeverEatStatement): readonly (number | undefined)[];
  pick(statement: NeverEatStatement, question: number, option: number | undefined): void;
  retry(statement: NeverEatStatement): void;
}

export function useNeverEatReadings(
  statements: readonly NeverEatStatement[],
  people: readonly string[],
  ages: readonly (number | null)[],
  context: string,
): NeverEatReadings {
  // Readings are per statement and per set of people: a renamed person reads everything again.
  const peopleKey = JSON.stringify([people, ages]);
  const keyOf = (s: NeverEatStatement) => `${peopleKey}\u0000${s.key}`;
  const [states, setStates] = useState<ReadonlyMap<string, StatementState>>(new Map());
  const [picks, setPicks] = useState<ReadonlyMap<string, (number | undefined)[]>>(new Map());
  const [unavailable, setUnavailable] = useState(false);
  // Bumped by "Try again", so the reading effect runs for the statement it cleared.
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<string>());
  const latestContext = useRef(context);
  latestContext.current = context;
  const statementsKey = JSON.stringify(statements.map((s) => [s.key, s.text]));

  useEffect(() => {
    if (unavailable) return;
    const [names, years] = JSON.parse(peopleKey) as [string[], (number | null)[]];
    const list = JSON.parse(statementsKey) as [string, string][];
    const timer = setTimeout(() => {
      for (const [key, text] of list) {
        const id = `${peopleKey}\u0000${key}`;
        if (requested.current.has(id)) continue;
        requested.current.add(id);
        setStates((m) => new Map(m).set(id, { status: "reading" }));
        void api
          .call(c.onboardingParse, {
            body: {
              field: "never_eat",
              text,
              context: latestContext.current.slice(0, 2000),
              people: names,
              ages: years,
            },
          })
          .then((value) => {
            const reading: NeverReading | undefined =
              "neverEat" in value
                ? {
                    neverEat: value.neverEat,
                    questions: value.questions ?? [],
                    unclear: value.unclear ?? [],
                  }
                : undefined;
            setStates((m) =>
              new Map(m).set(
                id,
                reading === undefined
                  ? { status: "fallback", why: "failed" }
                  : { status: "read", reading },
              ),
            );
          })
          .catch((e: unknown) => {
            if (e instanceof ApiProblem && e.problem.status === 503) setUnavailable(true);
            setStates((m) => new Map(m).set(id, { status: "fallback", why: "failed" }));
          });
      }
    }, STATEMENT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [statementsKey, peopleKey, unavailable, attempt]);

  return {
    state: (s) => {
      const st = states.get(keyOf(s));
      if (st?.status === "read") return st;
      if (unavailable) return { status: "fallback", why: "unavailable" };
      return st ?? { status: "waiting" };
    },
    picks: (s) => picks.get(keyOf(s)) ?? [],
    pick: (s, question, option) => {
      const id = keyOf(s);
      setPicks((m) => {
        const next = [...(m.get(id) ?? [])];
        next[question] = option;
        return new Map(m).set(id, next);
      });
    },
    retry: (s) => {
      const id = keyOf(s);
      requested.current.delete(id);
      setStates((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
      setAttempt((n) => n + 1);
    },
  };
}

/**
 * The rules a statement adds now: what its reading settles, plus the chosen option of each
 * answered question (an unanswered question adds nothing until it is answered).
 */
export function statementItems(
  state: StatementState,
  picks: readonly (number | undefined)[],
  fallback: () => NeverEatItem[],
): NeverEatItem[] {
  if (state.status === "fallback") return fallback();
  if (state.status !== "read") return [];
  return [
    ...state.reading.neverEat,
    ...state.reading.questions.flatMap((q, i) => {
      const p = picks[i];
      return p === undefined ? [] : (q.options[p]?.items ?? []);
    }),
  ];
}

/** Questions of a statement still waiting for an answer. */
export function openQuestions(
  state: StatementState,
  picks: readonly (number | undefined)[],
): number {
  if (state.status !== "read") return 0;
  return state.reading.questions.filter((_, i) => picks[i] === undefined).length;
}
