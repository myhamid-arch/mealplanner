# leaf-1.4.8 ADR-1: drag to move with pointer events, no library

## Context
UX-4 and WeekPlan ("Drag to another day") ask for drag to move on the Plan week grid; G5 exercises it at 390 px and 1280 px, and UX-6 requires a keyboard path. The grid is a CSS grid at ≥ 1024 px and a day-by-day list below. No drag-and-drop library is in `apps/web` (1.1.1 declared ARC-1's list; new dependencies are architect-applied).

## Options
1. **HTML5 drag and drop** (`draggable`, `dragstart`/`drop`). No touch support on iOS Safari and most Android browsers; the phone list could not drag at all.
2. **A library** (dnd-kit, react-dnd). A new dependency for one interaction; rule 3 (no extra dependencies).
3. **Pointer events** (`pointerdown`/`pointermove`/`pointerup`, `setPointerCapture`), the drop target found with `document.elementFromPoint` and a `data-drop` attribute. Works with mouse, pen and touch in every current browser.

## Decision
Option 3, in `apps/web/components/plan/drag.ts` (a small hook) used by `week-plan.tsx`:
- mouse and pen: a drag starts after the pointer moves 6 px with the button held; a shorter press is a click (opens the meal sheet as today);
- touch: a drag starts after a 400 ms press without movement (so scrolling the day list still works); from then on `touchmove` is prevented;
- while dragging, the cells of the same slot row on other draft days are marked as drop targets (outline plus an sr-only "drop here" text), the source cell is dimmed, and Escape cancels;
- a drop calls `POST /plan-meals/{id}/move` and announces the result in the page's status line (`role="status"`);
- the keyboard path is the meal sheet's "Move to…" menu (SPEC-Q-7), which calls the same endpoint.

`prefers-reduced-motion` turns off the lift animation of the dragged cell.

## Consequences
No new dependency. Playwright drives the drag with `page.mouse` (down, move in steps, up) at both widths; the Move menu is driven by keyboard only.

## As built
Two additions came out of the Playwright runs.
- **Edge auto-scroll.** While a drag is active and the pointer is within 96 px of the window's top or bottom edge, the page scrolls 12 px per frame. Once a touch drag has started it prevents page scrolling, and the phone tab bar covers the bottom of the screen, so without this a target below the fold could not be reached.
- **Escape.** After Escape cancels a drag, the click produced by the coming release is swallowed.
- **Drag source style.** The dragged cell is not dimmed. Dimming failed axe colour contrast. It gets a dashed outline on the flour fill and keeps full-contrast text.
