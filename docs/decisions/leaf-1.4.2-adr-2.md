# leaf-1.4.2 ADR-2: fonts, icons, motion and primitives

Status: proposed (CP1)
Requirement: UX-5 (typography, Lucide icons, motion), R2-UX-5 (no emoji as UI; drawn stars; coloured-initial avatars; inline stroke SVG), UX-6

## Fonts (self-hosted, no runtime Google Fonts)
Requested dependencies (apps/web, exact versions, `npm view` on 2026-09-26):
- `@fontsource-variable/fraunces@5.3.0`, file `opsz.css`: the mockups load Fraunces with the `opsz` 9..144 axis and weights 500/700; only the variable package carries the optical-size axis.
- `@fontsource/nunito@5.3.0`, weights 400, 600, 700, 800 (the weights the mockups use).
- `@fontsource/jetbrains-mono@5.3.0`, weight 500, used with `font-variant-numeric: tabular-nums`.

`layout.tsx` imports the CSS files. Next.js bundles the woff2 files into `/_next/static/media`, so no request leaves the origin. All three are SIL OFL 1.1.

## Icons
The mockups inline one stroke path per icon (24 × 24, `stroke-width 2`, round caps and joins). `components/ui/icon.tsx` holds exactly those paths (today, plan, recipes, kitchen/chef-hat, reviews/star, insights, family, settings, access, assistant, me, chevrons) and renders inline SVG with `aria-hidden` unless labelled. No icon dependency is added. If the architect prefers the real `lucide-react` package, it is one request (`lucide-react@1.48.0`) and a change to one file (SPEC-Q-8).

## Motion
`motion@13.4.4` (already declared) for card rise and macro-ring value animation. Every animation checks `useReducedMotion()`; CSS transitions sit under `@media (prefers-reduced-motion: no-preference)`.

## Primitives
Radix primitives come from the declared `radix-ui@1.6.7` (Dialog for the sheet/dialog, ToggleGroup for the segmented control). Class names are composed with template strings; no `clsx`/`cva` dependency.
