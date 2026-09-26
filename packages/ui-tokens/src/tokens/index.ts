// Design tokens (UX-5, R2-UX-5). Plain data only: no DOM, no React, so the phase-B React Native
// app (ARC-8) can import this module unchanged. The web app turns it into CSS variables with
// `@mealplanner/ui-tokens/css`.

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Colour roles. The first eleven are UX-5's table; the rest are the colours the approved
 * mockups use, named by role. Keys are camelCase; the CSS variable is the kebab-case form
 * (`inkMuted` → `--ink-muted`).
 */
const light = {
  // UX-5 base palette (values verbatim).
  paper: "#FFF8EE",
  card: "#FFFFFF",
  ink: "#2B2118",
  tomato: "#E4572E",
  saffron: "#F3A712",
  basil: "#3F8F3A",
  aubergine: "#5B2A86",
  sea: "#1F8A8A",
  olive: "#8A8A3A",
  pomegranate: "#B3263E",
  flour: "#F1E7D6",

  // Surfaces and lines.
  line: "#EADFCC",
  lineStrong: "#D9CBB4",

  // Text.
  inkSoft: "#3D3025",
  inkMuted: "#5A4A3B",
  inkFaint: "#6B5B4B",

  // Primary action (the mockups' darker tomato; white on #E4572E is below AA).
  action: "#C4411E",
  actionHover: "#8F2E14",
  onAction: "#FFFFFF",

  // Accent tints (backgrounds) and the text colour that reads on them.
  tomatoTint: "#FDE3D8",
  tomatoText: "#A3351A",
  basilTint: "#E1EFD9",
  basilText: "#2A6E27",
  seaTint: "#D6EFEE",
  seaText: "#17706F",
  saffronTint: "#FCEBC4",
  saffronText: "#7A4F00",
  oliveTint: "#EDEDD2",
  oliveText: "#5E5E14",
  pomegranateTint: "#F6DDE3",
  pomegranateText: "#8E1C30",
  aubergineTint: "#EBDDF6",
  aubergineText: "#5B2A86",

  // Untargeted / neutral status (grey).
  neutral: "#A89A88",
  neutralTint: "#EFE8DD",
  neutralText: "#5A4A3B",

  // Assistant (AI) surfaces.
  agent: "#5B2A86",
  agentRaised: "#6E3C99",
  onAgent: "#FFFFFF",

  // Desktop rail.
  rail: "#2B2118",
  railRaised: "#3A2E23",
  railInk: "#F1E7D6",
  railInkStrong: "#FFF8EE",
  railInkMuted: "#CDBFA9",
  railActive: "#C4411E",
  onRailActive: "#FFFFFF",
  railFocus: "#F3A712",

  // Count badge.
  badge: "#F3A712",
  onBadge: "#2B2118",

  // Focus ring on paper and card.
  focus: "#5B2A86",

  // Rating stars: filled-star fill and the outline of every star (empty stars are flour-filled).
  // The mockups' outline #B7790A is 2.98:1 on the flour rating tiles; #9A6508 is the same hue.
  star: "#F3A712",
  starEdge: "#9A6508",
} as const;

export type ColorToken = keyof typeof light;
export type Palette = Readonly<Record<ColorToken, string>>;

/**
 * Dark theme, "kitchen at night": UX-5's paper, card and ink; accents raised by 12 points of
 * HSL lightness (UX-5: 10–15 %). Where the lightened accent is below AA as text, a separate
 * `*Text` token carries the text colour.
 */
