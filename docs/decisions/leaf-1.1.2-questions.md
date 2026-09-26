# leaf-1.1.2 spec questions

Each question states the reading this leaf follows unless the architect rules otherwise at CP1. None blocks a gate.

## SPEC-Q-1: registry `apply(tx, …)` vs "core does no I/O" (AGT-6 vs ARC-3)

Reading: `ChangeTx` is an interface declared in core and implemented in `packages/db`; core ops call only that interface (ADR-3). Inverses are before-image restores (`rows.restore`, internal kind), not hand-written per op.

## SPEC-Q-2: `household_id` on member-scoped tables

02 gives only `member_id` for `target_profile`, `tolerance`, `member_slot_schedule`, `training_schedule`, `day_override`, `meal_distribution`, `slot_target_override`, and only parent ids for `plan_meal`, `plate`, `plate_item`, `cook_batch`, `chat_message`, `review_reaction`. The 02 preamble says every household-scoped table has `household_id` with an index. Reading: add `household_id` to all of them, with composite FKs `(household_id, member_id)` etc. (ADR-1). Recipe children (`component`, `variant`, `variant_ingredient`, `dish_nutrition_cache`) get a nullable `household_id` mirroring their dish.

## SPEC-Q-3: primary keys 02 leaves unstated

Reading: natural composite PKs for `member_slot_schedule`, `training_schedule`, `meal_distribution`, `slot_target_override`, `review_reaction`, `method_yield`; `id uuid` elsewhere (ADR-1). `day_override` gets `id` plus unique `(member_id, date, kind, slot_type_id)`.

## SPEC-Q-4: columns later leaves need that 02/13 do not list

Only 1.1.2 owns migrations, so a missing column blocks a later leaf. Proposed additions (built only if the architect approves them at CP1; otherwise left out and each later leaf requests them):

