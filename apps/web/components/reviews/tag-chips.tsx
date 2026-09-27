"use client";

import { tagLabel } from "./tags";

export interface TagChipsProps {
  readonly tags: readonly string[];
  readonly selected: readonly string[];
  readonly onToggle: (tag: string) => void;
  /** Accessible name of the group ("Anything else?", "Saffron rice"). */
  readonly label: string;
  /** At most one selected at a time (the "How often?" choice). */
  readonly single?: boolean;
  readonly size?: "md" | "sm";
  /** Grid of equal cells (ReviewComposePhone's "How often?") instead of wrapping pills. */
  readonly grid?: boolean;
  readonly disabled?: boolean;
}

/**
 * One-tap tag chips (QuickRatePhone, ReviewComposePhone): toggle buttons with `aria-pressed`; the
 * selected state is also carried by a check mark, not only by colour (UX-6).
 */
export function TagChips({
  tags,
  selected,
  onToggle,
  label,
  single = false,
  size = "md",
  grid = false,
  disabled = false,
}: TagChipsProps) {
  const sizing = size === "sm" ? "px-3 text-[13px]" : "px-3.5 text-sm";
  return (
    <div
      role="group"
      aria-label={label}
      className={grid ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-2"}
    >
      {tags.map((tag) => {
        const on = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            data-tag={tag}
            onClick={() => {
              onToggle(tag);
            }}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 font-extrabold transition-colors disabled:opacity-60 ${sizing} ${
              grid ? "rounded-md" : "rounded-full"
            } ${on ? "bg-basil-text text-paper" : "bg-flour text-ink hover:bg-line-strong"}`}
          >
            {on && (
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden focusable="false">
                <path
                  d="M5 12l5 5L20 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {tagLabel(tag)}
            {single && <span className="sr-only">{on ? " (chosen)" : ""}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Toggles `tag` in `list`; with `single`, it replaces any other tag of `group`. */
export function toggleTag(
  list: readonly string[],
  tag: string,
  group?: readonly string[],
): string[] {
  if (list.includes(tag)) return list.filter((t) => t !== tag);
  const kept = group === undefined ? list : list.filter((t) => !group.includes(t));
  return [...kept, tag];
}
