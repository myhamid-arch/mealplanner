"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { reviewsCreate } from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../admin/api";
import { FormError } from "../admin/field";
import { useLoad } from "../admin/use-load";
import { Button, buttonClasses } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { SkeletonBlock } from "../ui/skeleton";
import { StarRatingInput } from "../ui/star-rating";
import { DishThumb } from "./dish-thumb";
import { loadMeal, whenText, type MealContext } from "./meal";
import { TagChips, toggleTag } from "./tag-chips";
import { QUICK_TAGS } from "./tags";
import { loadViewer, reviewableMembers, type Viewer } from "./viewer";

/** Where the detailed review continues from the quick rating, carrying what was already chosen. */
export function composeHref(
  planMealId: string,
  opts: { rating?: number; tags?: readonly string[]; memberId?: string | null; next?: string },
): string {
  const q = new URLSearchParams({ planMealId });
  if (opts.memberId) q.set("for", opts.memberId);
  if (opts.rating !== undefined && opts.rating > 0) q.set("rating", String(opts.rating));
  if (opts.tags !== undefined && opts.tags.length > 0) q.set("tags", opts.tags.join(","));
  if (opts.next !== undefined) q.set("next", opts.next);
  return `/reviews/new?${q.toString()}`;
}

/**
 * QuickRatePhone.dc.html (R2-UX-4): the bottom sheet a meal-time notification opens. Five drawn
 * stars and one-tap tags; "Say more…" continues in the detailed review; "Done" posts one review of
 * the meal (`plan_meal`) for the viewer's member.
 */
export function QuickRateSheet({
  planMealId,
  next,
}: {
  readonly planMealId: string;
  /** Where Done and closing go (default: the feed). */
  readonly next: string;
}) {
  const router = useRouter();
  const load = useLoad<{ viewer: Viewer; ctx: MealContext }>(async () => {
    const [viewer, ctx] = await Promise.all([loadViewer(), loadMeal(planMealId)]);
    return { viewer, ctx };
  }, [planMealId]);
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [forMember, setForMember] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = load.status === "ready" ? load.data : null;
  const choices = ready === null ? [] : reviewableMembers(ready.viewer);
  const memberId = forMember ?? ready?.viewer.memberId ?? choices[0]?.id ?? null;
  const title = ready === null ? "Rate this meal" : ready.ctx.dish.name;

  async function done() {
    if (ready === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.call(reviewsCreate, {
        body: {
          targetType: "plan_meal",
          targetId: planMealId,
          planMealId,
          onBehalfOfMemberId: memberId,
          rating: rating === 0 ? null : rating,
          tags,
          comment: null,
        },
      });
      router.push(next);
    } catch (err) {
      setError(problemMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(next);
      }}
      title={title}
      {...(ready === null ? {} : { description: whenText(ready.ctx.meal) })}
      desktop="center"
      width={460}
    >
      {load.status === "loading" && <SkeletonBlock label="Loading the meal" lines={4} />}
      {load.status === "error" && <FormError>{load.message}</FormError>}
      {ready !== null && (
        <>
          <div className="flex items-center gap-3">
            <DishThumb id={ready.ctx.dish.id} />
            <span className="text-[13px] font-extrabold text-ink-soft">
              {ready.ctx.meal.slotLabel} for{" "}
              {choices.find((m) => m.id === memberId)?.displayName ?? "you"}
            </span>
          </div>
          {choices.length > 1 && (
            <label className="flex flex-col gap-1 text-xs font-extrabold text-ink-soft">
              Rating for
              <select
                value={memberId ?? ""}
                onChange={(e) => {
                  setForMember(e.target.value);
                }}
                className="min-h-11 rounded-[10px] border-[1.5px] border-line-strong bg-card px-2 text-sm text-ink"
              >
                {choices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === ready.viewer.memberId ? `Me (${m.displayName})` : m.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <StarRatingInput
            value={rating}
            onValueChange={setRating}
            label="Rating"
            appearance="tiles"
          />
          <span id="quick-tags" className="text-[13px] font-extrabold text-ink-soft">
            Anything else? (tap any)
          </span>
          <TagChips
            tags={QUICK_TAGS}
            selected={tags}
            label="Anything else?"
            onToggle={(t) => {
              setTags((list) =>
                toggleTag(
                  list,
                  t,
                  t === "too_much" || t === "too_little" ? ["too_much", "too_little"] : undefined,
                ),
              );
            }}
          />
          <FormError>{error}</FormError>
          <div className="flex gap-2.5">
            <Link
              href={composeHref(planMealId, { rating, tags, memberId, next })}
              className={buttonClasses(
                "secondary",
                "lg",
                "grow border-[1.5px] border-ink bg-transparent",
              )}
            >
              Say more…
            </Link>
            <Button
              size="lg"
              className="grow"
              loading={busy}
              disabled={rating === 0 && tags.length === 0}
              onClick={() => {
                void done();
              }}
            >
              Done
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
