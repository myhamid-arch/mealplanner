"use client";

// What the cards need beyond their own payload: names for ids, the current state of proposals
// (a card stored as "pending" may since have been decided), the change log's undo state, the
// dishes that exist (a saved recipe draft), and a way to put text in the composer.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { changeSetsList, dishesList, proposalsList } from "@mealplanner/api-contract/contract";
import { api } from "../admin/api";
import { loadNames, type Names } from "./names";
import type { Proposal } from "./proposals";

export interface ChangeState {
  undone: boolean;
  undoAvailable: boolean;
  reason: string | null;
}

export interface ChatData {
  names: Names;
  proposals: ReadonlyMap<string, Proposal>;
  changes: ReadonlyMap<string, ChangeState>;
  dishIds: ReadonlySet<string>;
  /** Re-reads proposals, the change log and dishes (after a card acted). */
  refresh: () => Promise<void>;
  /** Puts text into the composer (suggestion chips, "Another"). */
  prefill: (text: string) => void;
  /** A job of this conversation finished: the conversation is re-read. */
  onJobDone: (jobId: string) => void;
}

const EMPTY: ChatData = {
  names: new Map(),
  proposals: new Map(),
  changes: new Map(),
  dishIds: new Set(),
  refresh: () => Promise.resolve(),
  prefill: () => undefined,
  onJobDone: () => undefined,
};

const Ctx = createContext<ChatData>(EMPTY);

export function useChatData(): ChatData {
  return useContext(Ctx);
}

export function ChatDataProvider({
  prefill,
  onJobDone,
  children,
}: {
  readonly prefill: (text: string) => void;
  readonly onJobDone: (jobId: string) => void;
  readonly children: ReactNode;
}) {
  const [names, setNames] = useState<Names>(new Map());
  const [proposals, setProposals] = useState<ReadonlyMap<string, Proposal>>(new Map());
  const [changes, setChanges] = useState<ReadonlyMap<string, ChangeState>>(new Map());
  const [dishIds, setDishIds] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    const [p, c, d] = await Promise.all([
      api.call(proposalsList, { query: {} }).catch(() => ({ proposals: [] as Proposal[] })),
      api.call(changeSetsList, { query: { limit: 200 } }).catch(() => ({ entries: [] })),
      api.call(dishesList, { query: {} }).catch(() => ({ dishes: [] })),
    ]);
    setProposals(new Map(p.proposals.map((x) => [x.id, x])));
    const m = new Map<string, ChangeState>();
    for (const e of c.entries)
      if (e.type === "change_set")
        m.set(e.id, {
          undone: e.undoneAt !== null,
          undoAvailable: e.undo.available,
          reason: e.undo.reason,
        });
    setChanges(m);
    setDishIds(new Set(d.dishes.map((x) => x.id)));
  }, []);

  useEffect(() => {
    void loadNames().then(setNames);
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ names, proposals, changes, dishIds, refresh, prefill, onJobDone }),
    [names, proposals, changes, dishIds, refresh, prefill, onJobDone],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