- a. `variant.reference_batch_cooked_g` (02 §4 names it "stored on variant", default 1000) — **built** (it is in 02's prose).
- b. `variant.needs_review`, `ingredient.needs_review` (bool) — NUT-4/PLN-9 §6.3 exclude items "marked needs_review".
- c. `variant_ingredient.yield_override?`, `variant_ingredient.retained` (bool) — NUT-3 per-ingredient yield overrides and retained water.
- d. `household_adjuster (household_id, dish_id, enabled)` and `planning_weights.adjusters_enabled`, `planning_weights.max_variants_per_component` (default 3) — PLN-6 "the household can disable adjusters or edit the list", PLN-9 §6.4, UX-2 Planning expert row; needed by `adjusters.set` (AGT-6).
- e. `portion_bias (household_id, member_id, component_role, bias)` — FBK-5 `learned_role_bias`, bounded [0.6, 1.6]; `preference.score` is [−1, 1] and cannot hold it.
- f. `detail_level (household_id, member_id?, section, level)` — R2-DL-1 "persisted per (member, section)".
- g. `invite.revoked_at`, `invite.created_by_user_id` — R2-ADM-2 revoke/resend.
- h. `household.require_totp_for_admins`, `household.kitchen_sees_names`, `household.members_review_for_siblings`, `household.insight_frequency`, `household.default_precision`, `household.sat_fat_default_pct` — R2-ADM-5/6 settings.
- i. `household.deletion_requested_at`, `household.deletion_requested_by_user_id`, `household.suspended_at`, `user.platform_blocked_at` — R2-ADM-6 14-day grace, R2-ADM-8 suspend and platform-wide block.
- j. `user_notification_pref (user_id, key, enabled)` — R2-ADM-5.
- k. `household_user.last_active_at` — R2-ADM-3 "last active".
- l. `ingredient.verified_at?`, `ingredient.verified_by_user_id?` — needed by `ingredient.verify` (AGT-6, NUT-7 "verify" badge).
  Default if not ruled on: build a, b, c, d, l (each is needed by an AGT-6 op or a planner rule this leaf's registry implements); leave e–k to their leaves' requests.

## SPEC-Q-5: ops beyond the AGT-6 v1 list

DM-6 requires every mutation of configuration and plans to go through the change-set service, and R2-ADM-4 says block and remove "are logged as change sets". AGT-6 has no op for them. Reading: add `access.block`, `access.unblock`, `access.remove` (optionally archives the member), `access.link_member` (R2-ADM-3), `meal_override.set`, `meal_override.remove` (R2-MEAL-2), `support.grant`, `support.revoke` (R2-ADM-8). Protected: `access.block`, `access.remove`, `access.link_member` (they change who can act, like `role.set`); `support.grant` (it opens household data to an operator).
Not added, flagged: plan generation (1.2.3/1.4.1) writes `plan_day`/`plan_meal`/`plate`; DM-6 routes plan mutations through change sets but AGT-6 has no "save generated plan" op. Proposal: 1.4.1 requests a `plan.save_days` op from the architect, or the architect adds it to this leaf now.

## SPEC-Q-6: `user.password_hash` vs Better Auth

Better Auth 1.7.6 stores the hash in `account.password`. Reading: keep `user.password_hash` (nullable, unused by the library) so the schema matches 02 and G1; 1.4.1 decides whether to mirror into it. The architect may rule to drop it.

## SPEC-Q-7: protected-op conditions

AGT-5 marks `exclusion.remove`, `tolerance.set`, `dish.retire` conditionally protected. Reading:

- `exclusion.remove` is protected when the exclusion's reason is `allergy` (or `hard` with reason `medical`/`religious`); `exclusion.add` that replaces an allergy row with a non-hard one is rejected by schema (DM-5: allergy is always hard).
- `tolerance.set` is protected when any of P/C/F/kcal gets wider or mode goes strict → flexible.
- `dish.retire` is protected when any review targets the dish, its components or variants.
- `member.archive`, `role.set` always protected.

## SPEC-Q-8: fixture catalogue

F1–F3 need cuisines, preparation methods, a few ingredients and household dishes (for `dish.*`, `plan.*`, `plate.override` and F3's reviews). The real catalogue is leaf 1.1.3's `data/` and is not merged. Reading: `packages/core/test/fixtures/catalog.ts` holds a small, clearly test-only catalogue (≈20 ingredients with FDC-style values, the methods used, the cuisine keys F1–F3 reference). Fixtures reference catalogue rows by slug/key, so later leaves can load the same fixtures on top of the real catalogue.

## SPEC-Q-9: `platform_operator` as a table

13 §4.8 calls it "a separate role outside households". Reading: table `platform_operator (user_id PK)`, not a `household_user.role` value (ADR-4).

## Raised during the build (CP2)

## SPEC-Q-10: weekday numbering

02 §2 says `weekday (0–6)` without a base. Reading: `0 = Monday … 6 = Sunday` everywhere (`WEEKDAYS`, `weekdayOf()` in `@mealplanner/core/types`; F1's "Mon/Wed/Fri" is `[0, 2, 4]`). Planner and UI leaves use `weekdayOf()`.

## SPEC-Q-11: writes later leaves need that have no op

DM-6 routes these through change sets, but neither AGT-6 nor R-10 names an op, so none is built:

- `portion_bias` (FBK-5: "logged as a `learning` change set") → leaf 1.3.2 needs e.g. `portion_bias.set`;
- `detail_level` (R2-DL-1, "persisted per (member, section)") → leaf 1.4.3 needs e.g. `detail_level.set` (or a ruling that detail levels are UI state outside DM-6);
- invite acceptance creating a `household_user` row → treated as the auth flow (DM-6 exception, like sign-up in `createHousehold`); leaf 1.4.1 may rule otherwise.
  Reading: later leaves request these ops; the registry is in this leaf's OWNS (`packages/core/src/changes/**`), so the architect would assign the addition.

## SPEC-Q-12: role checks

ARC-6's authorisation matrix (e.g. members may edit only their own taste preferences) is enforced by the API layer (leaf 1.4.1). The change-set service enforces household scope (DM-1), AGT-5 for `agent_apply`, and that user and agent change sets carry the acting login; it does not re-check `ctx.role`.

## SPEC-Q-13: `plan.save_days` and reviewed meals

R-10 says save_days replaces the unlocked meals of the given dates. A meal that already has reviews (`review.plan_meal_id`) cannot be deleted without losing the review's context. Reading: save_days refuses with an error naming the meal; the caller locks it (then it is kept) or leaves the date out.

## SPEC-Q-14: default slot times and icons

PLN-2 gives no default times; `DEFAULT_SLOTS` uses breakfast 07:00, packed school lunch 12:00, lunch/packed work lunch 13:00, snack 16:00, pre-workout 17:00, post-workout 18:30, dinner 19:30 (editable, used only for ordering). `slot_type.emoji` is required by 02 §2; defaults are emoji characters, although R2-UX-5 draws icons as SVG — the UI decides how to render them.
