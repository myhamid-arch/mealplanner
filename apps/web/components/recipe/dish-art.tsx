// Dish illustration (UX-5, leaf-1.4.4 ADR-2): a gradient-and-shapes composition drawn in CSS,
// deterministic from the dish id and cuisine (the mockups' food tiles). Colours are UX-5 tokens
// only; no emoji (R2-UX-5). Decorative unless `label` is given.
import type { CSSProperties } from "react";
import { cuisineFamily } from "../plan/logic";

const ACCENTS = ["tomato", "saffron", "basil", "sea", "aubergine", "olive", "pomegranate"] as const;
type Accent = (typeof ACCENTS)[number];

/** FNV-1a over the string: a stable 32-bit hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export interface DishArtParts {
  base: Accent;
  blobs: Array<{ x: number; y: number; r: number; color: Accent | "paper" }>;
}

/** The composition for a dish: base colour from the cuisine family, shapes from the id. */
export function dishArt(dishId: string, cuisineKey: string): DishArtParts {
  const h = hash(dishId);
  const family = cuisineFamily(cuisineKey).tone;
  const base: Accent = family === "neutral" ? "olive" : family;
  const others = ACCENTS.filter((a) => a !== base);
  const pick = (n: number) => others[n % others.length] ?? "saffron";
  return {
    base,
    blobs: [
      { x: 28 + (h % 16), y: 42 + ((h >>> 4) % 18), r: 24 + ((h >>> 8) % 8), color: "paper" },
      {
        x: 62 + ((h >>> 12) % 14),
        y: 38 + ((h >>> 16) % 20),
        r: 16 + ((h >>> 20) % 8),
        color: pick(h >>> 3),
      },
      {
        x: 74 + ((h >>> 24) % 10),
        y: 70 + ((h >>> 6) % 12),
        r: 9 + ((h >>> 10) % 6),
        color: pick(h >>> 13),
      },
    ],
  };
}

const colorVar = (c: Accent | "paper") => (c === "paper" ? "var(--paper)" : `var(--${c})`);

export function DishArt({
  dishId,
  cuisineKey,
  className = "",
  label,
  muted = false,
}: {
  readonly dishId: string;
  readonly cuisineKey: string;
  readonly className?: string;
  /** Accessible name; omit for a decorative tile next to the dish name. */
  readonly label?: string;
  /** Retired dishes: a flat grey tile (RecipeLibrary). */
  readonly muted?: boolean;
}) {
  const art = dishArt(dishId, cuisineKey);
  // Radii are relative to the tile's smaller side (percent of width keeps the mockups' look).
  const style: CSSProperties = muted
    ? { background: "var(--ink-faint)" }
    : {
        backgroundColor: colorVar(art.base),
        backgroundImage: art.blobs
          .map(
            (b) =>
              `radial-gradient(circle at ${String(b.x)}% ${String(b.y)}%, ${colorVar(b.color)} 0 ${String(
                b.r,
              )}%, transparent ${String(b.r + 1)}%)`,
          )
          .join(", "),
      };
  return (
    <span
      className={`block shrink-0 ${className}`}
      style={style}
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    />
  );
}
