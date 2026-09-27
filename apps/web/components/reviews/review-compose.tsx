"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  dishesGet,
  ingredientsGet,
  reviewsCreate,
  type ReviewCreateBody,
} from "@mealplanner/api-contract/contract";
import type { z } from "zod";
import { api, problemMessage } from "../admin/api";
import { FormError } from "../admin/field";
import { LoadError } from "../admin/load-error";
import { useLoad } from "../admin/use-load";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { Icon } from "../ui/icon";
import { SkeletonBlock } from "../ui/skeleton";
import { StarRatingInput } from "../ui/star-rating";
import { loadMeal, mealParts, type MealContext, type MealPart } from "./meal";
import { TagChips, toggleTag } from "./tag-chips";
import { HOW_OFTEN, partSummary, partTags, QUICK_TAGS, tagLabel } from "./tags";
import { mealTitle } from "./targets";
import { loadViewer, reviewableMembers, type Viewer } from "./viewer";

type TargetType = z.output<typeof ReviewCreateBody>["targetType"];

export type ComposeTarget =
  | { kind: "meal"; planMealId: string }
  | { kind: "object"; targetType: TargetType; targetId: string };

interface Data {
  viewer: Viewer;
  meal: MealContext | null;
  /** The reviewed object's name (object mode). */
  name: string;
}

const WHOLE_TAGS = QUICK_TAGS.filter((t) => !(HOW_OFTEN as readonly string[]).includes(t));
const AMOUNT_GROUP = ["too_much", "too_little", "just_right"];

async function objectName(targetType: TargetType, targetId: string): Promise<string> {
  try {
    if (targetType === "dish")
      return (await api.call(dishesGet, { params: { id: targetId } })).name;
    if (targetType === "ingredient")
      return (await api.call(ingredientsGet, { params: { id: targetId } })).name;
  } catch {
    // Named generically below.
  }
  const generic: Record<string, string> = {
    dish: "A dish",
    ingredient: "An ingredient",
    cuisine: "A cuisine",
    method: "A cooking method",
    plan_day: "A whole day",
    component: "Part of a dish",
    variant: "Part of a dish",
    plate: "A plate",
    plan_meal: "A meal",
  };
  return generic[targetType] ?? "Review";
}

/** The note under Post (ReviewComposePhone): what an amount tag will do for this member. */
function amountNote(
  viewer: Viewer,
  memberId: string | null,
  parts: MealPart[],
  tags: Map<string, string[]>,
): string | null {
  const member = viewer.members.find((m) => m.id === memberId);
  if (member === undefined) return null;
  const part = parts.find((p) =>
    (tags.get(p.componentId) ?? []).some((t) => t === "too_much" || t === "too_little"),
  );
  if (part === undefined) return null;
  return member.isTargeted
    ? `${member.displayName}'s portions are set by their targets, so this becomes a suggestion for the admin instead.`
    : `${member.displayName}'s ${part.name.toLowerCase()} portion adjusts a little each time it is rated like this.`;
}

/**
 * ReviewComposePhone.dc.html (R2-UX-4, FBK-2): the detailed review. For a meal: whole-meal stars,
 * each part of the member's plate, how often, a comment and who it is for. Posts one `plan_meal`
 * review and one `component` review per tagged part (SPEC-Q-6). For any other object (dish,
 * ingredient, …): stars, tags, how often (dishes) and a comment.
 */
