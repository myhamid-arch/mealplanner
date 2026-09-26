// WCAG 2.x contrast and the declared list of colour pairs the UI uses (UX-5: AA for text in
// both themes). Components colour text only with pairs listed here; G1 checks every pair in
// both themes and maps each rendered pair back to this list.
import {
  avatarInk,
  avatarPalette,
  colors,
  fitColor,
  macroColor,
  toneColor,
  type ColorToken,
  type Palette,
  type Theme,
} from "../tokens/index.js";

/** `normal` text needs 4.5:1; `large` text (≥ 24 px, or ≥ 18.66 px bold) and `nonText` need 3:1. */
export type PairKind = "normal" | "large" | "nonText";

export const AA_THRESHOLD: Readonly<Record<PairKind, number>> = {
  normal: 4.5,
  large: 3,
  nonText: 3,
};

export interface ColorPair {
  readonly fg: ColorToken;
  readonly bg: ColorToken;
  readonly kind: PairKind;
  /** Where the pair appears. */
  readonly use: string;
}

function pair(fg: ColorToken, bg: ColorToken, use: string, kind: PairKind = "normal"): ColorPair {
  return { fg, bg, kind, use };
}

const SURFACES: readonly ColorToken[] = ["paper", "card", "flour"];

/** Merges pairs with the same fg, bg and kind, joining their uses. */
function unique(pairs: readonly ColorPair[]): ColorPair[] {
  const byKey = new Map<string, ColorPair>();
  for (const p of pairs) {
    const key = `${p.fg}/${p.bg}/${p.kind}`;
    const seen = byKey.get(key);
    byKey.set(key, seen === undefined ? p : { ...seen, use: `${seen.use}; ${p.use}` });
  }
  return [...byKey.values()];
}

/** Every foreground/background token pair the UI uses. */
export const TEXT_PAIRS: readonly ColorPair[] = unique([
  // Body text on every surface.
  ...SURFACES.flatMap((bg) => [
    pair("ink", bg, "body text"),
    pair("inkSoft", bg, "secondary text"),
    pair("inkMuted", bg, "labels and metadata"),
  ]),
  // Links sit on paper and card only; on flour #C4411E is 4.16:1.
  pair("action", "paper", "links and text buttons"),
  pair("action", "card", "links and text buttons"),
  pair("inkFaint", "card", "inactive tab labels"),
  pair("actionHover", "paper", "hovered links"),
  pair("actionHover", "card", "hovered links"),
  pair("onAction", "action", "primary button"),
  pair("onAction", "actionHover", "hovered primary button"),
  pair("ink", "lineStrong", "hovered secondary button"),
  pair("paper", "ink", "selected segment of a segmented control"),

  // Tints: chips, status pills, macro chips, fit badges, active tab.
  ...Object.values(toneColor).map(({ fg, bg }) => pair(fg, bg, "chip")),
  ...Object.values(macroColor).map(({ text, tint }) => pair(text, tint, "macro chip")),
  ...Object.values(fitColor).map(({ text, tint }) => pair(text, tint, "fit badge")),
  ...Object.values(fitColor).map(({ text }) => pair(text, "card", "fit label on a card")),
  pair("tomatoText", "tomatoTint", "active tab"),
  ...Object.values(macroColor).map(({ text }) => pair(text, "card", "macro bar label")),
  pair("pomegranateText", "paper", "error message"),

  // Assistant.
  pair("onAgent", "agent", "assistant button, Needs-you card"),
  pair("onAgent", "agentRaised", "assistant card rows"),

  // Desktop rail.
  pair("railInk", "rail", "rail items"),
  pair("railInkStrong", "rail", "brand name"),
  pair("railInkStrong", "railRaised", "account name"),
  pair("railInkMuted", "railRaised", "account role"),
  pair("railInk", "railRaised", "hovered rail item"),
  pair("onRailActive", "railActive", "active rail item"),
  pair("onBadge", "badge", "count badge"),

  // Non-text: focus rings, rating stars (WCAG 1.4.11).
  ...SURFACES.map((bg) => pair("focus", bg, "focus ring", "nonText")),
  pair("focus", "tomatoTint", "focus ring on a selected rating tile", "nonText"),
  pair("railFocus", "rail", "focus ring on the rail", "nonText"),
  pair("railFocus", "railRaised", "focus ring on the rail account card", "nonText"),
  ...SURFACES.map((bg) => pair("starEdge", bg, "star outline", "nonText")),
  pair("starEdge", "tomatoTint", "star outline on the selected rating tile", "nonText"),
  pair("action", "tomatoTint", "selected rating tile border", "nonText"),
]);

/** Avatar fills carry a white initial; checked as normal text. */
export const AVATAR_PAIRS: readonly { fg: string; bg: string }[] = Object.values(avatarPalette).map(
  (bg) => ({
    fg: avatarInk,
    bg,
  }),
);

/** Parses `#RRGGBB` into 0–255 channels. Throws on anything else. */
export function parseHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`not a #RRGGBB colour: ${hex}`);
  return [
    Number.parseInt(match[1] ?? "", 16),
    Number.parseInt(match[2] ?? "", 16),
    Number.parseInt(match[3] ?? "", 16),
  ];
}

function channel(value255: number): number {
  const c = value255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of 0–255 sRGB channels. */
export function luminanceRgb([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x relative luminance of `#RRGGBB`. */
export function luminance(hex: string): number {
  return luminanceRgb(parseHex(hex));
}

/** WCAG 2.x contrast ratio, 1–21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface PairResult extends ColorPair {
  readonly theme: Theme;
  readonly ratio: number;
  readonly threshold: number;
  readonly pass: boolean;
}

/** Checks every declared pair against one palette. */
export function checkPairs(
  theme: Theme,
  palette: Palette = colors[theme],
  pairs: readonly ColorPair[] = TEXT_PAIRS,
): PairResult[] {
  return pairs.map((p) => {
    const ratio = contrastRatio(palette[p.fg], palette[p.bg]);
    const threshold = AA_THRESHOLD[p.kind];
    return { ...p, theme, ratio, threshold, pass: ratio >= threshold };
  });
}
