# leaf-1.2.1 ADR-3: verification design and coverage measurement

Status: accepted (CP1 APPROVED, BLD-8 R-12 to R-14; built for CP2)
Requirement: NUT-1; ledger gates G1–G4

## Tests
Vitest unit tests under `packages/core/test/nutrition/` (`*.test.ts`, no I/O), run by the existing `test:unit` script and CI. Fixtures are this leaf's own small catalogue (`test/nutrition/fixtures/catalog.ts`), not `data/` (1.1.3 is in parallel). Fixture nutrient values are round, USDA-like numbers chosen for hand arithmetic; they make no claim to be catalogue data.

## Golden values
`test/nutrition/fixtures/golden.ts` holds each case's inputs, the tags it exercises, and literal expected values (per 100 g cooked for all nine nutrients, plus batch cooked grams). Above each case, a comment shows the arithmetic step by step from the fixture numbers. The values were worked out from the formulas in 03 §3, not taken from the engine.

## Coverage output
Coverage reports are written to a temporary directory, never to `packages/core/coverage/`, which is not git-ignored.

## Verify script (`scripts/verify/leaf-1.2.1.mjs`)
It builds `@mealplanner/core` (`tsc`), imports the compiled engine and fixtures from `packages/core/dist/`, and asserts directly in Node, independently of Vitest. It uses `scripts/verify/lib/{report,run,workspace}.mjs` and does not modify them.
- **G1:** the 03 §7 exports and their compiled `.d.ts` signatures; ≥ 15 cases; the situations the gate names are recognised from the case **inputs**, not from the tags: a grilled/deep-fried pair on the same solids, a `breaded_*` method, boiled with a grain, stewed with a retained liquid, listed frying fat below the computed absorption capacity, plus an R-13 known-bound zero and a genuinely unknown null; the arithmetic comment is present for every case; every field of every case is within 0.5 % (relative; an expected 0 must be within 1e-9). Negative controls: the same comparator must fail (a) when one expected value is shifted by 0.6 %, and (b) under each known-bad catalogue or input mutant: fat retention forced to 1, oil absorption forced to 0, the cap case given unlimited oil, absorbed water marked retained, and yield overrides removed. Each mutant must break at least one golden.
- **G2:** for every golden variant, (a) raw grams for plates that partition `W` (20/30/50 %) sum to `rᵢ`; (b) a variant rebuilt from `rawForCooked(v, x)` yields `batchCookedG = x` and the same per-100 g values; (c) `plateNutrients` of the plate equals `N · x / W`. All within 0.1 %. Negative control: a known-bad raw-from-cooked (`rᵢ · x / Σr`, which ignores the yield) must fail the same comparator.
- **G3:** fixture raw-ingredient sets (chicken, fish, potato), each identical except for the method, `grilled` vs `deep_fried`: fried fat per 100 g cooked is strictly greater. Negative control: grilled vs grilled on independently built equal inputs gives deep-equal output, and the direction assertion rejects that pair.
- **G4:** runs the nutrition tests with V8 coverage limited to `src/nutrition/**`, and reads the JSON summary. Every file, and the total, must be at 100 % lines. The covered file set must equal the `.ts` files in `src/nutrition/`, so a file that is never loaded cannot escape. The Vitest JSON report must show 0 failed, 0 skipped and 0 todo tests. Negative control: in a disposable workspace copy (`copyWorkspace` + `installCopy`), an uncovered function is added to a nutrition file, and the same measurement must report < 100 %.

## Coverage provider
Vitest's coverage needs a provider package that is not declared. Request: `@vitest/coverage-v8@5.0.2` as a root devDependency; it must match `vitest@5.0.2` exactly (peer dependency, `npm view`). Added on the base branch (R-14) and merged into this branch.
