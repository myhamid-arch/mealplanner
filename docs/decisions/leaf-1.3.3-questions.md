# leaf-1.3.3 spec questions

Each question states the conservative reading this leaf builds on unless the architect rules otherwise. SPEC-Q-1 (OWNS) blocks gate tests; none of the others blocks a gate.

## SPEC-Q-1: test directories for `ai` and `db` (request)
The OWNS covers `packages/core/test/learning/rules/**` but no test directory for `packages/ai/src/insights/**` or `packages/db/src/services/proposals/**`. G3 (synthesis with a stubbed model) cannot run from `core` tests, because ARC-3 forbids core importing ai. G2 (fingerprint cooldown, budget, expiry) and SC-3's proposal half need PostgreSQL tests of the service.
- **Request:** add `packages/ai/test/insights/**` and `packages/db/test/proposals/**` to this leaf's OWNS. Precedent: 1.3.2's `packages/db/test/reviews/**` (R-26).

## SPEC-Q-2: proposal row shape
02 §7 gives `proposal.kind` + `payload` "validated by the kind's Zod schema". 07 `propose_change` takes `{ title, rationale, evidence?, ops: ChangeOp[] }`, so one proposal can hold several ops.
- **Reading:** `payload = { title, ops: ChangeOp[] }` (≥ 1 op, each parsed by `ChangeOpSchema`).
- `kind` = the first op's kind.
- `evidence = { reviewIds, count, metrics }`.
- Status stays `pending`, not `proposed`.

## SPEC-Q-3: `revise_recipe` is not a registered op
FBK-7 rule 3 proposes `revise_recipe`, "which triggers a regenerate-variant job". AGT-6 has no such op, and `packages/core/src/changes/**` is 1.1.2's. A proposal whose accept cannot apply a registered op would be a second write path (DM-6).
- **Reading:** the rule is built and tested (G1). Its candidate is reported in the run's digest as a non-actionable **note** and passed to synthesis as context, but it is not stored as a proposal.
- **Question:** should the architect add a `recipe.revise` op (payload: dish, variant, notes), with the regenerate job wired by 1.4.1? If so, this leaf stores the candidate as a proposal once the op exists.

## SPEC-Q-4: rule 4, "target distribution changes or dish swaps"
`plan.swap_dish` needs solved plates, which the pure rules cannot produce. Reading:
- **Trigger:** a targeted member has ≥ 3 distinct days in the last 14 whose plate at one slot is `infeasible` or `flexible_miss`.
- **Proposal:** `distribution.set` for that member and day kind, moving 0.05 of share **away from** the slot when the misses undershoot the kcal target (mean `deviation.kcal < 0`), or **toward** it when they overshoot. The other attended slots are rescaled proportionally, and shares still sum to 1.
- **No proposal:** mixed directions, or a shift that would take a share below 0.05.
- Current shares come from `meal_distribution`, else the 04 §3 defaults, as resolved by 1.2.2.

## SPEC-Q-5: budget queue and scope
"Lower-priority ones wait in the queue", but the schema has no queued status.
- **Queue:** over-budget drafts are not stored. The next run re-derives them from the same evidence, because rules are deterministic.
- **Scope:** the budget counts every pending proposal and applies to every origin, `agent_chat` included, which is the literal reading.
- **Question:** should `agent_chat` proposals (an admin talking to the agent) be exempt?

## SPEC-Q-6: which ops are never proposed
- **Every origin:** R-10's `access.block`, `access.remove`, `access.link_member` and `support.grant`.
- **`rule` and `insights` origins:** also every op the registry flags protected, including the conditional flags evaluated against current state. This is FBK-8: "no proposal may remove or relax an allergy exclusion, or loosen tolerances unless the admin explicitly asked in chat".
- **`agent_chat` origin:** may propose the other protected ops. AGT-5 turns them into proposals.

## SPEC-Q-7: posting the insight message
FBK-7: "results are posted to the admin's current conversation as an insight message".
- Conversations belong to 1.3.5, and the job runner to 1.4.1.
- **Reading:** `runInsights` returns an `InsightDigest`: stored proposals, dropped drafts with reasons, notes, and synthesis status. The data matches the `insight_digest` card (AGT-7).
- Inserting the `event` chat message is the caller's job.

