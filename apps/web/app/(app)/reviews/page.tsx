import type { Metadata } from "next";
import { requirePageSession } from "../../../components/admin/session-guard";
import { ReviewsFeedScreen } from "./reviews-feed-screen";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

/** ReviewsFeed.dc.html (UX-4 Reviews, FBK-2): the household's reviews like a review site. */
export default async function ReviewsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ member?: string }>;
}) {
  await requirePageSession("/reviews");
  const { member } = await searchParams;
  return <ReviewsFeedScreen initialMember={member ?? null} />;
}
