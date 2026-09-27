import type { Metadata } from "next";
import { TOOL_LABELS } from "@mealplanner/ai/agent";
import { requirePageSession } from "../../../../components/admin/session-guard";
import { ChatScreen } from "../../../../components/chat/chat-screen";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

/** One conversation (AGT-7): `/chat/<conversationId>`. */
export default async function ConversationPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePageSession(`/chat/${encodeURIComponent(id)}`);
  return <ChatScreen conversationId={id} prompt={null} fresh={false} labels={TOOL_LABELS} />;
}
