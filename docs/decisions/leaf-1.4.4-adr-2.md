# leaf-1.4.4 ADR-2: data access, interaction and print, with no new dependencies

Status: proposed (CP1)
Requirement: ARC-5 (one contract), UX-4, UX-5, UX-6, PLN-14

## Data access
Screens are client components that call the API through `createApiClient({ baseUrl: "" })` and the endpoint objects of `@mealplanner/api-contract/contract` (same origin, session cookie), as 1.4.3 does. Response types are `z.output<typeof c.<Dto>>`; nothing re-declares a DTO. Server components only decide the frame: `getShellViewer()` (1.4.1) gives the role for redirects (`/` → `homePathFor(role)`, kitchen on `/today` → `/kitchen`) and for the signed-out empty state. Writes: plan actions through their endpoints (`plans.generate`, `planMeals.swap|lock|unlock`, `cookSheets.flag`), meal overrides and recipe edits through `POST /change-sets` (`meal_override.set|remove`, `dish.update`, `dish.retire`). Job progress: `GET /jobs/{id}/events` (SSE, `EventSource`) until `done` / `failed`.

## Interaction
- Swap, meal detail and override are `Sheet` / `Dialog` from `components/ui` (Radix, 1.4.2), so focus trapping and Escape come from there.
- Drag to move (if kept, SPEC-Q-3): the native HTML Drag and Drop API on the grid cells, with the "Move to…" menu as the keyboard and touch path. No drag library.
- Variant tabs on the recipe page: WAI-ARIA tabs (roving tabindex, arrow keys).
- Kitchen step check-offs and "Large text": local state, remembered per date and meal in `localStorage` (wrapped in try/catch; the page works without it).
- Motion: `motion` 13.4.4 (already declared) for card rise and ring animation, disabled under `prefers-reduced-motion`.

## Print (PLN-14)
The cook sheet has a print stylesheet in its own component (Tailwind `print:` variants plus one `@page { size: A4; margin: 12mm }` rule): the shell chrome, buttons and the flag bar are hidden, each meal section starts a new page (`break-after: page` on all but the last), the banner and allergy banners repeat per meal. Print uses `window.print()`.

## Dish illustration (UX-5)
`components/recipe/dish-art.tsx`: a deterministic gradient-and-shapes composition from the dish id, cuisine and main ingredient category, drawn in CSS with UX-5 tokens only (no emoji, R2-UX-5), `role="img"` with the dish name.

## Libraries
None added. Everything used is in `apps/web/package.json` already: next 16.3.6, react 19.3.0, radix-ui 1.6.7, motion 13.4.4, zod 4.6.5, @playwright/test 1.63.0, @axe-core/playwright 4.13.0.