const dark: Palette = {
  paper: "#1C1714",
  card: "#26201B",
  ink: "#F6EEE3",
  tomato: "#EB8364",
  saffron: "#F6BD4C",
  basil: "#55B74F",
  aubergine: "#7B39B5",
  sea: "#2ABCBC",
  olive: "#B4B44D",
  pomegranate: "#D64059",
  flour: "#2E2620",

  line: "#3A3029",
  lineStrong: "#4A3E34",

  inkSoft: "#E3D6C6",
  inkMuted: "#C9B8A3",
  inkFaint: "#B8A791",

  action: "#EB8364",
  actionHover: "#F2A68D",
  onAction: "#1C1714",

  tomatoTint: "#4A2A1F",
  tomatoText: "#F2A68D",
  basilTint: "#1F3A1D",
  basilText: "#8FD38A",
  seaTint: "#143A3A",
  seaText: "#7FD9D9",
  saffronTint: "#3D2F10",
  saffronText: "#F6C766",
  oliveTint: "#34341A",
  oliveText: "#D2D28A",
  pomegranateTint: "#45202A",
  pomegranateText: "#F59BAD",
  aubergineTint: "#33224A",
  aubergineText: "#CDAAF0",

  neutral: "#8C7B69",
  neutralTint: "#332A23",
  neutralText: "#C9B8A3",

  agent: "#4B2370",
  agentRaised: "#5E3187",
  onAgent: "#FFFFFF",

  rail: "#120E0B",
  railRaised: "#2E2620",
  railInk: "#F1E7D6",
  railInkStrong: "#FFF8EE",
  railInkMuted: "#C9B8A3",
  railActive: "#EB8364",
  onRailActive: "#1C1714",
  railFocus: "#F6BD4C",

  badge: "#F6BD4C",
  onBadge: "#1C1714",

  focus: "#CDAAF0",

  star: "#F6BD4C",
  starEdge: "#F6C766",
};

export const colors: Readonly<Record<Theme, Palette>> = { light, dark };

/** Every colour token name, in declaration order. */
export const COLOR_TOKENS = Object.keys(light) as readonly ColorToken[];

/** The eleven tokens UX-5 names, with its light values. */
export const UX5_BASE = {
  paper: "#FFF8EE",
  card: "#FFFFFF",
  ink: "#2B2118",
  tomato: "#E4572E",
  saffron: "#F3A712",
  basil: "#3F8F3A",
  aubergine: "#5B2A86",
  sea: "#1F8A8A",
  olive: "#8A8A3A",
  pomegranate: "#B3263E",
  flour: "#F1E7D6",
} as const satisfies Partial<Palette>;

