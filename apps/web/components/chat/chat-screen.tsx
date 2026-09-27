"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  conversationMessages,
  conversationsList,
  plansList,
  proposalsList,
  type ConversationDto,
} from "@mealplanner/api-contract/contract";
import type { z } from "zod";
import { api } from "../admin/api";
import { LoadError } from "../admin/load-error";
import { useLoad } from "../admin/use-load";
import { loadViewer } from "../reviews/viewer";
import { EmptyState } from "../ui/empty-state";
import { Icon } from "../ui/icon";
import { ChatView } from "./chat-view";

type ConversationRow = z.output<typeof ConversationDto>;

const SEEN_KEY = "mise.chat.seen";

/** When this device last looked at each conversation (SPEC-Q-11: the Updates badge). */
function readSeen(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const v: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function markSeen(id: string): void {
  try {
    const seen = readSeen();
    seen[id] = new Date().toISOString();
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Private mode: badges then count every update.
  }
}

function isoDay(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function groupOf(createdAt: string, now: Date): "Today" | "This week" | "Earlier" {
  const d = new Date(createdAt);
  if (d.toDateString() === now.toDateString()) return "Today";
  return now.getTime() - d.getTime() < 7 * 86_400_000 ? "This week" : "Earlier";
}

/** Suggestion chips from the household's state (AGT-7; SPEC-Q-12). */
async function suggestionsNow(): Promise<string[]> {
  const tomorrow = isoDay(new Date(Date.now() + 86_400_000));
  const [plans, pending] = await Promise.all([
    api.call(plansList, { query: { from: tomorrow, to: tomorrow } }).catch(() => ({ days: [] })),
    api.call(proposalsList, { query: { status: "pending" } }).catch(() => ({ proposals: [] })),
  ]);
  const out: string[] = [];
  if (plans.days.length === 0) out.push("Plan tomorrow");
  const n = pending.proposals.length;
  if (n > 0) out.push(`Review ${String(n)} pending ${n === 1 ? "proposal" : "proposals"}`);
  out.push("What have you learned this week?");
  out.push("Why is anyone off target this week?");
  return out.slice(0, 4);
}

/**
 * ChatDesktop / ChatPhoneDigest / ChatPhoneRecipe (AGT-7): the conversation list (new, titles,
 * search, the Updates badge) and the open conversation. `/chat` opens the most recent one, or a
 * new one when a `prompt` is given (it is put in the composer, not sent).
 */
export function ChatScreen({
  conversationId,
  prompt,
  fresh,
  labels,
}: {
  readonly conversationId: string | null;
  readonly prompt: string | null;
  /** `/chat?new=1`: start an empty conversation instead of opening the most recent. */
  readonly fresh: boolean;
  readonly labels: Readonly<Record<string, string>>;
}) {
  const load = useLoad(async () => {
    const viewer = await loadViewer();
    if (viewer.role !== "admin") return { admin: false as const };
    const [list, suggestions] = await Promise.all([
      api.call(conversationsList, {}).then((r) => r.conversations ?? []),
      suggestionsNow(),
    ]);
    return { admin: true as const, list, suggestions };
  });
  const [extra, setExtra] = useState<ConversationRow[]>([]);
  const [search, setSearch] = useState("");
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [listOpen, setListOpen] = useState(false);

  // `load.data` keeps its identity between renders (the hook's state), unlike `load` itself.
  const data = load.status === "ready" ? load.data : null;
  const list = useMemo(() => {
    const base = data !== null && data.admin ? data.list : [];
    const seen = new Set(base.map((c) => c.id));
    return [...extra.filter((c) => !seen.has(c.id)), ...base];
  }, [data, extra]);

  // `/chat` without an id: the most recent conversation (chosen once, at the first load), unless
  // a prompt or "New conversation" starts a new one.
  const ready = load.status === "ready";
  const [openId, setOpenId] = useState<string | null | undefined>(
    conversationId ?? (prompt !== null || fresh ? null : undefined),
  );
  useEffect(() => {
    if (openId === undefined && ready) setOpenId(list[0]?.id ?? null);
  }, [openId, ready, list]);
  const activeId = openId ?? null;

  useEffect(() => {
    if (activeId !== null) markSeen(activeId);
  }, [activeId]);

  // Badges: `event` rows newer than this device's last look, for the ten most recent others.
  useEffect(() => {
    if (!ready) return;
    const seen = readSeen();
    const others = list.filter((c) => c.id !== activeId).slice(0, 10);
    void Promise.all(
      others.map(async (c) => {
        try {
          const { messages } = await api.call(conversationMessages, { params: { id: c.id } });
          const since = seen[c.id] ?? "";
          return [
            c.id,
            (messages ?? []).filter((m) => m.role === "event" && m.createdAt > since).length,
          ] as const;
        } catch {
          return [c.id, 0] as const;
        }
      }),
    ).then((pairs) => {
      setBadges(Object.fromEntries(pairs));
    });
  }, [ready, list, activeId]);

  const onCreated = useCallback((id: string, title: string) => {
    setExtra((x) => [{ id, title, createdAt: new Date().toISOString(), archivedAt: null }, ...x]);
    window.history.replaceState(null, "", `/chat/${id}`);
    markSeen(id);
  }, []);

  if (load.status === "loading")
    return (
      <div className="p-4">
        <EmptyState
          icon="assistant"
          title="Opening the assistant"
          description="Loading your conversations…"
        />
      </div>
    );
  if (load.status === "error")
    return <LoadError message={load.message} onRetry={() => void load.reload()} />;
  if (!load.data.admin)
    return (
      <EmptyState
        icon="assistant"
        headingLevel={1}
        title="The assistant is for admins"
        description="Ask an admin of your household, or tell the app what you think with a review."
        action={<Link href="/reviews">Go to reviews</Link>}
      />
    );

  const now = new Date();
  const q = search.trim().toLowerCase();
  const shown = list.filter(
    (c) => c.archivedAt === null && (q === "" || c.title.toLowerCase().includes(q)),
  );
  const groups = (["Today", "This week", "Earlier"] as const)
    .map((g) => ({ g, items: shown.filter((c) => groupOf(c.createdAt, now) === g) }))
    .filter((x) => x.items.length > 0);
  const title = list.find((c) => c.id === activeId)?.title ?? "New conversation";

  return (
    // Phones: a full-screen sheet over the tab bar (AGT-7); desktop: beside the rail.
    <div className="fixed inset-0 z-40 flex min-h-0 bg-paper lg:relative lg:inset-auto lg:z-auto lg:-mx-8 lg:-my-7 lg:h-dvh">
      <aside
        aria-label="Conversations"
        className={`${listOpen ? "flex" : "hidden"} absolute inset-x-0 top-[68px] bottom-0 z-20 w-full flex-col gap-2 overflow-y-auto border-r border-line bg-paper px-3.5 py-[22px] lg:static lg:flex lg:w-[230px] lg:shrink-0`}
      >
        <Link
          href="/chat?new=1"
          onClick={() => {
            setListOpen(false);
          }}
          className="flex min-h-11 items-center justify-center rounded-md bg-agent font-extrabold text-on-agent no-underline hover:bg-agent-raised hover:text-on-agent"
        >
          New conversation
        </Link>
        <label className="mt-1 flex items-center gap-2 rounded-md border-[1.5px] border-line-strong bg-card px-2.5">
          <Icon name="search" size={18} />
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            value={search}
            placeholder="Search"
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="min-h-11 w-full border-none bg-transparent text-sm text-ink outline-none"
          />
        </label>
        {groups.map(({ g, items }) => (
          <div key={g} className="flex flex-col gap-1">
            <span className="mt-2 text-xs font-extrabold tracking-[0.08em] text-ink-muted uppercase">
              {g}
            </span>
            {items.map((c) => {
              const n = badges[c.id] ?? 0;
              const current = c.id === activeId;
              return (
                <a
                  key={c.id}
                  href={`/chat/${c.id}`}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm text-ink no-underline hover:bg-card hover:text-ink ${current ? "bg-card font-extrabold shadow-card" : "font-bold"}`}
                >
                  <span className="truncate">{c.title}</span>
                  {n > 0 && (
                    <span className="rounded-full bg-saffron-tint px-1.5 text-xs font-extrabold text-saffron-text">
                      {n}
                      <span className="sr-only"> new {n === 1 ? "update" : "updates"}</span>
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        ))}
        {shown.length === 0 && (
          <span className="text-sm text-ink-soft">
            {q === "" ? "No conversations yet." : "No titles match."}
          </span>
        )}
      </aside>
      <section aria-label="Assistant" className="relative flex min-w-0 grow flex-col px-4 lg:px-0">
        <div className="-mx-4 flex items-center gap-2.5 bg-agent px-3.5 py-3 text-on-agent lg:hidden">
          <Link
            href="/today"
            aria-label="Back"
            className="flex size-11 items-center justify-center rounded-md text-on-agent hover:text-on-agent"
          >
            <Icon name="chevronLeft" strokeWidth={2.5} />
          </Link>
          <span aria-hidden className="flex min-w-0 grow flex-col">
            <span className="text-base font-extrabold">Assistant</span>
            <span className="truncate text-xs">{title}</span>
          </span>
          <button
            type="button"
            aria-expanded={listOpen}
            onClick={() => {
              setListOpen((o) => !o);
            }}
            className="flex min-h-11 items-center rounded-md px-2 text-sm font-extrabold text-on-agent"
          >
            {listOpen ? "Close list" : "Conversations"}
          </button>
        </div>
        <h1 className="sr-only">Assistant · {title}</h1>
        {openId === undefined ? null : (
          <ChatView
            key={activeId ?? "new"}
            conversationId={activeId}
            labels={labels}
            {...(prompt === null ? {} : { prompt })}
            suggestions={load.data.suggestions}
            onCreated={onCreated}
            onTurnEnd={() => {
              void load.reload();
            }}
          />
        )}
      </section>
    </div>
  );
}
