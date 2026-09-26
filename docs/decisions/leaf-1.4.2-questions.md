# leaf-1.4.2 spec questions

Each question states the conservative reading this leaf builds on. None blocks a gate. Rulings: BLD-8 R-21 (CP1 APPROVED, PR #5).

## SPEC-Q-1: the shell layout cannot wrap the screens under `(app)`
1.4.2 owns `app/(shell)/**`, but the screens of 1.4.3–1.4.6 live under `app/(app)/**`. A Next.js route-group layout only wraps routes inside its own group, and `app/(app)/layout.tsx` has no owner. The root `layout.tsx` cannot host the shell either, because sign-in, invite, onboarding and platform pages must not show the rail.
- Reading taken: the shell is a component set in `app/(shell)/_shell/` (a private folder, not routes) plus `app/(shell)/layout.tsx`, which uses it. The only route under `(shell)` is `/offline` (ADR-3).
- Proposal: add `apps/web/app/(app)/layout.tsx` to 1.4.2's OWNS. Its whole content is `export { default } from "../(shell)/layout";`. If the architect prefers, the first screen leaf can create that file instead with the same line.

Ruling: accepted (R-21 Q-1). Built. During the defect hunt a temporary page under `(app)` compiled with the re-exported layout (`next build` listed it), then was removed.

## SPEC-Q-2: phone tab bar is "Me" in the mockup, "More" in UX-3; the desktop rail adds People & access
`TabBar.dc.html` has Today · Plan · Recipes · Reviews · **Me**; UX-3 says **More**. `Rail.dc.html` has nine items (adds People & access, from r2). The mockups are the approved r2 reference, so the leaf builds the mockup versions.
- Consequence to confirm: on a phone, an admin reaches Family, Insights, Settings and People & access from the Me screen (TastePhone/AccountPhone are both `active="me"`), and through the assistant. The Me screen belongs to a later leaf.

Ruling: the mockups win (R-21 Q-2). Built as the mockups.

## SPEC-Q-3: route paths for navigation items
No spec file fixes URL paths. The shell uses one route table (`app/(shell)/_shell/nav.ts`) derived from the OWNS globs of the screen leaves: `/today`, `/plan`, `/recipes`, `/kitchen`, `/reviews`, `/insights`, `/family`, `/settings`, `/access`, `/chat`, `/account`. The Me tab links to `/family/me` (the mockup links Me to "My tastes", which is part of 1.4.3's family area). Please confirm, or name the Me target.

Ruling: accepted, Me → `/family/me`; the routes need not resolve yet (R-21 Q-3). Only `/offline` is rendered by this leaf.

## SPEC-Q-4: "Lighthouse PWA installability" no longer exists
Lighthouse removed the PWA category, including the `installable-manifest` audit, in v12 (2024). The current release, 13.5.0, has no installability audit (checked in this session by listing its audits). Pinning Lighthouse 11.7.1 would add a two-year-old dependency for one audit.
- Reading taken: G2 calls Chromium's `Page.getInstallabilityErrors` over CDP, the check that audit wrapped, with Playwright (already declared), plus manifest and icon-size assertions (ADR-4). No dependency is added.
- Alternative if the architect wants Lighthouse by name: request `lighthouse@11.7.1` as a devDependency of apps/web.

Ruling: CDP accepted; no Lighthouse (R-21 Q-4).

## SPEC-Q-5: where the shell gets the signed-in user and role
UX-3 navigation is role-based, but auth is not in this leaf (1.4.1 / 1.4.6). The shell takes a `viewer: { name, role, householdName, memberColorKey } | null` prop, and `navFor(role)` returns the items per role:
- admin: Today, Plan, Recipes, Kitchen, Reviews, Insights, Family, Settings, People & access, plus the Assistant button (rail) or floating button (phone), plus the account card.
- member: Today, Plan, Recipes, Reviews, My tastes (UX-3).
- kitchen: Kitchen, Plan, Recipes (ARC-6: kitchen reads plans and recipes; PRD users table: read-only cook sheets and recipes). Kitchen lands on Kitchen: `homePathFor(role)` is exported for 1.4.4's `/` page.
- `null` (no session known to the shell yet): the member set, no Assistant, no account card (least privilege).
- Reading taken: `app/(shell)/layout.tsx` gets the viewer from `app/(shell)/_shell/viewer.ts`, which returns `null` in this leaf. Proposal: when 1.4.1/1.4.6 merge, the architect hands `viewer.ts` to the leaf that owns sessions, which replaces its body with the real session lookup. The G3 screenshots render the admin, member and kitchen variants directly from the component.

Ruling: accepted; `viewer.ts` passes to 1.4.1 when this leaf merges (R-21 Q-5).

## SPEC-Q-6: theme selection
UX-5 defines light and dark themes but no setting to choose between them. The theme follows the system `prefers-color-scheme`. No toggle is built.

Ruling: accepted (R-21 Q-6).

## SPEC-Q-7: clearing offline data on sign-out
ARC-8 caches the latest Today plan and cook sheet on the device. On a shared device, signing out should remove them. The service worker clears every cache on the message `{ type: "mise:clear-offline-cache" }`; the shell exports `clearOfflineCache()`. 1.4.6 (sign-out) should call it. Please confirm and note it in 1.4.6's brief.

Ruling: accepted; 1.4.6's sign-out calls `clearOfflineCache()` (R-21 Q-7). As built, it deletes only the kept pages (`mise-pages-*`); see ADR-3.

## SPEC-Q-8: "Lucide icons" versus the mockups' inline paths
UX-5 names Lucide; R2-UX-5 says "inline stroke SVG (Lucide)". The mockups inline their own Lucide-style paths, and these are the visual contract. Reading taken: use the mockups' paths in one `Icon` component and add no dependency (ADR-2). Alternative: request `lucide-react@1.48.0`.

Ruling: accepted, mockup paths (R-21 Q-8).

## SPEC-Q-9: primitives beyond the brief's list
R2-UX-5 requires drawn stars for ratings, used by 1.4.4 (quick review row) and 1.4.5. The brief's primitive list does not include a star rating, so this leaf does not build one; 1.4.5 builds it in `components/reviews/`. Please say if it should be a primitive here instead.

Ruling: overruled (R-21 Q-9). Built here: `StarRatingDisplay` (half stars) and `StarRatingInput` (radio group, tiles or row).
