"use client";

import { useId } from "react";

// Drawn stars (R2-UX-5: no emoji rating scale). Path from the mockups' star icon.
const STAR = "M12 3l2.7 5.6l6.1.9l-4.4 4.3l1 6.1L12 17l-5.4 2.9l1-6.1L3.2 9.5l6.1-.9z";

/** Rounds to the nearest half star within 0–5. */
export function roundToHalf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(5, Math.max(0, Math.round(value * 2) / 2));
}

/** One star, filled 0, ½ or 1. Outline in `--star-edge`, fill `--star`, empty `--flour`. */
function StarGlyph({ fill, size }: { readonly fill: 0 | 0.5 | 1; readonly size: number }) {
  const clip = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {fill === 0.5 && (
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" width="12" height="24" />
          </clipPath>
        </defs>
      )}
      <path d={STAR} fill="var(--flour)" />
      {fill > 0 && (
        <path
          d={STAR}
          fill="var(--star)"
          {...(fill === 0.5 ? { clipPath: `url(#${clip})` } : {})}
        />
      )}
      <path
        d={STAR}
        fill="none"
        stroke="var(--star-edge)"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fillFor(position: number, value: number): 0 | 0.5 | 1 {
  if (value >= position) return 1;
  if (value >= position - 0.5) return 0.5;
  return 0;
}

export interface StarRatingDisplayProps {
  /** 0–5; averages are shown to the nearest half star. */
  readonly value: number;
  readonly size?: 14 | 16 | 20 | 30;
  /** Review count, shown after the stars ("4.5 · 12"). */
  readonly count?: number;
  readonly showValue?: boolean;
  readonly className?: string;
}

/** Read-only rating (RecipeLibrary, RecipePage): drawn stars with half-star display. */
export function StarRatingDisplay({
  value,
  size = 16,
  count,
  showValue = false,
  className = "",
}: StarRatingDisplayProps) {
  const shown = roundToHalf(value);
  const spoken = Number.isInteger(shown) ? String(shown) : shown.toFixed(1);
  const label =
    count === undefined
      ? `Rated ${spoken} out of 5`
      : `Rated ${spoken} out of 5 from ${String(count)} ${count === 1 ? "review" : "reviews"}`;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span role="img" aria-label={label} className="inline-flex gap-0.5">
        {[1, 2, 3, 4, 5].map((position) => (
          <StarGlyph key={position} fill={fillFor(position, shown)} size={size} />
        ))}
      </span>
      {(showValue || count !== undefined) && (
        <span aria-hidden className="tabular text-[13px] text-ink-muted">
          {showValue ? spoken : null}
          {showValue && count !== undefined ? " · " : null}
          {count !== undefined ? String(count) : null}
        </span>
      )}
    </span>
  );
}

export interface StarRatingInputProps {
  /** 1–5, or 0 when nothing is chosen yet. */
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  /** Accessible name of the group, e.g. "Rating for lunch". */
  readonly label: string;
  /**
   * `tiles`: five 58 px tiles (QuickRatePhone.dc.html). `row`: a row of 30 px stars with 44 px
   * targets (ReviewComposePhone.dc.html).
   */
  readonly appearance?: "tiles" | "row";
  readonly name?: string;
  readonly disabled?: boolean;
}

/**
 * Rating input: a native radio group, so arrow keys move and select, Tab enters and leaves the
 * group once, and each star is announced as "3 of 5".
 */
export function StarRatingInput({
  value,
  onValueChange,
  label,
  appearance = "tiles",
  name,
  disabled = false,
}: StarRatingInputProps) {
  const generated = useId();
  const group = name ?? generated;
  const tiles = appearance === "tiles";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={tiles ? "grid grid-cols-5 gap-2" : "inline-flex gap-0"}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const checked = value === n;
        return (
          <label
            key={n}
            className={`star-tile relative flex cursor-pointer items-center justify-center ${
              tiles
                ? `h-[58px] rounded-card border-[2.5px] ${checked ? "border-action bg-tomato-tint" : "border-transparent bg-flour"}`
                : "size-11 rounded-md"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <input
              type="radio"
              name={group}
              value={n}
              checked={checked}
              disabled={disabled}
              onChange={() => {
                onValueChange(n);
              }}
              className="sr-only"
            />
            <StarGlyph fill={value >= n ? 1 : 0} size={30} />
            <span className="sr-only">{`${String(n)} of 5`}</span>
          </label>
        );
      })}
    </div>
  );
}
