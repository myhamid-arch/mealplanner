# leaf-1.3.2 spec questions

Each question states the reading this leaf builds on. SPEC-Q-1 and SPEC-Q-2 affect a gate and need a ruling at CP1; the others do not block a gate.

## SPEC-Q-1: G1's "dish appeal ≥ 0.3" cannot be reached through the FBK-4 appeal formula alone (blocks G1)
SC-3 says two 1★ reviews "measurably lower that dish's appeal score for that member". G1 turns this into "lower that member's dish appeal by at least 0.3". FBK-4 gives two readings of "dish appeal":

- **(a) the member's `dish` preference score.** Two 1★ dish reviews give `s = −1`, `w = 1` each, so the score is `−2 / (2 + 2) = −0.5`. The drop is 0.5.
- **(b) the plate appeal `a`** (FBK-4 "Appeal evaluation"). A dish review does not update the variant term (0.20), and the other terms receive reduced weights. For a dish with 2 methods and 4 core ingredients, starting from no preferences:
  - dish `0.35 × −0.5 = −0.175`;
  - cuisine `0.15 × (−0.6 / 2.6) = −0.0346`;
  - methods `0.10 × (−0.6 / 2.6) = −0.0231`;
  - ingredients (w = 0.15/√4 = 0.075 per review): score `−0.15 / 2.15 = −0.0698`, ingredientTerm `−0.1047`, contributing `−0.0157`;
  - total `a = −0.248`, so the drop is **0.248 < 0.3**. With one core ingredient it is 0.262; the maximum over any dish shape is below 0.27.
  - On F1, the household-level cuisine preference is +0.5 for liked cuisines. After the reviews, the member-level learned cuisine row (−0.23) replaces the household value (FBK-4: "member-level value where it exists"), so the drop for a dish in a liked cuisine is **0.323**. That passes only because of the fallback rule (see SPEC-Q-7), not because of the dish reviews themselves.

Reading proposed: G1 asserts (a), the member's dish score drops by ≥ 0.3, and also measures and prints (b) on F1 and on a no-preference household, asserting a strictly positive drop ("measurably lowers") for the reviewing member and exactly zero change for every other member. If the architect wants (b) ≥ 0.3, the FBK-4 appeal weights or propagation weights must change, which is a spec change.

## SPEC-Q-2: database tests are outside OWNS (affects G1–G3)
OWNS gives this leaf `packages/db/src/services/reviews/**` but no test path in `packages/db/test/`, which belongs to 1.1.2. The reviews service writes reviews and learning change sets, so its tests need PostgreSQL. `packages/core/test/**` cannot import `@mealplanner/db` (ARC-3 boundary).
Request: add `packages/db/test/reviews/**` to this leaf's OWNS. The tests would reuse `packages/db/test/support/**` read-only. Fallback if refused: the verify script drives the built service directly against a throwaway database.

## SPEC-Q-3: `learning/config.ts` is outside OWNS
FBK-4 puts the weights in `learning/config.ts`. OWNS has `learning/preferences/**` and `learning/portions/**` only. Reading: the constants live in `learning/preferences/config.ts` and `learning/portions/config.ts`, and each module's `index.ts` exports them.

## SPEC-Q-4: which reviews produce preference updates
The FBK-4 propagation table lists dish, variant, component, ingredient, cuisine and method targets. 02 also allows `plan_meal`, `plate` and `plan_day`, and the quick rating (`QuickRatePhone`) rates "the shawarma bowl" at a meal.
Reading:
- A `plan_meal` or `plate` review propagates as a **dish** review of that meal's dish, with that plate as the eaten context.
- A `plan_day` review produces no preference update. Its quantity tags still apply (SPEC-Q-9).
- Replies (`parent_review_id` set) and reactions never produce learning.
- A review with no `on_behalf_of_member_id` (for example, a kitchen login without a linked member) is stored, but it produces no learning. Learning is member-level only. Household-level preferences are set explicitly (cold start) and are not learned.

## SPEC-Q-5: the review signal
FBK-4: `s = (rating − 3)/2`; tags add `loved_it +1`, `tasty +0.5`, and −0.5 per negative taste tag, capped at −1 total.
Reading:
- The negative taste tags are `bland`, `too_salty`, `too_spicy`, `not_spicy_enough`, `too_sweet`, `too_oily`, `dry`, `soggy`, `overcooked`, `undercooked`.
- `s = clamp(ratingSignal + tagSignal, −1, 1)`. With no rating, `s` is the tag signal alone. With neither a rating nor a taste tag, there is no preference update.
- Custom and non-taste tags carry no appeal signal.

