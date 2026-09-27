"use client";

import Link from "next/link";
import { useState } from "react";
import { reviewsEdit, reviewsReact, reviewsReply } from "@mealplanner/api-contract/contract";
import { isAvatarColor } from "@mealplanner/ui-tokens/tokens";
import { api, problemMessage } from "../admin/api";
import { FormError } from "../admin/field";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { StarRatingInput } from "../ui/star-rating";
import { tagLabel, tagTone } from "./tags";
import { ago, type Review, type TargetText } from "./targets";
import { memberName, type Viewer } from "./viewer";

/** A posted review with the part reviews written with it (ReviewsFeed: "Rice · too much"). */
export interface ReviewGroup {
  main: Review;
  parts: { name: string; review: Review }[];
  replies: Review[];
}

/** A proposal that cites the review as evidence (SPEC-Q-8: the Assistant note). */
export interface ProposalNote {
  id: string;
  title: string;
  status: string;
}

const EDIT_WINDOW_MS = 24 * 3_600_000;

function ratingColour(rating: number): string {
  return rating <= 2 ? "text-pomegranate-text" : "text-saffron-text";
}

export function ReviewCard({
  group,
  target,
  viewer,
  proposals,
  onChanged,
}: {
  readonly group: ReviewGroup;
  readonly target: TargetText;
  readonly viewer: Viewer;
  readonly proposals: readonly ProposalNote[];
  readonly onChanged: () => Promise<void>;
}) {
  const r = group.main;
  const forName = memberName(viewer, r.onBehalfOfMemberId);
  const who = r.onBehalfOfMemberId === null ? r.authorName || "Kitchen" : forName;
  const subjectColor = viewer.members.find((m) => m.id === r.onBehalfOfMemberId)?.color;
  const postedBy =
    r.onBehalfOfMemberId !== null && r.authorName !== "" && r.authorName !== forName
      ? r.authorName
      : null;
  const mine = r.authorUserId === viewer.userId;
  const editable = mine && Date.now() - Date.parse(r.createdAt) < EDIT_WINDOW_MS;
  const canReply = viewer.role !== "kitchen";
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(r.rating ?? 0);
  const [comment, setComment] = useState(r.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reacted, setReacted] = useState<string | null>(null);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
      return true;
    } catch (err) {
      setError(problemMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const chips = [
    ...group.parts.flatMap((p) =>
      p.review.tags.map((t) => ({
        key: `${p.review.id}-${t}`,
        text: `${p.name} · ${tagLabel(t).toLowerCase()}`,
        tag: t,
      })),
    ),
    ...r.tags.map((t) => ({ key: `${r.id}-${t}`, text: tagLabel(t), tag: t })),
  ];
  const headingId = `review-${r.id}`;

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-2.5 rounded-2xl bg-card p-[18px] shadow-card"
      data-review-id={r.id}
    >
      <div className="flex items-center gap-2.5">
        <Avatar
          name={who}
          color={isAvatarColor(subjectColor) ? subjectColor : null}
          colorKey={r.onBehalfOfMemberId ?? r.authorUserId}
        />
        <span className="flex min-w-0 flex-col">
          <span id={headingId} className="font-extrabold">
            {who}
            {postedBy !== null && (
              <span className="font-semibold text-ink-soft"> · posted by {postedBy}</span>
            )}
          </span>
          <span className="text-[13px] text-ink-soft">
            {target.title}
            {target.detail !== null && ` · ${target.detail}`} · {ago(r.createdAt)}
            {r.editedAt !== null && " · edited"}
          </span>
        </span>
        {r.rating !== null && (
          <span className={`ml-auto shrink-0 font-extrabold ${ratingColour(r.rating)}`}>
            {r.rating} {r.rating === 1 ? "star" : "stars"}
          </span>
        )}
      </div>

      {chips.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Tags">
          {chips.map((c) => (
            <li key={c.key}>
              <Chip tone={tagTone(c.tag)} size="sm">
                {c.text}
              </Chip>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              api.call(reviewsEdit, {
                params: { id: r.id },
                body: {
                  rating: rating === 0 ? null : rating,
                  comment: comment.trim() === "" ? null : comment.trim(),
                },
              }),
            ).then((done) => {
              if (done) setEditing(false);
            });
          }}
        >
          <StarRatingInput
            value={rating}
            onValueChange={setRating}
            label="Rating"
            appearance="row"
            name={`edit-${r.id}`}
          />
          <label className="flex flex-col gap-1.5 text-sm font-extrabold">
            Comment
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
              }}
              className="resize-none rounded-card border-[1.5px] border-line-strong bg-card p-3 font-semibold text-ink"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Save changes
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setRating(r.rating ?? 0);
                setComment(r.comment ?? "");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        r.comment !== null && r.comment !== "" && <p className="m-0 text-[15px]">{r.comment}</p>
      )}

      {group.replies.map((x) => (
        <div key={x.id} className="ml-[26px] flex flex-col gap-1 rounded-card bg-paper px-3.5 py-3">
          <span className="text-sm font-extrabold">{x.authorName || "Someone"}</span>
          <span className="text-sm">{x.comment}</span>
        </div>
      ))}

      {proposals.map((p) => (
        <div
          key={p.id}
          className="ml-[26px] flex flex-col gap-1.5 rounded-card bg-aubergine-tint px-3.5 py-3 text-aubergine-text"
        >
          <span className="text-sm font-extrabold">Assistant</span>
          <span className="text-sm">
            {p.status === "pending" ? "I've proposed: " : `Proposal (${p.status}): `}
            {p.title}
          </span>
          {p.status === "pending" && (
            <Link href="/insights#waiting" className="text-sm font-extrabold">
              Review proposal
            </Link>
          )}
        </div>
      ))}

      {replying && (
        <form
          className="ml-[26px] flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim() === "") return;
            void act(() =>
              api.call(reviewsReply, { params: { id: r.id }, body: { comment: reply.trim() } }),
            ).then((done) => {
              if (done) {
                setReply("");
                setReplying(false);
              }
            });
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-extrabold">
            Your reply
            <textarea
              rows={2}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
              }}
              className="resize-none rounded-card border-[1.5px] border-line-strong bg-card p-3 font-semibold text-ink"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={reply.trim() === ""}>
              Post reply
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setReplying(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <FormError>{error}</FormError>

      {!editing && (
        <div className="flex flex-wrap items-center gap-1 text-[13px] font-extrabold text-ink-soft">
          {canReply && (
            <>
              <button
                type="button"
                aria-pressed={reacted === "agree"}
                disabled={busy}
                onClick={() => {
                  void act(() =>
                    api.call(reviewsReact, { params: { id: r.id }, body: { kind: "agree" } }),
                  ).then((done) => {
                    if (done) setReacted("agree");
                  });
                }}
                className="min-h-11 rounded-md px-2 hover:bg-flour"
              >
                Agree · {r.reactions.agree}
              </button>
              <button
                type="button"
                aria-pressed={reacted === "helpful"}
                disabled={busy}
                onClick={() => {
                  void act(() =>
                    api.call(reviewsReact, { params: { id: r.id }, body: { kind: "helpful" } }),
                  ).then((done) => {
                    if (done) setReacted("helpful");
                  });
                }}
                className="min-h-11 rounded-md px-2 hover:bg-flour"
              >
                Helpful · {r.reactions.helpful}
              </button>
              <button
                type="button"
                aria-expanded={replying}
                onClick={() => {
                  setReplying((v) => !v);
                }}
                className="min-h-11 rounded-md px-2 hover:bg-flour"
              >
                Reply
                <span className="sr-only"> to {who}</span>
              </button>
            </>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
              }}
              className="min-h-11 rounded-md px-2 hover:bg-flour"
            >
              Edit
              <span className="sr-only"> your review</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}
