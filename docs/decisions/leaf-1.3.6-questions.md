# leaf-1.3.6 SPEC-Qs

## SPEC-Q-1: the allergy-sesame eval expects an ingredient exclusion; the spec represents a sesame allergy as a dietary-flag exclusion

- **Where:** `evals/agent/changes.yaml`, case `allergy-sesame`, expects `exclusion.add` `{kind: ingredient, key: sesame-seeds, reason: allergy, hard: true}`.
- **Spec:**
  - 13 R2-ONB-3: "Allergies are hard. Allergens expand through the catalogue's `dietary_flags`: sesame → tahini, hummus, za'atar, and any ingredient flagged `contains_sesame`."
  - 07 §7: "the allergy op is `exclusion.add` with `hard`". The kind and key are not named.
- **Code that already follows R2-ONB-3:** `packages/core/src/onboarding/resolve.ts:1-12` maps "sesame" to a `contains_sesame` `dietary_flag` exclusion. The planner treats ingredient keys and flags separately (`packages/core/src/planner/select/members.ts:47`). With `sesame-seeds` alone, five other `contains_sesame` catalogue ingredients stay allowed: halva, hummus, sesame-oil, tahini and zaatar.
- **Live evidence:** `docs/build/live/leaf-1.3.6-diag-allergy-sesame.log`. The model sends the `contains_sesame` flag (plus tahini).
- **Proposed ruling (A):** change the expectation to `{kind: dietary_flag, key: contains_sesame, reason: allergy, hard: true}` and keep the `hard: false` must-not. The prompt states the R2-ONB-3 rule (one flag exclusion per flagged allergen).
- **Alternative (B):** keep the expectation, and the prompt asks for the flag exclusion **and** an ingredient exclusion for the named ingredient's slug. Both ops are hard, so this is safe. But it stores two rows for one allergy, unlike onboarding, which stores one.
- **Ruling: R-66, option A** (2026-09-27, CP1 APPROVED). The expectation is now `{kind: dietary_flag, key: contains_sesame, reason: allergy, hard: true}`, the `hard: false` must-not stays, and the YAML comment cites R-66. No other expectation changed.

## SPEC-Q-2: an infeasible dish does not trigger the REC-5 follow-up (1.3.1 SPEC-Q-6)

- **Where:** `packages/ai/src/recipes/generate.ts`. With 1.3.1 SPEC-Q-6 (R-32), "fewer than `count` dishes survive" counted survivors of steps 1–6, so a dish infeasible for a targeted attendee (step 7) counted as a survivor.
- **Live evidence:** `docs/build/live/leaf-1.3.6-1.3.1-G4.log` (12:31:07Z). Three dishes survived and one was infeasible for both adults, so there was no follow-up and 2 candidates for a 3-dish request.
- **Ruling: R-67, option B** (supersedes 1.3.1 SPEC-Q-6).
  - The follow-up triggers when *candidates* (dishes feasible for every targeted attendee) are fewer than `count`, and asks for `count − candidates`.
  - It quotes each infeasible dish's solver reasons next to the rejection reasons. Infeasible dishes are still saved (REC-5 step 7).
  - The duplicate-detection control test's call count changes from 1 to 2.
  - 1.3.1 G1–G3 and 1.4.1 G2 pass; G1 of this leaf runs them.
