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
- **Conservative reading until the ruling:** the expectation is unchanged. The prompt states the flag rule, which both A and B need.
