"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { goToSignIn, isSignedOut, problemMessage } from "./api";

export type Load<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: T };

/**
 * Loads a screen's data (UX-7: skeleton, then the data or a plain-language error with a retry).
 * A 401 means the session ended (signed out, blocked or removed): the browser goes to sign-in.
 * `reload()` refetches without dropping the current data (no flash of skeleton).
 */
export function useLoad<T>(
  fetcher: () => Promise<T>,
  /** Values the fetcher reads; a change refetches (like a filter). */
  deps: readonly unknown[] = [],
): Load<T> & { reload: () => Promise<void> } {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const ref = useRef(fetcher);
  ref.current = fetcher;
  const reload = useCallback(async () => {
    try {
      const data = await ref.current();
      setState({ status: "ready", data });
    } catch (error) {
      if (isSignedOut(error)) {
        goToSignIn();
        return;
      }
      setState({ status: "error", message: problemMessage(error) });
    }
  }, []);
  useEffect(() => {
    void reload();
    // `deps` are the fetcher's inputs; the fetcher itself is read through the ref.
  }, [reload, ...deps]);
  return { ...state, reload };
}
