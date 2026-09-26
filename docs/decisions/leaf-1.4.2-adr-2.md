# leaf-1.4.2 ADR-2: fonts, icons, motion and primitives

Status: accepted (CP1 APPROVED, BLD-8 R-21); built for CP2
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
Built with CSS keyframes rather than `motion`: card rise (`.rise`), macro-ring arcs drawing in (`.ring-arc`, a keyframe with no `to` frame, so each arc animates to its own `stroke-dasharray`), sheet and overlay entry, skeleton pulse. All sit under `@media (prefers-reduced-motion: no-preference)`.
Reason: `motion` server-renders an element's `initial` state, so a ring animated with `motion.circle` shows empty arcs in server-rendered HTML and without JavaScript (found in the defect-hunt pass). The CSS version renders the final values and animates on load. `motion@13.4.4` stays declared for the later animations UX-5 names (proposal "stamp", pot-stirring progress), which run after user actions on hydrated pages.

## Primitives
Radix primitives come from the declared `radix-ui@1.6.7`: Dialog for the sheet/dialog, RadioGroup for the segmented control (the mockup marks it `role="radiogroup"`). `StarRatingInput` uses native radio inputs (arrow keys, one Tab stop, "3 of 5" labels) and `StarRatingDisplay` draws half stars with a clip path (CP1 amendment 7). Class names are composed with template strings; no `clsx`/`cva` dependency.
