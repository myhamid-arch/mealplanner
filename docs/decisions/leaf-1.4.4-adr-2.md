# leaf-1.4.4 ADR-2: data access, interaction and print, with no new dependencies

Status: accepted (CP1 APPROVED); built for CP2
Requirement: ARC-5 (one contract), UX-4, UX-5, UX-6, PLN-14

## Data access
Screens are client components that call the API through `createApiClient({ baseUrl: "" })` and the endpoint objects of `@mealplanner/api-contract/contract` (same origin, session cookie), as 1.4.3 does. Response types are `z.output<typeof c.<Dto>>`; nothing re-declares a DTO. Server components only decide the frame: `getShellViewer()` (1.4.1) gives the role for redirects (`/` → `homePathFor(role)`, kitchen on `/today` → `/kitchen`) and for the signed-out empty state. Writes: plan actions through their endpoints (`plans.generate`, `planMeals.swap|lock|unlock`, `cookSheets.flag`), meal overrides and recipe edits through `POST /change-sets` (`meal_override.set|remove`, `dish.update`, `dish.retire`). Job progress: `GET /jobs/{id}/events` (SSE, `EventSource`) until `done` / `failed`.

## Interaction
- Swap, meal detail and override are `Sheet` / `Dialog` from `components/ui` (Radix, 1.4.2), so focus trapping and Escape come from there.
- Drag to move: out of v1 (R-52, W-5).
- Variant tabs on the recipe page: WAI-ARIA tabs (roving tabindex, arrow keys).
- Kitchen step check-offs and "Large text": remembered in `localStorage` (wrapped in try/catch; the page works without it). Large text sets the root font size to 125 % while the cook sheet is open, so every rem-based size grows and the layout stays fluid.
- One layout is rendered per breakpoint (`useWide`, 1024 px), not two hidden by CSS, so each control exists once for assistive technology and tests.
- Motion: the design system's own CSS animations (sheets, cards, the macro ring); this leaf adds none.

## Print (PLN-14)
The cook sheet has a print stylesheet in its own component (Tailwind `print:` variants plus a `<style>` with `@page { size: A4; margin: 12mm }` and the rules that hide the shell's navigation): the shell chrome, buttons and the flag bar are hidden, each meal section starts a new page (`break-after: page` on all but the last), the banner and allergy banners repeat per meal. Print uses `window.print()`.

## Dish illustration (UX-5)
`components/recipe/dish-art.tsx`: a deterministic gradient-and-shapes composition from the dish id and cuisine (base colour from the cuisine family, shapes and accents from the id), drawn in CSS with UX-5 tokens only (no emoji, R2-UX-5); decorative next to the dish name. UX-5 also names the main ingredient as an input; list views only have `DishSummaryDto`, which does not carry it, so it is not used (listed deviation).

## Libraries
None added. Everything used is in `apps/web/package.json` already: next 16.3.6, react 19.3.0, radix-ui 1.6.7 (through `components/ui`), zod 4.6.5, @playwright/test 1.63.0, @axe-core/playwright 4.13.0.
