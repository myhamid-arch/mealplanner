# leaf-1.3.1 ADR-2: definitions used by the REC-5 validation pipeline

Status: accepted (CP1, BLD-8 R-32)

REC-5 names seven checks. Several use terms the spec does not define. This ADR fixes each definition; the questions file records the readings as SPEC-Qs.

## Order and outcome
Each dish runs steps 2–7 in order; the first failing step rejects it with one or more reasons (a step reports every violation it finds, not only the first). Step 1 (schema) applies to the whole response (ADR-1). Step 7 does not reject: an infeasible dish is a *survivor* that is saved (`active`) but is not returned as a candidate for this slot (SPEC-Q-6). Every outcome carries `{ dishName, step, code, message }` reasons, which are returned to the caller, written into the audit record's `validation_errors`, and quoted in the follow-up message.

Defect codes: `unknown_ingredient`, `unknown_method`, `unknown_cuisine`, `unknown_slot`, `slot_mismatch`, `bad_serving_bounds`, `bad_component` (default-variant count, unit label), `bad_text` (empty or over-long names, labels, tags and steps, against the `dish.create` op's limits, so a survivor can be saved), `bad_new_ingredient`, `excluded_ingredient`, `excluded_category`, `excluded_dietary_flag`, `unverifiable_new_ingredient`, `variant_drift`, `atwater_variant`, `atwater_new_ingredient`, `nutrition_error`, `duplicate_name`, `duplicate_ingredients`, `infeasible`, `solver_error` (the solver rejects the dish as invalid input; a solver that cannot run is an error, not a rejection).

## Step 2 — references
- Every `slug` resolves to the catalogue or to this response's `newIngredients`; a new-ingredient slug must not shadow a catalogue slug and its `category` must be a catalogue ingredient category.
- `method` ∈ preparation-method keys; `cuisine` and `secondaryCuisine` ∈ cuisine keys; every `slotKeys` entry ∈ the household's slot keys.
- Slot suitability (REC-2 §2, added in the build's expert reread): `slotKeys` includes the requested slot; a packed slot needs `isPackable`; a packed slot without reheating needs `servedColdOk`. Failures are `slot_mismatch`.
- `minServingG ≤ defaultServingG ≤ maxServingG`, all ≥ 0, max > 0.
- Exactly one variant per component has `isDefault` (the `dish.create` op requires it; 02 §4).

## Step 3 — exclusions
The context's exclusions (union over attendees, hard) are checked against every variant's ingredients: ingredient slug, catalogue category, catalogue `dietary_flags`. A new ingredient has a declared category but no verified dietary flags, so a dish that uses one is rejected whenever the context has any dietary-flag exclusion (`unverifiable_new_ingredient`; SPEC-Q-12). The model is never trusted on allergies.

## Step 4 — variant discipline
- *Fat*: an ingredient line with `isAbsorbedFat`, or whose category is `oil_fat`.
- *Coating*: an ingredient that, within the component, appears only in variants whose method is `breaded_baked` or `breaded_fried`.
- *Core weight map* of a variant: raw grams per slug over its lines that are neither fat nor coating.
- *Share* of two variants: Σ over slugs of min(wA/ΣwA, wB/ΣwB), in [0, 1] (the overlap of the two core compositions by weight).
- Each non-default variant must share ≥ 0.70 with the component's default variant. Otherwise the dish is rejected with `variant_drift` naming the component, the variant and the measured share (SPEC-Q-2).

## Step 5 — nutrition
- Each variant is computed with `variantNutritionPer100gCooked` (1.2.1) over a `CatalogContext` holding the catalogue plus the response's new ingredients. Engine errors (`missing_method_yield`, …) reject with `nutrition_error`.
- Variant energy check (NUT-4 with R-22, as R-30 specifies for 1.2.4): the variant passes when its batch kcal is within 12 % of Σ over its ingredient contributions of the predicted energy, with each ingredient's own `atwater_factors` (protein, fat, and carbohydrate on `carbs + fibre`, no fibre term) where recorded and 4/4/9/2 otherwise. Contributions are the quantities the engine sums (fat retention applied to each ingredient's own fat; absorbed fat by the absorbed share). With no factors this equals the generic check. `variantAtwaterCheck(v, ctx, factors: ReadonlyMap<slug, AtwaterFactors>) → { ok, deltaPct, kcal, predictedKcal }` has the signature of 1.2.4 ADR-2, so R-32's switch to the core export is an import change plus deleting the local helper (SPEC-Q-5).
- Each new ingredient must pass the generic `atwaterCheck` on its per-100 g raw values.

## Step 6 — duplication
- *Name similarity*: pg_trgm similarity (lower-case; non-alphanumerics split words; each word padded with two leading and one trailing space; trigram sets; |A∩B| / |A∪B|). Reject at ≥ 0.85.
- *Core ingredients* of a dish: the union, over components, of the default variant's slugs that are neither fat nor `herb_spice`. Jaccard of the two sets; reject at ≥ 0.80.
- Compared with every existing active dish passed in (household and seed library; the caller supplies names and core-ingredient slugs), and with dishes that already survived earlier in the same batch or the first call (SPEC-Q-4).

## Step 7 — solver feasibility
Each dish that passed steps 2–6 becomes a `DishForSolve` (per-100 g cooked from step 5, `stepG` 5, `unitWeightG = defaultServingG` for `unit` components (SPEC-Q-7), `fixed` served at default). `solvePlate` (1.2.2) runs for every targeted attendee's `SlotTarget` with the attendee's exclusions and the household's adjuster dishes (empty when adjusters are off). Status `infeasible` for any attendee marks the dish `infeasible` with the attendee's pseudonymous label and the solver's explanation.

## Follow-up
The reasons quoted to the model pass through the same pseudonymiser as the context (`buildGenerationContext` returns it as `scrub`), because a duplicate reason names an existing household dish, and a household dish name can hold a member's name. The caller and the audit record keep the unscrubbed reasons.

If fewer than `count` dishes survive steps 1–6, one follow-up call appends the model's previous response (its full `content`, thinking blocks included, unchanged) and a user message listing each rejection reason by dish name, and asks for `count − survivors` replacement dishes. The message list is only appended to. The follow-up's survivors are validated with the same pipeline, with the first call's survivors counted for duplication.
