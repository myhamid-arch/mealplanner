"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { conversationsList } from "@mealplanner/api-contract/contract";
import { api } from "../admin/api";
import { Icon } from "../ui/icon";
import { ChatView } from "./chat-view";

const OPEN_KEY = "mise.chat.panelOpen";

/** What the page shows, for the header and the turn's screen context (07 §5). */
function lookingAt(pathname: string): string {
  const h1 = document.querySelector("main h1")?.textContent.trim() ?? "";
  const title = h1 !== "" ? h1 : document.title;
  return title === "" ? pathname : title;
}

function suggestionsFor(pathname: string): string[] {
  if (pathname.startsWith("/plan") || pathname.startsWith("/today"))
    return ["Why is anyone off target here?", "Swap something the kids will love"];
  if (pathname.startsWith("/recipes")) return ["Make this lighter", "Something new like this"];
  if (pathname.startsWith("/family") || pathname.startsWith("/settings"))
    return ["Explain these settings", "What would you change here?"];
  if (pathname.startsWith("/reviews") || pathname.startsWith("/insights"))
    return ["What have you learned this week?"];
  return ["Plan tomorrow"];
}

/**
 * ChatSidePanel.dc.html (AGT-7): the assistant beside any admin page on desktop (≥ 1024 px),
 * toggled by a floating button. It continues the most recent conversation and sends what the page
 * shows as context. Not shown on the assistant's own pages.
 */
export function ChatPanel({ labels }: { readonly labels: Readonly<Record<string, string>> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null | undefined>(undefined);
  const [screen, setScreen] = useState("");
  /** A conversation the panel created (for "Full screen"); not fed back into the view. */
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      // No storage: the panel starts closed.
    }
  }, []);

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // No storage: the choice lasts for this page.
    }
  }, []);

  useEffect(() => {
    if (!open || conversationId !== undefined) return;
    void api
      .call(conversationsList, {})
      .then((r) => {
        setConversationId((r.conversations ?? []).find((c) => c.archivedAt === null)?.id ?? null);
      })
      .catch(() => {
        setConversationId(null);
      });
  }, [open, conversationId]);

  // The page's heading is rendered after navigation; read it once the page has painted.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setScreen(lookingAt(pathname));
    }, 300);
    return () => {
      window.clearTimeout(t);
    };
  }, [open, pathname]);

  const onCreated = useCallback((id: string) => {
    setCreatedId(id);
  }, []);
  const linkId = createdId ?? conversationId ?? null;

  if (pathname.startsWith("/chat")) return null;
  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          toggle(true);
        }}
        aria-label="Open the assistant panel"
        className="fixed right-6 bottom-6 z-30 flex size-[58px] items-center justify-center rounded-full bg-agent text-on-agent shadow-raised hover:bg-agent-raised"
      >
        <Icon name="assistant" size={26} />
      </button>
    );

  return (
    <div
      role="complementary"
      aria-label="Assistant"
      className="sticky top-0 flex h-dvh w-[460px] flex-col border-l border-line bg-card shadow-raised"
    >
      <div className="flex items-center gap-2.5 border-b border-flour px-[18px] py-4">
        <span className="flex size-[34px] items-center justify-center rounded-md bg-agent text-on-agent">
          <Icon name="assistant" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-extrabold">Assistant</span>
          <span className="truncate text-xs text-ink-soft">
            Looking at: {screen === "" ? "this page" : screen}
          </span>
        </span>
        <Link
          href={linkId === null ? "/chat" : `/chat/${linkId}`}
          className="ml-auto text-[13px] font-extrabold"
        >
          Full screen
        </Link>
        <button
          type="button"
          aria-label="Close the assistant"
          onClick={() => {
            toggle(false);
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-flour text-ink hover:bg-line-strong"
        >
          <Icon name="close" />
        </button>
      </div>
      {conversationId !== undefined && (
        <ChatView
          conversationId={conversationId}
          labels={labels}
          {...(screen === "" ? {} : { screen: `Looking at: ${screen} (${pathname})` })}
          suggestions={suggestionsFor(pathname)}
          compact
          placeholder="Ask about this page…"
          onCreated={onCreated}
          emptyTitle="Ask about this page"
        />
      )}
    </div>
  );
}
