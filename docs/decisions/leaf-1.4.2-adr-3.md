# leaf-1.4.2 ADR-3: PWA phase A (manifest, icons, service worker)

Status: proposed (CP1)
Requirement: ARC-8 phase A ("installable PWA: manifest, icons, and a service worker that caches the app shell plus the latest Today plan and cook sheet for offline read"), UX-7

## Manifest
`apps/web/app/manifest.ts` is not in OWNS, so the manifest is a static file `apps/web/public/manifest.webmanifest`, linked from `layout.tsx` metadata. Fields: `name` and `short_name` "Mise" (placeholder, R2-UX-6), `id` "/", `start_url` "/", `scope` "/", `display` "standalone", `background_color` #FFF8EE (paper), `theme_color` #2B2118 (rail), `lang` "en", and icons 192 and 512 (`purpose: any`) plus 512 maskable. `layout.tsx` also sets `apple-touch-icon` (180) and the light/dark `theme-color` metas.

## Icons
Source: `apps/web/public/icons/mise.svg`, the rail's brand mark (chef-hat stroke on the #C4411E tile). PNGs at 180, 192, 512 and 512-maskable (mark inside the 80 % safe zone) are rendered once from that SVG with the preinstalled Chromium and committed. G2 checks each PNG's real pixel size against the manifest.

## Service worker (`apps/web/public/sw.js`, plain JS, no dependency)
- Registered by a small client component in the shell, production builds only, scope "/".
- Served with `Cache-Control: no-cache` and `Service-Worker-Allowed: /` via `next.config.ts` `headers()`.
- Caches, versioned by a build id, old versions deleted on `activate`:
  1. **Precache on install:** `/offline`, the manifest and the icons.
  2. **`/_next/static/**`:** cache-first (immutable, content-hashed).
  3. **Navigations and RSC requests** to `/today` and `/kitchen` (and their sub-paths): network-first, falling back to the last cached response. These pages are server-rendered with their data, so the cached response is the latest Today plan and cook sheet as last seen online (ARC-8's "offline read"). The paths are one exported list in `sw.js`.
  4. **Any other navigation:** network, falling back to `/offline`.
  5. **Never cached:** non-GET requests, `/api/**`, cross-origin requests.
- `message` `{ type: "mise:clear-offline-cache" }` deletes every cache. Sign-out (1.4.6) should post it, so a shared device does not keep a household's plan (SPEC-Q-7).

## Offline page
`apps/web/app/(shell)/offline/page.tsx` renders inside the shell: a UX-7 state ("You're offline", what is still available, a Retry button). It is a real product page, and it is also the page G2 renders at 390 and 1280 px.
