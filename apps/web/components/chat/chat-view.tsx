"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormError } from "../admin/field";
import { LoadError } from "../admin/load-error";
import { EmptyState } from "../ui/empty-state";
import { SkeletonBlock } from "../ui/skeleton";
import { ChatCards } from "./cards";
import { Composer } from "./composer";
import { ChatDataProvider } from "./context";
import { Markdown } from "./markdown";
import { buildItems, doneLabel, type Item, type Step } from "./turn";
import { useConversation } from "./use-conversation";

const TIME = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Activity chips (AGT-7): live while the turn runs, then collapsed into "Details". */
function Steps({ steps, live }: { readonly steps: readonly Step[]; readonly live: boolean }) {
  if (steps.length === 0) return null;
  const chip = (s: Step) => (
    <li
      key={s.id}
      className={`rounded-full px-2.5 py-1.5 text-[13px] font-extrabold ${
        s.ok === false ? "bg-pomegranate-tint text-pomegranate-text" : "bg-flour text-ink-soft"
      }`}
    >
      {s.ok === null ? s.label : doneLabel(s.label)}
      {s.ok === false && " (failed)"}
    </li>
  );
  if (live)
    return (
      <ul
        aria-label="What the assistant is doing"
        className="m-0 flex list-none flex-wrap gap-2 p-0"
      >
        {steps.map(chip)}
      </ul>
    );
  return (
    <details className="text-[13px] font-extrabold text-ink-soft">
      <summary className="min-h-9 cursor-pointer content-center">
        Details · {steps.length} {steps.length === 1 ? "step" : "steps"}
      </summary>
      <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-2 p-0">{steps.map(chip)}</ul>
    </details>
  );
}

function ItemView({ item, compact }: { readonly item: Item; readonly compact: boolean }) {
  const bubble = compact ? "max-w-[340px] text-sm" : "max-w-[520px] text-[15px]";
  switch (item.kind) {
    case "user":
      return (
        <div
          className={`self-end rounded-[18px] rounded-br-[4px] bg-ink px-4 py-3.5 whitespace-pre-wrap text-paper ${bubble}`}
          data-role="user"
        >
          {item.text}
        </div>
      );
    case "event":
      return (
        <div className="flex flex-col gap-3" data-role="event">
          <span className="self-center text-xs font-extrabold text-ink-soft">
            {TIME.format(new Date(item.createdAt))} · update
          </span>
          {item.text !== "" && <Markdown source={item.text} />}
          {item.cards.length > 0 && <ChatCards cards={item.cards} />}
        </div>
      );
    case "turn":
      return (
        <div
          className="flex max-w-[760px] flex-col gap-3"
          data-role="assistant"
          aria-busy={item.live}
        >
          <Steps steps={item.steps} live={item.live} />
          {item.parts.map((p) =>
            p.kind === "text" ? (
              <Markdown key={p.key} source={p.text} />
            ) : (
              <ChatCards key={p.key} cards={p.cards} />
            ),
          )}
          {item.thinking && (
            <span className="text-sm font-bold text-ink-soft motion-safe:animate-pulse">
              Thinking…
            </span>
          )}
          {item.notice !== null && (
            <span className="rounded-card bg-saffron-tint px-3.5 py-2.5 text-sm font-bold text-saffron-text">
              {item.notice}
            </span>
          )}
        </div>
      );
  }
}

export interface ChatViewProps {
  readonly conversationId: string | null;
  /** Tool name → activity label (the server's AGT-7 labels), for replayed turns. */
  readonly labels: Readonly<Record<string, string>>;
  /** Text to put in the composer at first (`/chat?prompt=`; never sent by itself). */
  readonly prompt?: string;
  /** What the side panel is showing, sent with each message (07 §5). */
  readonly screen?: string;
  readonly suggestions: readonly string[];
  readonly compact?: boolean;
  readonly placeholder?: string;
  readonly onCreated?: (id: string, title: string) => void;
  /** Called after a turn ends (the page refreshes its conversation list). */
  readonly onTurnEnd?: () => void;
  /** Empty-state copy (the page and the panel differ). */
  readonly emptyTitle?: string;
}

/** The conversation and its composer (ChatDesktop, ChatPhone*, ChatSidePanel). */
export function ChatView({
  conversationId,
  labels,
  prompt,
  screen,
  suggestions,
  compact = false,
  placeholder = "Ask anything, or tell me what to change…",
  onCreated,
  onTurnEnd,
  emptyTitle = "Ask the assistant",
}: ChatViewProps) {
  const c = useConversation(conversationId, onCreated);
  const [text, setText] = useState(prompt ?? "");
  const end = useRef<HTMLDivElement | null>(null);
  const items = useMemo(() => buildItems(c.rows, labels, c.live), [c.rows, labels, c.live]);

  useEffect(() => {
    if (prompt !== undefined) setText(prompt);
  }, [prompt]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items.length, c.live.text.length]);

  const { reload } = c;
  const onJobDone = useCallback(() => {
    void reload();
  }, [reload]);

  async function send() {
    const message = text.trim();
    if (message === "") return;
    setText("");
    const ok = await c.send(message, screen);
    if (!ok) setText(message);
    onTurnEnd?.();
  }

  const unavailable = c.problem?.kind === "unavailable";
  return (
    <ChatDataProvider prefill={setText} onJobDone={onJobDone}>
      <div className="flex min-h-0 grow flex-col">
        <div
          role="log"
          aria-live="polite"
          aria-label="Conversation"
          className={`flex min-h-0 grow flex-col gap-4 overflow-y-auto ${compact ? "px-[18px] py-4" : "px-0 py-2 lg:px-10 lg:py-[26px]"}`}
        >
          {c.loading && <SkeletonBlock label="Loading the conversation" lines={5} />}
          {c.loadError !== null && (
            <LoadError message={c.loadError} onRetry={() => void c.reload()} />
          )}
          {!c.loading && c.loadError === null && items.length === 0 && (
            <EmptyState
              icon="assistant"
              headingLevel={2}
              title={emptyTitle}
              description="Ask about the plan, change targets or tastes, or ask for a new recipe. Changes you ask for can be undone, and ideas come as proposals you accept or reject."
            />
          )}
          {items.map((item) => (
            <ItemView key={item.id} item={item} compact={compact} />
          ))}
          <div ref={end} />
        </div>
        <div
          className={`flex flex-col gap-2.5 border-t border-line bg-paper ${compact ? "px-3.5 pt-3 pb-4" : "pt-4 pb-2 lg:px-10 lg:pb-[26px]"}`}
        >
          {c.problem !== null && (
            <div data-problem={c.problem.kind}>
              <FormError>{c.problem.message}</FormError>
            </div>
          )}
          <Composer
            value={text}
            onChange={(t) => {
              setText(t);
              if (c.problem !== null && c.problem.kind !== "unavailable") c.clearProblem();
            }}
            onSend={() => void send()}
            onStop={c.stop}
            running={c.live.running}
            disabled={unavailable}
            placeholder={placeholder}
            suggestions={suggestions}
            compact={compact}
          />
        </div>
      </div>
    </ChatDataProvider>
  );
}
