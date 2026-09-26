# leaf-1.4.2 ADR-3: PWA phase A (manifest, icons, service worker)

Status: accepted (CP1 APPROVED, BLD-8 R-21); built for CP2
Requirement: ARC-8 phase A ("installable PWA: manifest, icons, and a service worker that caches the app shell plus the latest Today plan and cook sheet for offline read"), UX-7

## Manifest
`apps/web/app/manifest.ts` is not in OWNS, so the manifest is a static file `apps/web/public/manifest.webmanifest`, linked from `layout.tsx` metadata. Fields: `name` and `short_name` "Mise" (placeholder, R2-UX-6), `id` "/", `start_url` "/", `scope` "/", `display` "standalone", `background_color` and `theme_color` #FFF8EE (paper: the phone layout's top edge is paper, so the browser chrome blends with it; the rail only appears on desktop), `lang` "en", and icons 192 and 512 (`purpose: any`) plus 512 maskable. `layout.tsx` also sets `apple-touch-icon` (180) and the light/dark `theme-color` metas.

## Icons
Sources: `apps/web/public/icons/icon.svg` (the rail's brand mark: chef-hat stroke on the #C4411E rounded tile) and `icon-maskable.svg` (full-bleed tile, mark inside the 80 % safe zone). PNGs `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `apple-touch-icon.png` (180) were rendered once from them with the preinstalled Chromium (a Playwright screenshot of the SVG at each size) and committed; the SVG is also listed as a `sizes: any` icon. G2 checks each PNG's real pixel size against the manifest.

## Service worker (`apps/web/public/sw.js`, plain JS, no dependency)
- Registered by a small client component rendered from the root layout (`app/(shell)/_shell/sw-register.tsx`), production builds only, scope "/", `updateViaCache: "none"`.
- Served with `Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /` and a `default-src 'self'` CSP via `next.config.ts` `headers()`.
- Caches (names carry a version constant; old versions are deleted on `activate`):
  1. **Precache on install:** `/offline`, the manifest and the icons.
  2. **`/_next/static/**`:** cache-first (immutable, content-hashed).
  3. **Navigations** to `/today` and `/kitchen` (and their sub-paths): network-first; a complete 200 same-origin HTML response is kept, and served when the network fails. These pages are server-rendered with their data, so the kept response is the latest Today plan and cook sheet as last seen online (ARC-8's "offline read"). RSC (client-navigation) requests are not cached: offline, a failed client navigation becomes a document navigation, which the worker answers. The paths are one list in `sw.js`.
  4. **Any other navigation:** network, falling back to `/offline`.
  5. **Never cached:** non-GET requests, `/api/**`, cross-origin requests.
- `message` `{ type: "mise:clear-offline-cache" }` deletes the kept pages (`mise-pages-*`), the only cache holding household data. `clearOfflineCache()` (`app/(shell)/_shell/offline-cache.ts`) deletes them directly and posts the message. Sign-out (1.4.6) calls it (R-21 Q-7). The shell and static caches stay: the first version deleted every cache and re-precached, which fails without a network and lost the offline page (found by the offline test).
- Cache names carry a version constant (`v1`); a change to `sw.js` that changes cached content bumps it, and `activate` deletes the old caches.

## Offline page
`apps/web/app/(shell)/offline/page.tsx` renders inside the shell: a UX-7 state ("You're offline", what is still available, a Retry button). It is a real product page, and it is also the page G2 renders at 390 and 1280 px.
