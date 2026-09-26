# leaf-1.3.1 spec questions

Each question states the conservative reading this leaf builds on. None blocks a runnable gate.

## SPEC-Q-1: `messages.parse` on the beta namespace
REC-2 names `client.messages.parse()` + `zodOutputFormat` and also `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`. In `@anthropic-ai/sdk` 0.128.0 `fallbacks` exists only on the beta params, so both cannot hold on the non-beta method. Reading taken: `client.beta.messages.parse()` + `betaZodOutputFormat` (the beta twins of the named calls), with the format's `parse` wrapped to return `null` on unparseable text so `stop_reason` is checked before content (ADR-1).

## SPEC-Q-2: variant drift rejects the dish
REC-5 step 4 allows "split out as its own component **or** the dish is rejected". Splitting would invent a component the model did not write (serving bounds, role, required flag). Reading taken: reject with a `variant_drift` reason (share, component, variant); the follow-up call lets the model fix it.

## SPEC-Q-3: "non-fat, non-coating" and "share … by weight"
Not defined in 05. Reading taken (ADR-2 step 4): fat = `isAbsorbedFat` or category `oil_fat`; coating = an ingredient present in the component only in `breaded_*` variants; share = weight-normalised overlap Σ min(fA, fB) of the core compositions; each non-default variant is compared with the default variant.

## SPEC-Q-4: duplication definitions
"Trigram-similar" is read as pg_trgm similarity; "core ingredient" as the default variants' slugs minus fats and `herb_spice`. The generator also rejects a dish that duplicates an earlier survivor of the same generation (two near-identical new dishes would be the same duplicate the rule prevents). Existing dishes are supplied by the caller (`db`/KG), since `ai` does not import `db` (R-2).

## SPEC-Q-5: R-22 variant energy check before 1.2.4 merges
R-30 assigns the factor-aware variant check to 1.2.4 in `packages/core/src/nutrition/atwater.ts`, which is not merged and is outside this leaf's OWNS. Reading taken: this leaf implements the R-30 definition in `packages/ai/src/recipes/validate/nutrition.ts` and tests it. **Request:** when 1.2.4 merges, the architect may switch the call to the core export (one import) or keep this one; both follow R-30.

## SPEC-Q-6: infeasible dishes and the follow-up
REC-5 step 7 keeps an infeasible dish in the library (`active`) but does not return it as a candidate. Reading taken: an infeasible dish is a survivor (saved), reported with its reason, and excluded from `candidates`. "Fewer than `count` dishes survive" counts survivors of steps 1–6, so an infeasible dish does not trigger the follow-up by itself.

## SPEC-Q-7: unit weight for `unit` components
DM `component` has `unit_label` and the solver needs `unitWeightG` for `unit` portioning, but REC-4's schema carries no unit weight. Reading taken: for the feasibility solve only, one unit = `defaultServingG`. Stored rows keep `stepG` 5 and the model's `unitLabel`.

## SPEC-Q-8: `ai_generation` rows and saving through ports
DM-7 (one `ai_generation` row per call) and REC-5 ("survivors are saved via a change set, source ai") are database writes; R-2 forbids `ai` importing `db`. Reading taken: the generator takes two injected ports, `recordGeneration(record) → id` and `saveSurvivors(dishes, generationIds)`, and calls them for every call and every run with survivors; `db`/`apps` implement them (slug → id mapping, `dish.create` ops) in 1.4.1. The record holds the pseudonymised request summary (no system/catalogue text, no credentials), the raw response, token counts including cache reads, the stop reason and the validation errors.

## SPEC-Q-9: pseudonymous labels, likes and dislikes
Labels are "Adult A", "Adult B", … and "Child A", … (adult when the member's age on the plan date is ≥ 18 or the birth year is unknown), letters in configuration order; neither names nor ages nor birth years are sent. `likes`/`dislikes` come from the member's own `preference` rows of type ingredient, cuisine or method with `score ≥ 0.5` / `≤ −0.5`, rendered as `<type>:<key>`; dish preferences are keyed by ids that mean nothing to the model and are left out.

## SPEC-Q-10: when generation is "disabled"
Enabled when the process environment carries a credential the SDK resolves from env (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_PROFILE`, or the full Workload Identity Federation set); otherwise disabled with a reason. A credential that the API rejects surfaces as a typed `authentication` error, not as "disabled".

## SPEC-Q-11: generated components' step
REC-4 has no `stepG`; `component.step_g` defaults to 5 (02 §4). Generated components use 5.

## SPEC-Q-12: new ingredients and dietary-flag exclusions
A model-proposed ingredient has no verified `dietary_flags`, so a dietary-flag exclusion (an allergy) cannot be checked against it. Reading taken: when the context has any dietary-flag exclusion, a dish that uses a new ingredient is rejected (`unverifiable_new_ingredient`); the system prompt tells the model so.

## SPEC-Q-13: the generation context's slot and attendees
`buildGenerationContext` derives attendees from the 1.2.2 resolver (`attendedSlots`, `resolveSlotTargets`) for one date and slot, and `plateTarget` from the attendee's `SlotTarget` (carbs on the target's basis, stated in the prompt). Palette, recent cuisines, similar dishes and the admin request are inputs from the caller (planner 1.2.3 / agent 1.3.5).
