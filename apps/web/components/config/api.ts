"use client";
// Client data access for the configuration screens: the typed client from @mealplanner/api-contract
// (ARC-5: one contract), same-origin with the session cookie. Every configuration write is one
// `POST /change-sets` of registry ops (DM-6).
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiProblem, createApiClient } from "@mealplanner/api-contract/client";
import * as c from "@mealplanner/api-contract/contract";
import type { ChangeOp } from "@mealplanner/core/changes";
import type { Json as JsonValue } from "@mealplanner/core/types";

export const api = createApiClient({ baseUrl: "" });
export { c };

/** Applies ops as one change set; returns the change-set id. */
export async function applyChanges(summary: string, ops: readonly ChangeOp[]): Promise<string> {
  const res = await api.call(c.changeSetsApply, {
    // ChangeOp payloads are JSON (they are parsed with ChangeOpSchema on the server).
    body: { summary: summary.slice(0, 200), ops: [...ops] as unknown as JsonValue[] },
  });
  return res.changeSetId;
}

/** A plain-language message for a failed call (UX-7). */
export function problemText(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.problem.status === 401) return "Your session has ended. Sign in again.";
    if (error.problem.status === 403) return "Only an admin of this household can do that.";
    return error.problem.detail ?? error.problem.title;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Loads with `load` on mount and on `reload()`; keeps the last data while reloading. */
export function useLoad<T>(load: () => Promise<T>): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader.current());
      setError(null);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