## SPEC-Q-8: `review.processed_at`
1.3.2's SPEC-Q left `processed_at` to this leaf. **Reading:**
- `runInsights` sets `processed_at` on every review it read as unprocessed, in the transaction that stores the proposals.
- `insightsDue(db, ctx)` is true when ≥ 10 reviews are unprocessed.
- Rules look at a window of all reviews (30 days, 14 days for rule 4), not only unprocessed ones. Counts therefore survive across runs, and the fingerprint rules prevent repeats.

## SPEC-Q-9: "new evidence has doubled"
- A rejected proposal's evidence size is `evidence.count`: the number of distinct evidence reviews, or the number of miss days or planned meals for rules 4 and 5.
- A draft with the same fingerprint passes when its count is ≥ 2× that value.
- "In the last 30 days" is measured from the rejection's `decided_at`.

## SPEC-Q-10: fingerprint normalisation
- **Fingerprint:** the lead op kind, plus the op's target identity, not its values. Targets by kind:
  - preference: member, entity type and key;
  - exclusion: member, kind and key;
  - frequency: member, entity type and key;
  - distribution: member and day kind;
  - ingredient.verify: ingredient.
- **Other kinds:** the canonical JSON of the payload's id fields.
- **Multi-op proposals:** the sorted op fingerprints joined with `+`.

## SPEC-Q-11: "negative component review" and the ingredient rule
- **Negative:** rating ≤ 2, or at least one negative FBK-3 taste tag, on a review whose target is a `component`.
- **Ingredients:** each review counts once per core ingredient of the eaten variant, using 1.3.2's `coreIngredients`.
- **Trigger:** ≥ 3 such reviews by one member for one ingredient, in 30 days.
- **Proposal:** `exclusion.add { memberId, kind: ingredient, key: <slug>, reason: dislike, hard: false }`.
- **Question:** is a learned dislike exclusion meant to be `hard: true`? The reading takes `false`, because only allergies are necessarily hard (02 §6).

## SPEC-Q-12: SC-3's proposal half (dish-level rule)
SC-3: two 1★ reviews on a dish by one member "produce a proposal". None of FBK-7's example rules fires on 2 dish reviews: rule 1 needs variants and 3 reviews.
- **Reading:** add a dish-level twin of rule 1. When a member has ≥ 2 ratings in 30 days on a dish (dish, plan_meal or plate targets) with a mean ≤ 2.5, propose `preference.set { memberId, entityType: dish, entityKey: dishId, score: −0.8, locked: true, source: proposal }`.

## SPEC-Q-13: FBK-6 frequency rules
- **more_often / less_often:** count distinct reviews carrying the tag, from any member, on one dish in the last 30 days. At 2, propose household-level `frequency.set` with `minGapDays` 3 or 14.
- **never_again:** propose immediately `preference.set { member, dish, score −1, hard: never, locked: true, source: proposal }`.
- **Observed frequency:** a dish served (plan_meal) more than 2× in a 7-day window, with a mean rating below 3 across reviews in that window, gets household-level `frequency.set { minGapDays: 14 }`.
- **Conflicts:** when more_often and less_often both reach 2, neither is proposed.

## SPEC-Q-14: FBK-5 quantity feedback from targeted members
For targeted members, FBK-5 routes quantity tags to insights. Reading, over the last 14 days:
- ≥ 2 `too_little` or `still_hungry` from one targeted member → `preference.set { member, component_role: vegetable, +0.5, source: proposal }`, which prefers higher-volume plates.
- ≥ 2 `too_much` at one slot → the SPEC-Q-4 distribution shift away from that slot.

## SPEC-Q-15: rule 1, "or a switch to a better-rated sibling variant"
- **Proposal:** always `preference.set` −0.8, locked, on the variant key (`dishId#variantId`, per 1.3.2 ADR-1).
- **Sibling:** when a sibling variant of the same component has this member's mean rating ≥ 3.5, the rationale names it. A locked negative score on the disliked variant already steers the planner to its siblings (PLN-9 appeal).

## SPEC-Q-16: rule 5, verifying an AI-estimated ingredient
- **Trigger:** the ingredient has `nutrition_source = ai_estimate`, no `verified_at`, and is used by the variants of dishes in ≥ 3 `plan_meal`s with status `planned` dated today or later.
- **Proposal:** `ingredient.verify { ingredientId }` with no nutrition changes. Accepting it means the admin confirms the estimate.
