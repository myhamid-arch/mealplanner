# leaf-1.4.2 ADR-4: how G1 and G2 are verified

Status: proposed (CP1)
Requirement: BLD-5 1.4.2 G1, G2; UX-5; UX-6; ARC-8

`scripts/verify/leaf-1.4.2.mjs --gate G1|G2` imports only `scripts/verify/lib/*` (unchanged) and prints `VERIFY leaf-1.4.2 <gate> PASSED` only after every assertion, negative controls included, holds.

## G1: tokens and contrast
1. Build `@mealplanner/ui-tokens` with tsc and import the compiled `tokens` and `contrast` modules.
2. Structure: `colors.light` and `colors.dark` have identical key sets; every value is a 6-digit hex; the eleven UX-5 tokens exist with UX-5's light values and UX-5's dark paper/card/ink.
3. Static pairs: every `TEXT_PAIRS` entry, in both themes, meets its threshold (4.5 normal, 3 large/non-text). Ratios are computed by a WCAG luminance function written in the verify script, independently of the package's own `contrast` module; the two must agree to 0.01 on every pair.
4. Rendered pairs: build and start the web app, open the shell at 390 and 1280 px in light and dark (`colorScheme` emulation), and for every element with visible text read its computed colour and effective background (walking ancestors, compositing alpha). Each rendered pair must meet AA for its size and must map to a declared `TEXT_PAIRS` entry.
5. Negative controls:
   - a copy of the light palette with `ink-muted` set to #A89A88 must fail step 3;
   - the same page with one injected low-contrast element (#B8A791 on #FFF8EE) must fail step 4;
   - a dark palette missing one key must fail step 2.

## G2: no horizontal scroll, installability
1. `next build` then `next start` on a free port.
2. At 390 × 844 and 1280 × 800, light and dark: `document.documentElement.scrollWidth <= innerWidth` and the same for `body`; the tab bar is visible at 390 and the rail at 1280, not the other.
3. Installability: Lighthouse removed its PWA category and the `installable-manifest` audit in v12; the current release (13.5.0, checked in this session) has no installability audit. The script therefore asks Chromium directly, through the DevTools protocol call that audit was built on: `Page.getInstallabilityErrors` must return an empty list, with a persistent browser profile (an incognito context always reports `in-incognito`). It also checks `Page.getAppManifest` reports no parse errors, a service worker controls the page after reload, and each manifest icon's PNG pixel size equals its declared size (SPEC-Q-4).
4. Negative controls:
   - a page with a forced 1600 px-wide element must fail step 2;
   - the same server with the manifest replaced (via request interception) by one with no icons must return installability errors in step 3.

The Playwright specs in `apps/web/e2e/shell.spec.ts` hold the browser-side assertions; the verify script runs them with `pnpm --filter @mealplanner/web exec playwright test e2e/shell.spec.ts`, then runs the negative controls through the same helper functions with the bad inputs.

## Browser
`playwright.config.ts` uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set (this container's Chromium is `/opt/pw-browsers/chromium`, a different build from the one @playwright/test 1.63.0 downloads), otherwise Playwright's own Chromium.
