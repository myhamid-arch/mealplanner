// CSS custom properties for the web app, generated from the token source. Pure string building.
import {
  COLOR_TOKENS,
  colors,
  cssVarName,
  fontFamilies,
  radii,
  shadows,
  type Palette,
} from "../tokens/index.js";

function declarations(palette: Palette, indent: string): string {
  return COLOR_TOKENS.map((token) => `${indent}--${cssVarName(token)}: ${palette[token]};`).join(
    "\n",
  );
}

/**
 * `:root` with the light palette, fonts, radii and shadows, then the dark palette under
 * `prefers-color-scheme: dark` (UX-5; the theme follows the system, SPEC-Q-6).
 */
export function tokensToCss(): string {
  const shared = [
    `  --font-display-family: ${fontFamilies.display};`,
    `  --font-body-family: ${fontFamilies.body};`,
    `  --font-mono-family: ${fontFamilies.mono};`,
    ...Object.entries(radii).map(([name, px]) => `  --radius-${name}-px: ${String(px)}px;`),
    ...Object.entries(shadows).map(([name, value]) => `  --shadow-${name}-value: ${value};`),
  ].join("\n");
  return [
    ":root {",
    "  color-scheme: light dark;",
    declarations(colors.light, "  "),
    shared,
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    declarations(colors.dark, "    "),
    "  }",
    "}",
    "",
  ].join("\n");
}
