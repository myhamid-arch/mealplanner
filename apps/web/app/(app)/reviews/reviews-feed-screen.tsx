"use client";

import { useMemo, useState } from "react";
import { proposalsList, reviewsList } from "@mealplanner/api-contract/contract";
import { api } from "../../../components/admin/api";
import { SectionLabel } from "../../../components/admin/field";
import { LoadError } from "../../../components/admin/load-error";
import { useLoad } from "../../../components/admin/use-load";
import {
  evidenceReviewIds,
  proposalTitle,
  type Proposal,
} from "../../../components/chat/proposals";
import { groupReviews } from "../../../components/reviews/group";
import {
  ReviewCard,
  type ProposalNote,
  type ReviewGroup,
} from "../../../components/reviews/review-card";
import { isFrequencyTag, isKitchenTag, isQuantityTag } from "../../../components/reviews/tags";
import { loadResolver, type Resolver, type Review } from "../../../components/reviews/targets";
import { loadViewer, type Viewer } from "../../../components/reviews/viewer";
import { EmptyState } from "../../../components/ui/empty-state";
import { SkeletonBlock } from "../../../components/ui/skeleton";

/** ReviewsFeed's "About" list (SPEC-Q-15). */
const ABOUT = [
  { key: "all", label: "Everything" },
  { key: "dishes", label: "Dishes" },
  { key: "parts", label: "Parts of dishes" },
  { key: "ingredients", label: "Ingredients" },
  { key: "portions", label: "Portions" },
  { key: "often", label: "How often" },
  { key: "days", label: "Whole days" },
] as const;
type About = (typeof ABOUT)[number]["key"];

interface Data {
  viewer: Viewer;
  reviews: Review[];
  resolver: Resolver;
  proposals: Proposal[];
}

function allTags(g: ReviewGroup): string[] {
  return [...g.main.tags, ...g.parts.flatMap((p) => p.review.tags)];
}

function matchesAbout(g: ReviewGroup, about: About): boolean {
  const t = g.main.targetType;
  switch (about) {
    case "all":
      return true;
    case "dishes":
      return t === "dish" || t === "plan_meal" || t === "plate";
    case "parts":
      return t === "component" || t === "variant" || g.parts.length > 0;
    case "ingredients":
      return t === "ingredient";
    case "portions":
      return allTags(g).some(isQuantityTag);
    case "often":
      return allTags(g).some(isFrequencyTag);
    case "days":
      return t === "plan_day";
  }
}

export function ReviewsFeedScreen({ initialMember }: { readonly initialMember: string | null }) {
  const load = useLoad<Data>(async () => {
    const viewer = await loadViewer();
    const [reviews, proposals] = await Promise.all([
      api.call(reviewsList, { query: { limit: 200 } }).then((r) => r.reviews ?? []),
      viewer.role === "admin"
        ? api.call(proposalsList, { query: {} }).then((p) => p.proposals ?? [])
        : Promise.resolve([] as Proposal[]),
    ]);
    const resolver = await loadResolver(reviews);
    return { viewer, reviews, resolver, proposals };
  });
  const [who, setWho] = useState<string>(initialMember ?? "everyone");
  const [about, setAbout] = useState<About>("all");
  const [low, setLow] = useState(false);
  const [unanswered, setUnanswered] = useState(false);

  const data = load.status === "ready" ? load.data : null;
  const groups = useMemo(() => {
    if (data === null) return [];
    return groupReviews(data.reviews, (r) => data.resolver.describe(r).title);
  }, [data]);

  const notes = useMemo(() => {
    const out = new Map<string, ProposalNote[]>();
    if (data === null) return out;
    for (const p of data.proposals)
      for (const id of evidenceReviewIds(p.evidence))
        out.set(id, [
          ...(out.get(id) ?? []),
          { id: p.id, title: proposalTitle(p), status: p.status },
        ]);
    return out;
  }, [data]);

  const shown = groups.filter((g) => {
    if (who === "kitchen") {
      const tags = allTags(g);
      if (tags.length === 0 || !tags.every(isKitchenTag)) return false;
    } else if (who !== "everyone" && g.main.onBehalfOfMemberId !== who) return false;
    if (!matchesAbout(g, about)) return false;
    if (low && (g.main.rating === null || g.main.rating > 2)) return false;
    if (unanswered && g.replies.length > 0) return false;
    return true;
  });

  const chip = (on: boolean) =>
    `min-h-11 rounded-full px-3 text-[13px] font-extrabold ${
      on ? "bg-ink text-paper" : "bg-flour text-ink hover:bg-line-strong"
    }`;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-[22px]">
      <aside aria-label="Filters" className="flex flex-col gap-3.5 lg:w-[220px] lg:shrink-0">
        <h1 className="text-[28px] lg:text-[32px]">Reviews</h1>
        <SectionLabel as="span">Who</SectionLabel>
        <div role="group" aria-label="Who" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={who === "everyone"}
            className={chip(who === "everyone")}
            onClick={() => {
              setWho("everyone");
            }}
          >
            Everyone
          </button>
          {load.status === "ready" &&
            load.data.viewer.members.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={who === m.id}
                className={chip(who === m.id)}
                onClick={() => {
                  setWho(m.id);
                }}
              >
                {m.displayName}
              </button>
            ))}
          <button
            type="button"
            aria-pressed={who === "kitchen"}
            className={chip(who === "kitchen")}
            onClick={() => {
              setWho("kitchen");
            }}
          >
            Kitchen
          </button>
        </div>
        <SectionLabel as="span">About</SectionLabel>
        <div role="group" aria-label="About" className="flex flex-wrap gap-1 lg:flex-col">
          {ABOUT.map((a) => (
            <button
              key={a.key}
              type="button"
              aria-pressed={about === a.key}
              onClick={() => {
                setAbout(a.key);
              }}
              className={`min-h-11 rounded-md px-2.5 text-left text-sm font-bold lg:min-h-9 ${
                about === a.key ? "bg-flour font-extrabold text-ink" : "text-ink hover:bg-flour"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <SectionLabel as="span">Show</SectionLabel>
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => {
              setLow(e.target.checked);
            }}
            className="size-[18px] accent-action"
          />
          Low ratings only
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={unanswered}
            onChange={(e) => {
              setUnanswered(e.target.checked);
            }}
            className="size-[18px] accent-action"
          />
          Unanswered
        </label>
      </aside>

      <section aria-label="Review feed" className="flex min-w-0 grow flex-col gap-3.5">
        {load.status === "loading" && <SkeletonBlock label="Loading reviews" lines={6} />}
        {load.status === "error" && (
          <LoadError message={load.message} onRetry={() => void load.reload()} />
        )}
        {load.status === "ready" && shown.length === 0 && (
          <EmptyState
            icon="reviews"
            headingLevel={2}
            title={groups.length === 0 ? "No reviews yet" : "Nothing matches these filters"}
            description={
              groups.length === 0
                ? "Rate a meal from Today or a plate, and reviews show up here for everyone to read and answer."
                : "Try another person or topic, or clear the checkboxes."
            }
          />
        )}
        {load.status === "ready" &&
          shown.map((g) => (
            <ReviewCard
              key={g.main.id}
              group={g}
              target={load.data.resolver.describe(g.main)}
              viewer={load.data.viewer}
              proposals={[g.main, ...g.parts.map((p) => p.review)]
                .flatMap((r) => notes.get(r.id) ?? [])
                .filter((n, i, all) => all.findIndex((x) => x.id === n.id) === i)}
              onChanged={load.reload}
            />
          ))}
      </section>
    </div>
  );
}
