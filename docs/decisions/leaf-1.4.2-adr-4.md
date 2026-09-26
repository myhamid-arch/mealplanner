# leaf-1.4.2 ADR-4: how G1 and G2 are verified

Status: accepted (CP1 APPROVED, BLD-8 R-21); built for CP2
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

The browser-side assertions and their negative controls are Playwright tests in `apps/web/e2e/shell.spec.ts`, tagged `@G1` / `@G2`. The verify script builds `ui-tokens` and the web app, runs `playwright test e2e/shell.spec.ts --grep @G<n> --reporter=json` against `next start` on a free port, and requires every expected test title, negative controls included, to be present and `passed` (none skipped). The static checks and their negative controls run in the script itself.

## As built
- G1 static: 52 tokens, UX-5 values, 54 declared pairs per theme with an independent WCAG implementation that must agree with the package's to 0.01, avatar pairs, every token mapped in `globals.css`, no raw hex colour in component/shell/CSS source, no React/DOM import in `ui-tokens`, the package's unit tests. Negative controls: a weak `ink-muted`, a dark palette missing a key, a changed UX-5 value, an unmapped token, a file with raw hex colours.
- G1 rendered: `/offline`, and four shell variants (admin on Today, member on Me, kitchen on Kitchen, signed out) each wrapping a page of every primitive, plus an open sheet, at 390 and 1280 px in light and dark. Every visible text node's colour and composited background must meet AA for its rendered size and map to a declared pair; text over an image or gradient is reported; no emoji in the page text. Negative controls: an injected low-contrast element, an AA-passing but undeclared colour pair, text on a gradient, an emoji string.
- G2: no horizontal scroll and 44 px targets for `/offline` and every shell variant at both widths and themes; rail at 1280, tab bar at 390; landmarks; self-hosted fonts loaded with no cross-origin request; navigation items per role, one current item, assistant and account only for the right roles; the rating input's radio group with arrow keys; rings/bars/stars carry their data in static markup; installability (`Page.getInstallabilityErrors` empty, no manifest errors, a worker controls the page, icon pixels match declared sizes); offline reading of Today, the offline fallback, and clearing on sign-out. Negative controls: a 1600 px element, a 30 px link, a manifest without icons.
- Server-rendering the components inside Playwright: Playwright loads the spec as native ESM and compiles JSX in imported `.tsx` against its component-testing runtime. The spec registers an in-thread resolve hook (Node 22 `module.registerHooks`) that sends that runtime back to `react/jsx-runtime` and replaces `next/link`, which Node's ESM loader cannot import by bare name, with a module rendering what Link renders as static markup (`<a href>`, checked with react-dom/server). Only the spec's own process is affected.
- Offline is simulated with `context.route(... abort)`: Playwright applies context routes to service-worker fetches in Chromium, whereas `setOffline()` was not applied to a restarted service-worker target (the second offline navigation reached the server in this session).

## Browser
`playwright.config.ts` uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set (this container's Chromium is `/opt/pw-browsers/chromium`, a different build from the one @playwright/test 1.63.0 downloads), otherwise Playwright's own Chromium.
