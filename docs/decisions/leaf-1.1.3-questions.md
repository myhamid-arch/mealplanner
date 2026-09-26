# leaf-1.1.3 spec questions

Conservative readings below are what I build unless CP1 says otherwise. None blocks a gate outright. SPEC-Q-1 and SPEC-Q-9 affect how G3 and CI can pass.

## SPEC-Q-1: G3 "every (method, category) used by the seed library" before the seed library exists
1.2.4 (seed dishes) runs after this leaf, so the used pairs cannot be measured now.
- Proposal: seed every one of the 23 × 22 pairs, except a reasoned `coverage.excluded` list.
- The G3 script additionally derives the used pairs from `data/seed-dishes/**` whenever that exists, so the gate re-checks itself after 1.2.4.
- Alternative: the architect names the pair set now, and 1.2.4 is bound to it.

## SPEC-Q-2: `nutrition_source` values for non-FDC sources
DM §3 lists `usda_fdc:<id>`, `manual` and `ai_estimate`. NUT-7 allows "a documented alternative source".
- I use `cofid:<code>`, `afcd:<key>` and `off:<barcode>`, following the `usda_fdc:<id>` shape.
- The conservative alternative is `manual` plus provenance in `meta`, but that loses machine-checkable citations. Confirm the prefixes.

## SPEC-Q-3: who loads `data/*` into the tables
No OWNS row contains a catalogue seed/loader (1.1.2 owns schema, repos, migrations and fixtures).
- My files use DM column names, and keep non-column data under `meta` (ADR-2).
- Please assign the loader (1.1.2 migration seed, or 1.4.1).

## SPEC-Q-4: FDC is unreachable, so the snapshot comes from mirrors
The official SR Legacy CSV is mirrored on GitHub, with fidelity checks recorded in ADR-1. Foundation/Branded rows come via a third-party build whose SR rows match the official CSV exactly.
- `nutrition_source` still cites the real FDC id.
- Confirm this satisfies "produce the snapshot from a documented source".

## SPEC-Q-5: NUT-4 on zero-energy ingredients
Water, salt and zero-energy sweeteners make the relative check divide by zero.
- Reading: if `kcal = 0` and `4P + 4C + 9F + 2·fibre ≤ 0.5`, the entry passes; any other `kcal = 0` entry fails.

## SPEC-Q-6: soluble fibre for foods whose total fibre is 0
Meat, fish, eggs, oils and most dairy have total dietary fibre 0 in their source record.
- I store soluble fibre 0 for them, with method `zero_total_fibre` and the citation of that record. It is a value derived from a cited measurement, not an unknown.
- Conservative alternative: `null` (the UI then shows "unknown" for chicken). Confirm.

## SPEC-Q-7: allergen and diet edge cases
- Peanut → `contains_nuts` (the vocabulary has no `contains_peanuts`).
- Oats → `contains_gluten`.
- Cheese → `vegetarian` (rennet type unknown).
- Sulphites have no flag.
- These are the safety-first readings, except cheese. Confirm, or extend the vocabulary through a spec change.

## SPEC-Q-8: `locale_availability.AE` has no measurable source
It is recorded as a builder assessment (`meta.availability_basis`), not as data.

## SPEC-Q-9: `scripts/import-fdc.ts` and lint
ESLint's typed `projectService` covers every `.ts` file, but no tsconfig includes `scripts/`. CI lint is therefore expected to reject the importer.
- Request: add `scripts/tsconfig.json` (or `allowDefaultProject: ["scripts/*.ts"]`); both are outside my OWNS.
- Until then, CI on this branch may be red on lint for that file only.

## SPEC-Q-10: NUT-4 marks failing ingredients `needs_review` and excludes them from planning, while G2 accepts `confidence: low` with a reason
Reading: G2 is the gate. An entry that fails NUT-4 for a documented source reason stays in the catalogue as `low`; examples are specific Atwater factors in the source, sugar alcohols and organic acids. Whether it is also marked `needs_review` at load is left to the loader/engine (1.2.1, SPEC-Q-3).
- I keep such entries to a minimum by preferring a record that passes.

## SPEC-Q-11: method-yield rows with no measurement
Rows use `definition` (no heat: Y = R = 1, A = 0) or `analogy:<row>` with confidence `low` (ADR-3). Confirm this meets NUT-5's "documented with its source and confidence".

## SPEC-Q-12: cuisine `flag_emoji` and `parent_key`
Both are `null`: R2-UX-5 bans emoji UI, and no spec rule defines a cuisine hierarchy.