## SPEC-Q-6: "core ingredient"
Not defined for learning. PLN-9 (Economy) defines core ingredients as the variant's ingredients excluding category `herb_spice`, water, salt and pepper. Reading: the same definition, in one helper. In the catalogue (`data/ingredients.v1.json`), `salt` and `black-pepper` are already `herb_spice`, and water is the slug `water`. The helper therefore excludes category `herb_spice` and the slug `water`. `n` in `0.15/√n` is the number of distinct core ingredients across the eaten variants (dish review) or the component's variant (component review).

## SPEC-Q-7: member-level learned rows and household-level values
FBK-4: "member-level value where it exists, otherwise the household-level value". Taken literally, a member's first learned update on a key replaces a household-level value (for example, a liked cuisine at +0.5) with a score built from 0. Reading: literal. The learned row starts from its own evidence (0 prior). The alternative, seeding the member row from the household value, changes the learning math and is an architect decision.

## SPEC-Q-8: precedence among sources for one key
Unique key is (household, member, entity_type, entity_key, source), so one key can have `explicit`, `proposal` and `learned` rows. FBK-4: "Admin-set (`explicit`, `locked`) preferences override learned ones".
Reading: at each level (member, then household), a locked row wins, then `explicit`, then `proposal`, then `learned`. If more than one locked row exists, the same source order applies.
Learning only writes `source = learned` rows. It never writes a locked row: it skips that key and leaves the row unchanged. It does not fail the change set. If a locked row of another source exists for the key, learning still updates the learned row, which does not change the locked row. The learned row keeps its evidence for when the lock is removed.

## SPEC-Q-9: which component roles a quantity tag adjusts (FBK-5)
Reading:
- A **component** review adjusts that component's role.
- A **dish**, **plan_meal** or **plate** review adjusts every role on the member's plate for that meal with cooked grams > 0. Without a plate context, it adjusts every role of the dish's required components.
- A **plan_day** review adjusts every role on the member's plates that day.
- Each role is adjusted at most once per review. `too_much` and `too_little`/`still_hungry` on the same review cancel to no change. `just_right` makes no change.
- The bias is rounded to 3 decimals (the column is `numeric(10,3)`) and clamped to [0.6, 1.6].
- The `ReviewComposePhone` mockup copy says the rice portion adjusts "after two 'too much' ratings". FBK-5 says each signal multiplies by 0.9. This leaf follows FBK-5. The copy belongs to 1.4.5.

## SPEC-Q-10: quantity feedback from targeted members
FBK-5: for a targeted member, quantity feedback becomes an insight (a proposal), such as a calorie-share shift or a `component_role:vegetable` boost. Proposals belong to 1.3.3 (FBK-7). Reading: this leaf writes nothing for a targeted member's quantity tags: no `portion_bias`, no preference and no target change. 1.3.3's rules read those tags from the review rows.

## SPEC-Q-11: "Edits are kept" has no column
FBK-2: reviews are editable by their author for 24 h, and edits are kept. 02 has only `review.edited_at`.
Request: a migration adding `review_revision` (household_id, review_id, rating?, tags, comment?, replaced_at), written in the same transaction as the edit, plus `packages/db/src/schema/<file>.ts` and the migration file in this leaf's OWNS (R-9). Until ruled, the edit service keeps the previous version in that table only if it is granted. Otherwise it overwrites and sets `edited_at`, and the gap stays listed under Deviations.
Learning on edit: the edit retracts the old contribution and applies the new one in one `learning` change set (SPEC-Q-13). Evidence weight never drops below 0.

## SPEC-Q-12: who may review on behalf of whom
FBK-2: on-behalf-of defaults to the author's linked member, and admins may choose any member. R2-ADM-6 adds "members can review for younger siblings" (household setting `members_review_for_siblings`). R-24 Q-12 puts role checks in the API layer.
Reading: the service enforces the domain rule, because it needs the member rows:
- An admin may choose any active member.
- A `member` login may review for itself, or for a younger member (a later `birth_year`) when the household setting is on.
- A `kitchen` login reviews as itself and has no on-behalf-of (so, per SPEC-Q-4, no learning).

## SPEC-Q-13: when learning runs, and who sets `review.processed_at`
FBK-4/FBK-5 updates are automatic. FBK-7 runs the insights job "after every 10 unprocessed reviews", and 02 says `processed_at` is set "by the learning pipeline". If automatic learning set `processed_at`, the insights trigger would never see an unprocessed review.
Reading:
- Automatic learning runs **synchronously when a review is created** (and when it is edited, SPEC-Q-11). It uses one transaction: the review insert and one `learning` change set (actor `system`), applied through `applyChangeSet`. A review can therefore never be learned from twice, and it needs no marker.
- `processed_at` is left to the insights run (1.3.3), which counts unprocessed reviews.
- A service function `relearnReview` is not provided. Undoing the learning change set from the change log is the way to reverse it (R2-ADM-7).
