import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AVATAR_PAIRS,
  checkPairs,
  contrastRatio,
  parseHex,
  TEXT_PAIRS,
} from "../src/contrast/index.js";
import { tokensToCss } from "../src/css/index.js";
import {
  AVATAR_COLORS,
  avatarPalette,
  fallbackAvatarColor,
  resolveAvatarColor,
  COLOR_TOKENS,
  colors,
  cssVarName,
  FIT_STATUSES,
  fitColor,
  macroColor,
  THEMES,
  UX5_BASE,
} from "../src/tokens/index.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

describe("palettes", () => {
  it("light and dark define the same tokens, all #RRGGBB", () => {
    expect(Object.keys(colors.dark).sort()).toEqual([...COLOR_TOKENS].sort());
    for (const theme of THEMES) {
      for (const token of COLOR_TOKENS) {
        expect(colors[theme][token], `${theme}.${token}`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("keeps UX-5's light values and dark paper, card and ink", () => {
    for (const [token, value] of Object.entries(UX5_BASE)) {
      expect(colors.light[token as keyof typeof UX5_BASE]).toBe(value);
    }
    expect(colors.dark.paper).toBe("#1C1714");
    expect(colors.dark.card).toBe("#26201B");
    expect(colors.dark.ink).toBe("#F6EEE3");
  });

  it("maps macros as UX-5 says: P sea, C saffron, F olive, kcal tomato", () => {
    expect(macroColor.protein.fill).toBe("sea");
    expect(macroColor.carbs.fill).toBe("saffron");
    expect(macroColor.fat.fill).toBe("olive");
    expect(macroColor.kcal.fill).toBe("tomato");
  });

  it("maps fit: green, amber, red, grey, each with a label and an icon", () => {
    expect(FIT_STATUSES.map((s) => fitColor[s].fill)).toEqual([
      "basil",
      "saffron",
      "pomegranate",
      "neutral",
    ]);
    expect(new Set(FIT_STATUSES.map((s) => fitColor[s].icon)).size).toBe(4);
    expect(new Set(FIT_STATUSES.map((s) => fitColor[s].label)).size).toBe(4);
  });
});

describe("contrast", () => {
  it("computes known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(() => parseHex("#FFF")).toThrow();
  });

  it("every declared pair meets AA in both themes", () => {
    for (const theme of THEMES) {
      const failures = checkPairs(theme).filter((r) => !r.pass);
      expect(failures, JSON.stringify(failures, null, 1)).toEqual([]);
    }
  });

  it("fails a pair that is below AA (negative control)", () => {
    const weak = { ...colors.light, inkMuted: "#A89A88" };
    const failing = checkPairs("light", weak).filter((r) => !r.pass);
    expect(failing.some((r) => r.fg === "inkMuted")).toBe(true);
  });

  it("every avatar colour carries its initial at AA", () => {
    for (const { fg, bg } of AVATAR_PAIRS)
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("declares each pair once", () => {
    const keys = TEXT_PAIRS.map((p) => `${p.fg}/${p.bg}/${p.kind}`);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("css", () => {
  it("emits every token for both themes", () => {
    const css = tokensToCss();
    for (const token of COLOR_TOKENS) {
      expect(css).toContain(`--${cssVarName(token)}: ${colors.light[token]};`);
      expect(css).toContain(`--${cssVarName(token)}: ${colors.dark[token]};`);
    }
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(cssVarName("inkMuted")).toBe("ink-muted");
  });
});

describe("avatars", () => {
  it("picks a stable colour from the palette", () => {
    expect(fallbackAvatarColor("member-1")).toBe(fallbackAvatarColor("member-1"));
    expect(AVATAR_COLORS).toContain(fallbackAvatarColor("Omar"));
    expect(Object.keys(avatarPalette)).toEqual([...AVATAR_COLORS]);
    const spread = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(fallbackAvatarColor),
    );
    expect(spread.size).toBeGreaterThan(2);
  });

  it("a stored colour wins over the id hash; an unknown name falls back", () => {
    const key = "member-1";
    const other = AVATAR_COLORS.find((c) => c !== fallbackAvatarColor(key)) ?? "sea";
    expect(resolveAvatarColor(other, key)).toBe(other);
    expect(resolveAvatarColor(null, key)).toBe(fallbackAvatarColor(key));
    expect(resolveAvatarColor("teal", key)).toBe(fallbackAvatarColor(key));
  });
});

describe("portability (ARC-8 phase B)", () => {
  it("source imports nothing from React or the DOM", () => {
    for (const dir of readdirSync(SRC, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const text = readFileSync(join(SRC, dir.name, "index.ts"), "utf8");
      expect(text).not.toMatch(/from "react|from "react-dom|\bdocument\.|\bwindow\./);
    }
  });
});
