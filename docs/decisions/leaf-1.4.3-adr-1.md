# leaf-1.4.3 ADR-1: axe-core through `@axe-core/playwright`

Status: accepted (CP1 APPROVED, BLD-8 R-45/R-47); built for CP2
Requirement: BLD-5 1.4.3 G2 (axe-core: no serious or critical violations); UX-6

## Decision
G2 runs axe-core inside the Playwright e2e (`apps/web/e2e/config.spec.ts`, `@G2`) with `@axe-core/playwright` **4.13.0** (it pins `axe-core ~4.13.0`; peer `playwright-core >= 1.0.0`, satisfied by the declared `@playwright/test` 1.63.0). Versions checked with `npm view` in this session. Requested as an `apps/web` devDependency (architect-applied, anti-drift rule 1).

Usage, to be verified against the installed package before use (ARC-1):
- `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()`; a screen fails when any violation has `impact` `serious` or `critical`. The full violation list (rule id, impact, target selectors, help URL) is printed on failure.
- Every screen of this leaf is scanned at 390 × 844 and 1280 × 800, in light and dark, in the states the gate reaches (each onboarding question, the review, the planned state; Family list, a targeted and an untargeted member at each detail level with the keep/reset prompt open; Family tastes; My tastes; Settings; Meals & schedule at each level; Planning balance at each level; Detail levels).
- Negative control: the same builder run on a page with an `<img>` without `alt` and a `<button>` with no accessible name must report serious or critical violations, or the gate fails.

## Alternatives
- `axe-core` alone, injected with `page.addScriptTag({ path: require.resolve("axe-core") })` and `axe.run()`: one dependency fewer, but hand-written glue for iframes and result typing that the wrapper already provides.
- Lighthouse accessibility category: a score, not the axe impact levels the gate names, and a much larger dependency.

## As built
- Installed on the base branch by the architect (R-45): `@axe-core/playwright` 4.13.0 (checked in `apps/web/node_modules/@axe-core/playwright/package.json`). It is used as its default export, `import AxeBuilder from "@axe-core/playwright"`, with `withTags([...]).analyze()` as above.
- The G2 negative control (`<img>` without `alt`, `<button>` without a name) is reported as `image-alt` and `button-name`, both critical.
