# Leaf 1.4.11: spec questions

Each question records the reading this leaf builds on. Where the spec leaves room, the more
conservative reading is chosen (BLD-7 rule 6).

## SPEC-Q-1: how much space "the button's height plus a margin" is (W-15, G1)

R-77 says to reserve the button's height and a margin below `lg`, on top of the tab bar clearance
`main` already has (`100px + env(safe-area-inset-bottom)`). The spec does not give the margin.

Reading: 16 px, the same inset the button keeps from the right edge (`right-4`). `main`'s bottom
padding below `lg` becomes `100px + 58px + 16px = 174px`, plus `env(safe-area-inset-bottom)`, while
the button shows. At the end of the page the last control's bottom edge then sits 16 px above the
button's top edge. The button itself is not moved or resized (the TabBar mockup places it).

## SPEC-Q-2: the viewport height at 360 px (G1)

G1 names widths only. Reading: 390 × 844 (the height the other leaves' Playwright specs use at
390 px) and 360 × 800. Scrolled to the end, only the distance from the bottom edge matters, so the
height changes nothing as long as each page is taller than the viewport; the spec asserts that it is,
so a page too short to scroll cannot pass the check vacuously.

## SPEC-Q-3: "roles without the assistant keep today's padding" (G1)

`hasAssistant` is true only for `admin`. Reading: for a `member` (on `/account` and on their own
Plate) and for a `kitchen` user (on `/account`), at 390 px, `main`'s computed bottom padding equals
the pre-fix value (`100px` plus the safe-area inset, which is 0 in headless Chromium), and it equals
what the pre-fix class list gives on the same page. At ≥ 1024 px nothing changes for any role (1.4.9's
W-10b rule is untouched; 1.4.9 G4 re-runs in G2).

## SPEC-Q-4: the negative control's "pre-fix padding" (G1)

Reading: the pre-fix class lists of `main` and of the shell's outer `div` are read from git at
`b6a2d7a` (the last commit that changed `app-shell.tsx` before this leaf) and put on the same
elements of the same page, in the same build, before the same intersection check runs. Every pre-fix
class is still in the new build's CSS (the non-assistant roles use it), and the spec first asserts
that the swapped `main` computes the pre-fix `100px`, so the control measures real layout. The
check must then report that the button covers the last control on both pages. This avoids a second
`next build` of a patched working tree, which would either race the other gates' builds or leave the
tree modified if the gate were killed.

## R-78 (answer to the ARCHITECT QUESTION on the /account negative control)

Measured with the pre-fix class lists, scrolled to the end: "See recipe" overlaps the button by
58 × 52 px at both widths, but "Delete my account" already ends about 6 px clear of it, because
1.4.6's account `Frame` has its own `pb-16` below `lg`. Option A: the Plate keeps the ≥ 20 px
intersection control; on `/account` the control is the gap between the control's bottom and the
button's top, under 16 px before the fix and at least 16 px after it, with both gaps printed.
