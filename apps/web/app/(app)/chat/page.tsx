import type { Metadata } from "next";
import { TOOL_LABELS } from "@mealplanner/ai/agent";
import { requirePageSession } from "../../../components/admin/session-guard";
import { ChatScreen } from "../../../components/chat/chat-screen";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

/**
 * ChatDesktop.dc.html (AGT-7): the assistant. `?prompt=<text>` puts text in the composer of a new
 * conversation without sending it (1.4.3 SPEC-Q-16, R-53); `?new=<anything>` starts an empty one.
 */
export default async function ChatPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ prompt?: string; new?: string }>;
}) {
  const q = await searchParams;
  const prompt =
    typeof q.prompt === "string" && q.prompt.trim() !== "" ? q.prompt.slice(0, 4000) : null;
  await requirePageSession(
    prompt === null ? "/chat" : `/chat?prompt=${encodeURIComponent(prompt)}`,
  );
  // A new query (another "New conversation", another prompt) starts the screen afresh.
  return (
    <ChatScreen
      key={`${q.new ?? ""}|${prompt ?? ""}`}
      conversationId={null}
      prompt={prompt}
      fresh={q.new !== undefined}
      labels={TOOL_LABELS}
    />
  );
}
