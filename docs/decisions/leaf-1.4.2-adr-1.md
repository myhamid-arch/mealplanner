# leaf-1.4.2 ADR-1: design tokens, one TypeScript source for web and native

Status: proposed (CP1)
Requirement: UX-5 (colour tokens, light and dark, WCAG AA), ARC-1 (Tailwind v4 with CSS-variable tokens), ARC-8 (phase B uses `ui-tokens`)

## Decision
- `packages/ui-tokens` is the single source. Tokens are plain TypeScript data (hex strings and numbers), with no DOM or React import, so a React Native app can import them unchanged.
  - `@mealplanner/ui-tokens/tokens`: `colors.light`, `colors.dark` (same keys), `radii`, `space`, `fontFamilies`, `fontWeights`, `shadows`, `macroColor` (P = sea, C = saffron, F = olive, kcal = tomato), `avatarPalette`.
  - `@mealplanner/ui-tokens/css`: `tokensToCss()` returns `:root { --paper: …; … }` plus `@media (prefers-color-scheme: dark) { :root { … } }`, and `color-scheme: light dark`. It is pure string building.
  - `@mealplanner/ui-tokens/contrast`: WCAG 2.x relative luminance and contrast ratio, and `TEXT_PAIRS`, the declared list of every foreground/background token pair the UI uses (with a size class: `normal` ≥ 4.5, `large` ≥ 3, `non-text` ≥ 3).
  - These are subpaths through the existing `"./*"` export (BLD-8 R-1). No manifest change is needed.
- Web: `apps/web/app/layout.tsx` (server component) renders `<style id="tokens">{tokensToCss()}</style>` in `<head>`. `globals.css` maps the variables into Tailwind v4 with `@theme inline { --color-paper: var(--paper); … }`, so utilities such as `bg-paper text-ink` follow the theme without a `dark:` variant.
- Theme follows the system (`prefers-color-scheme`). No in-app toggle: no spec ID asks for one (SPEC-Q-6).
- Base names and light values are UX-5's table verbatim. Tokens added from the mockups (tints, darker text variants, rail and tab-bar colours) are named by role. Dark values follow UX-5: `--paper` #1C1714, `--card` #26201B, `--ink` #F6EEE3, accents +12 HSL lightness points (inside UX-5's 10–15 %), except where AA needs a separate text token (aubergine and pomegranate at +12 fail 4.5:1 on the dark card, so text uses `--aubergine-text` / `--pomegranate-text`).

## Alternatives rejected
- A generated `tokens.css` exported from the package: needs a `package.json` export change (owned by 1.1.1) and a drift check between two sources.
- Tailwind `dark:` variants per class: doubles every colour class and lets a component forget its dark pair.

## Consequences
- G1 computes every ratio from `colors.light` / `colors.dark` at run time; no ratio is written down anywhere as a constant.
- A component may use a colour only through a token that appears in `TEXT_PAIRS` for its surface; G1's run-time audit (ADR-4) catches rendered pairs that are not declared.