export function ReviewCompose({
  target,
  initial,
  next,
}: {
  readonly target: ComposeTarget;
  readonly initial: { rating: number; tags: string[]; memberId: string | null };
  readonly next: string;
}) {
  const router = useRouter();
  const load = useLoad<Data>(async () => {
    const viewer = await loadViewer();
    if (target.kind === "meal") {
      const meal = await loadMeal(target.planMealId);
      return { viewer, meal, name: meal.dish.name };
    }
    return { viewer, meal: null, name: await objectName(target.targetType, target.targetId) };
  }, [target.kind === "meal" ? target.planMealId : `${target.targetType}:${target.targetId}`]);
  const [rating, setRating] = useState(initial.rating);
  const [wholeTags, setWholeTags] = useState<string[]>(
    initial.tags.filter((t) => !(HOW_OFTEN as readonly string[]).includes(t)),
  );
  const [often, setOften] = useState<string[]>(
    initial.tags.filter((t) => (HOW_OFTEN as readonly string[]).includes(t)).slice(0, 1),
  );
  const [partTagMap, setPartTagMap] = useState(new Map<string, string[]>());
  const [comment, setComment] = useState("");
  const [forMember, setForMember] = useState<string | null>(initial.memberId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (load.status === "loading") return <SkeletonBlock label="Loading the review" lines={8} />;
  if (load.status === "error")
    return <LoadError message={load.message} onRetry={() => void load.reload()} />;
  const { viewer, meal, name } = load.data;
  const choices = reviewableMembers(viewer);
  const memberId = forMember ?? viewer.memberId ?? choices[0]?.id ?? null;
  const parts = meal === null ? [] : mealParts(meal, memberId);
  const isMeal = target.kind === "meal";
  const offersOften = target.kind === "meal" || target.targetType === "dish";
  const nothing =
    rating === 0 &&
    wholeTags.length === 0 &&
    often.length === 0 &&
    comment.trim() === "" &&
    [...partTagMap.values()].every((t) => t.length === 0);

  async function post() {
    setBusy(true);
    setError(null);
    const base = { onBehalfOfMemberId: memberId };
    try {
      if (target.kind === "meal") {
        await api.call(reviewsCreate, {
          body: {
            ...base,
            targetType: "plan_meal",
            targetId: target.planMealId,
            planMealId: target.planMealId,
            rating: rating === 0 ? null : rating,
            tags: [...wholeTags, ...often],
            comment: comment.trim() === "" ? null : comment.trim(),
          },
        });
        for (const part of parts) {
          const tags = partTagMap.get(part.componentId) ?? [];
          if (tags.length === 0) continue;
          await api.call(reviewsCreate, {
            body: {
              ...base,
              targetType: "component",
              targetId: part.componentId,
              planMealId: target.planMealId,
              rating: null,
              tags,
              comment: null,
            },
          });
        }
      } else {
        await api.call(reviewsCreate, {
          body: {
            ...base,
            targetType: target.targetType,
            targetId: target.targetId,
            rating: rating === 0 ? null : rating,
            tags: [...wholeTags, ...often],
            comment: comment.trim() === "" ? null : comment.trim(),
          },
        });
      }
      router.push(next);
    } catch (err) {
      setError(problemMessage(err));
      setBusy(false);
    }
  }

  const note = amountNote(viewer, memberId, parts, partTagMap);
  const box = "flex flex-col gap-2.5 rounded-xl bg-card p-3.5 shadow-card";

  return (
    <form
      className="mx-auto flex w-full max-w-[560px] flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void post();
      }}
    >
      <div className="flex items-center gap-2.5">
        <Link
          href={next}
          aria-label="Back"
          className="flex size-11 shrink-0 items-center justify-center rounded-md bg-flour text-ink"
        >
          <Icon name="chevronLeft" strokeWidth={2.5} />
        </Link>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-extrabold text-ink-soft">
            {meal === null ? name : mealTitle(meal.meal)}
          </span>
          <h1 className="text-[22px]">Review</h1>
        </div>
        {choices.length > 0 && (
          <label className="ml-auto flex flex-col text-xs font-extrabold text-ink-soft">
            Reviewing for
            <select
              value={memberId ?? ""}
              onChange={(e) => {
                setForMember(e.target.value);
                setPartTagMap(new Map());
              }}
              className="min-h-11 rounded-[10px] border-[1.5px] border-line-strong bg-card px-1.5 text-sm text-ink"
            >
              {choices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === viewer.memberId ? `Me (${m.displayName})` : m.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <section className={box} aria-labelledby="whole">
        <h2 id="whole" className="font-body text-[15px] font-extrabold">
          {isMeal ? "Whole meal" : name}
        </h2>
        <StarRatingInput
          value={rating}
          onValueChange={setRating}
          label={isMeal ? "Rating for the whole meal" : `Rating for ${name}`}
          appearance="row"
        />
        <TagChips
          tags={WHOLE_TAGS}
          selected={wholeTags}
          size="sm"
          label={isMeal ? "About the whole meal" : `About ${name}`}
          onToggle={(t) => {
            setWholeTags((l) =>
              toggleTag(l, t, AMOUNT_GROUP.includes(t) ? AMOUNT_GROUP : undefined),
            );
          }}
        />
      </section>

      {parts.length > 0 && (
        <section className={box} aria-labelledby="parts">
          <h2 id="parts" className="font-body text-[15px] font-extrabold">
            Each part (optional)
          </h2>
          {parts.map((part) => {
            const tags = partTagMap.get(part.componentId) ?? [];
            const summary = partSummary(tags);
            const label =
              part.variantLabel === null
                ? part.name
                : `${part.name} · ${part.variantLabel.toLowerCase()}`;
            const offered = partTags(part.role);
            return (
              <div
                key={part.componentId}
                className="flex flex-col gap-1.5"
                data-part={part.componentId}
              >
                <span className="flex justify-between gap-2 font-bold">
                  <span>{label}</span>
                  {summary.tone === "neutral" ? (
                    <span className="font-extrabold text-ink-soft">{summary.text}</span>
                  ) : (
                    <Chip tone={summary.tone} size="sm">
                      {summary.text}
                    </Chip>
                  )}
                </span>
                <TagChips
                  tags={offered}
                  selected={tags}
                  size="sm"
                  label={label}
                  onToggle={(t) => {
                    setPartTagMap((m) => {
                      const nextMap = new Map(m);
                      nextMap.set(
                        part.componentId,
                        toggleTag(tags, t, AMOUNT_GROUP.includes(t) ? AMOUNT_GROUP : undefined),
                      );
                      return nextMap;
                    });
                  }}
                />
              </div>
            );
          })}
        </section>
      )}

      {offersOften && (
        <section className={box} aria-labelledby="often">
          <h2 id="often" className="font-body text-[15px] font-extrabold">
            How often?
          </h2>
          <TagChips
            tags={HOW_OFTEN}
            selected={often}
            single
            grid
            label="How often?"
            onToggle={(t) => {
              setOften((l) => (l.includes(t) ? [] : [t]));
            }}
          />
        </section>
      )}

      <label className="flex flex-col gap-1.5 font-extrabold">
        Comment
        <textarea
          rows={3}
          value={comment}
          maxLength={4000}
          onChange={(e) => {
            setComment(e.target.value);
          }}
          className="resize-none rounded-card border-[1.5px] border-line-strong bg-card p-3 font-semibold text-ink"
        />
      </label>

      <FormError>{error}</FormError>
      <Button type="submit" size="lg" loading={busy} disabled={nothing}>
        Post review
      </Button>
      {note !== null && <p className="m-0 text-center text-[13px] text-ink-soft">{note}</p>}
      {often.includes("never_again") && (
        <p className="m-0 text-center text-[13px] text-ink-soft">
          “{tagLabel("never_again")}” goes to the admin as a suggestion to stop planning this for{" "}
          {choices.find((m) => m.id === memberId)?.displayName ?? "you"}.
        </p>
      )}
    </form>
  );
}
