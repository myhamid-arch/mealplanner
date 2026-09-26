// FBK-4 review signal: `s = (rating − 3)/2`, plus the taste tags, clamped to [−1, 1] (SPEC-Q-5).
import {
  NEGATIVE_TASTE_TAGS,
  NEGATIVE_TASTE_TAG_CAP,
  NEGATIVE_TASTE_TAG_SIGNAL,
  POSITIVE_TASTE_TAGS,
} from "./config.js";

const NEGATIVE: ReadonlySet<string> = new Set(NEGATIVE_TASTE_TAGS);

function isPositiveTag(tag: string): tag is keyof typeof POSITIVE_TASTE_TAGS {
  return Object.hasOwn(POSITIVE_TASTE_TAGS, tag);
}

/**
 * The appeal signal of a review, or null when it carries none (no rating and no taste tag).
 * Each tag counts once; non-taste and custom tags carry no appeal signal.
 */
export function reviewSignal(rating: number | null, tags: readonly string[]): number | null {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5))
    throw new RangeError(`rating must be an integer 1–5, got ${String(rating)}`);
  const distinct = new Set(tags);
  let positive = 0;
  let negative = 0;
  let tasteTags = 0;
  for (const tag of distinct) {
    if (isPositiveTag(tag)) {
      positive += POSITIVE_TASTE_TAGS[tag];
      tasteTags += 1;
    } else if (NEGATIVE.has(tag)) {
      negative += NEGATIVE_TASTE_TAG_SIGNAL;
      tasteTags += 1;
    }
  }
  if (rating === null && tasteTags === 0) return null;
  const s =
    (rating === null ? 0 : (rating - 3) / 2) +
    positive +
    Math.max(negative, NEGATIVE_TASTE_TAG_CAP);
  return Math.min(1, Math.max(-1, s));
}