/** `inkMuted` → `ink-muted`. */
export function cssVarName(token: ColorToken): string {
  return token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

// ---------------------------------------------------------------------------------------------
// Semantic tables: one source for every place that colours a macro or a fit status.
// ---------------------------------------------------------------------------------------------

export const MACROS = ["protein", "carbs", "fat", "kcal"] as const;
export type Macro = (typeof MACROS)[number];

/** UX-5: P = sea, C = saffron, F = olive, kcal = tomato. Fill, tint and text tokens per macro. */
export const macroColor: Readonly<
  Record<Macro, { fill: ColorToken; tint: ColorToken; text: ColorToken; short: string }>
> = {
  protein: { fill: "sea", tint: "seaTint", text: "seaText", short: "P" },
  carbs: { fill: "saffron", tint: "saffronTint", text: "saffronText", short: "C" },
  fat: { fill: "olive", tint: "oliveTint", text: "oliveText", short: "F" },
  kcal: { fill: "tomato", tint: "tomatoTint", text: "tomatoText", short: "kcal" },
};

/** Plate fit (UX-4 Today): the solver's statuses plus `untargeted` for members without targets. */
export const FIT_STATUSES = ["in_tolerance", "flexible_miss", "infeasible", "untargeted"] as const;
export type FitStatus = (typeof FIT_STATUSES)[number];

/**
 * Fit colours (UX-4: green in tolerance, amber flexible miss, red infeasible, grey untargeted)
 * and the text and icon that go with them, because colour is never the only signal (UX-6).
 */
export const fitColor: Readonly<
  Record<
    FitStatus,
    { fill: ColorToken; tint: ColorToken; text: ColorToken; label: string; icon: FitIcon }
  >
> = {
  in_tolerance: {
    fill: "basil",
    tint: "basilTint",
    text: "basilText",
    label: "On target",
    icon: "check",
  },
  flexible_miss: {
    fill: "saffron",
    tint: "saffronTint",
    text: "saffronText",
    label: "Close to target",
    icon: "approx",
  },
  infeasible: {
    fill: "pomegranate",
    tint: "pomegranateTint",
    text: "pomegranateText",
    label: "Off target",
    icon: "cross",
  },
  untargeted: {
    fill: "neutral",
    tint: "neutralTint",
    text: "neutralText",
    label: "No targets",
    icon: "dash",
  },
};
export type FitIcon = "check" | "approx" | "cross" | "dash";

/** Chip / pill tones: a tint background with its text colour. */
export const TONES = [
  "neutral",
  "tomato",
  "basil",
  "sea",
  "saffron",
  "olive",
  "pomegranate",
  "aubergine",
] as const;
export type Tone = (typeof TONES)[number];
export const toneColor: Readonly<Record<Tone, { bg: ColorToken; fg: ColorToken }>> = {
  neutral: { bg: "flour", fg: "inkMuted" },
  tomato: { bg: "tomatoTint", fg: "tomatoText" },
  basil: { bg: "basilTint", fg: "basilText" },
  sea: { bg: "seaTint", fg: "seaText" },
  saffron: { bg: "saffronTint", fg: "saffronText" },
  olive: { bg: "oliveTint", fg: "oliveText" },
  pomegranate: { bg: "pomegranateTint", fg: "pomegranateText" },
  aubergine: { bg: "aubergineTint", fg: "aubergineText" },
};

/**
 * Coloured-initial avatars (R2-UX-5). The names are the values stored in `member.color`
 * (02-domain-model: "color (token name)"), which people choose in onboarding and family
 * settings; the family leaf offers `AVATAR_COLORS` as the choices. Each fill carries a white
 * initial and is the same in both themes. `saffron` is #9A6508 because the mockups' #B7790A is
 * 3.65:1 against white.
 */
export const AVATAR_COLORS = [
  "sea",
  "aubergine",
  "pomegranate",
  "saffron",
  "basil",
  "tomato",
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export const avatarPalette: Readonly<Record<AvatarColor, string>> = {
  sea: "#17706F",
  aubergine: "#5B2A86",
  pomegranate: "#B3263E",
  saffron: "#9A6508",
  basil: "#2F7A2B",
  tomato: "#C4411E",
};
export const avatarInk = "#FFFFFF";

export function isAvatarColor(value: unknown): value is AvatarColor {
  return typeof value === "string" && (AVATAR_COLORS as readonly string[]).includes(value);
}

/**
 * Fallback colour for a member with no stored colour yet: FNV-1a over the key's UTF-16 units
 * (member id), so it is stable across renders. A stored `member.color` always wins.
 */
export function fallbackAvatarColor(key: string): AvatarColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "sea";
}

/** The avatar fill: the stored colour when it is a known name, else the id-hash fallback. */
export function resolveAvatarColor(stored: string | null | undefined, key: string): AvatarColor {
  return isAvatarColor(stored) ? stored : fallbackAvatarColor(key);
}

// ---------------------------------------------------------------------------------------------
// Type, shape and space (from the mockups).
// ---------------------------------------------------------------------------------------------

export const fontFamilies = {
  display: "'Fraunces Variable', Fraunces, Georgia, serif",
  body: "Nunito, 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
} as const;

export const fontWeights = {
  regular: 400,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  displayMedium: 500,
  displayBold: 700,
  mono: 500,
} as const;

/** Type scale in px (mockups: 12 labels, 14–15 body, 20–32 display). */
export const fontSizes = {
  xs: 12,
  sm: 13,
  md: 14,
  base: 15,
  lg: 17,
  xl: 20,
  "2xl": 22,
  "3xl": 28,
  "4xl": 32,
} as const;

/** Corner radii in px. `card` is UX-5's recipe-card radius. */
export const radii = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  card: 16,
  xl: 18,
  "2xl": 20,
  pill: 999,
} as const;

/** Spacing scale: 4 px steps. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** Shadows, as CSS strings; `line` resolves against the active theme. */
export const shadows = {
  card: "0 1px 0 var(--line)",
  raised: "0 10px 24px rgb(91 42 134 / 0.4)",
  sheet: "0 -8px 32px rgb(43 33 24 / 0.18)",
} as const;

/** Layout constants shared by the shell and its tests. */
export const layout = {
  railWidth: 240,
  tabBarHeight: 84,
  assistantButton: 58,
  desktopMinWidth: 1024,
  minTarget: 44,
} as const;
