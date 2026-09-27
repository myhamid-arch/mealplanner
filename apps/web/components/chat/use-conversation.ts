"use client";

// One conversation: its stored rows, sending a message as a streamed turn (AGT-2/AGT-7, ADR-2),
// the problems before a turn starts (409 turn_in_progress, 429 over the hourly limit, 503 no
// assistant; each its own state), and proactive `event` rows (re-read when a job of this
// conversation ends, when the page becomes visible again, and every 30 s while it is visible).
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiProblem } from "@mealplanner/api-contract/client";
import {
  conversationMessages,
  conversationsCreate,
  conversationsSend,
} from "@mealplanner/api-contract/contract";
import { api, goToSignIn, isSignedOut, problemMessage } from "../admin/api";
import { IDLE, reduce, type Live, type Row } from "./turn";

export type SendProblem =
  | { kind: "busy"; message: string }
  | { kind: "limit"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "other"; message: string };

/** A problem answered before any event was streamed, as the chat shows it. */
export function sendProblem(error: unknown): SendProblem {
  if (error instanceof ApiProblem) {
    if (error.status === 409)
      return {
        kind: "busy",
        message:
          "A reply to this conversation is still running. Wait for it to finish, then send again.",
      };
    if (error.status === 429)
      return {
        kind: "limit",
        message:
          "You've used this hour's assistant turns for the household. Your message is still here; send it again later.",
      };
    if (error.status === 503)
      return {
        kind: "unavailable",
        message:
          "The assistant isn't set up on this server, so it can't answer. Everything else in the app still works.",
      };
  }
  return { kind: "other", message: problemMessage(error) };
}

/** A conversation title from the first message: its first line, at most 60 characters (SPEC-Q-11). */
export function autoTitle(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (line.length <= 60) return line === "" ? "New conversation" : line;
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface Conversation {
  id: string | null;
  rows: Row[];
  live: Live;
  loading: boolean;
  loadError: string | null;
  problem: SendProblem | null;
  send: (text: string, screen?: string) => Promise<boolean>;
  stop: () => void;
  reload: () => Promise<void>;
  clearProblem: () => void;
}

export function useConversation(
  initialId: string | null,
  /** A conversation was created by the first send (the page updates its URL and list). */
  onCreated?: (id: string, title: string) => void,
): Conversation {
  const [id, setId] = useState<string | null>(initialId);
  const [state, setState] = useState<{ rows: Row[]; live: Live }>({ rows: [], live: IDLE });
  const [loading, setLoading] = useState(initialId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const abort = useRef<AbortController | null>(null);
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    setId(initialId);
    setState({ rows: [], live: IDLE });
    setLoading(initialId !== null);
    setProblem(null);
  }, [initialId]);

  const reload = useCallback(async () => {
    const current = idRef.current;
    if (current === null) return;
    try {
      const { messages } = await api.call(conversationMessages, { params: { id: current } });
      if (idRef.current !== current) return;
      setState((s) => (s.live.running ? s : { rows: messages ?? [], live: s.live }));
      setLoadError(null);
    } catch (error) {
      if (isSignedOut(error)) {
        goToSignIn();
        return;
      }
      setLoadError(problemMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [id, reload]);

  // Proactive messages: re-read when the page is visible again and every 30 s while it is.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [reload]);

  const send = useCallback(
    async (text: string, screen?: string): Promise<boolean> => {
      setProblem(null);
      let current = idRef.current;
      try {
        if (current === null) {
          const title = autoTitle(text);
          const created = await api.call(conversationsCreate, { body: { title } });
          current = created.id;
          idRef.current = current;
          setId(current);
          onCreated?.(current, created.title);
        }
      } catch (error) {
        if (isSignedOut(error)) goToSignIn();
        setProblem(sendProblem(error));
        return false;
      }
      const controller = new AbortController();
      abort.current = controller;
      setState((s) => ({ rows: s.rows, live: { ...IDLE, running: true, thinking: true } }));
      let started = false;
      try {
        for await (const event of api.events(
          conversationsSend,
          {
            params: { id: current },
            body: screen === undefined ? { text } : { text, screen },
          },
          { signal: controller.signal },
        )) {
          started = true;
          setState((s) => reduce(s, event));
        }
        setState((s) => ({ rows: s.rows, live: { ...s.live, running: false, thinking: false } }));
        return true;
      } catch (error) {
        if (controller.signal.aborted) {
          setState((s) => ({ rows: s.rows, live: { ...IDLE, notice: "Stopped." } }));
          void reload();
          return started;
        }
        if (isSignedOut(error)) goToSignIn();
        setState((s) => ({ rows: s.rows, live: IDLE }));
        if (!started) setProblem(sendProblem(error));
        else
          setState((s) => ({
            rows: s.rows,
            live: { ...IDLE, notice: "The connection dropped before the reply finished." },
          }));
        void reload();
        return started;
      } finally {
        abort.current = null;
      }
    },
    [onCreated, reload],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  return {
    id,
    rows: state.rows,
    live: state.live,
    loading,
    loadError,
    problem,
    send,
    stop,
    reload,
    clearProblem: () => {
      setProblem(null);
    },
  };
}
