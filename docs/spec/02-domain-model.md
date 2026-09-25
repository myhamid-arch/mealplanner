# 02 — Domain model

PostgreSQL 16 via Drizzle ORM. IDs are UUIDv7 (`uuid` column, generated in app). Every household-scoped table has `household_id` with an index, and every query goes through a repository layer that requires a household context (DM-1). Timestamps are `timestamptz`. Nutrient quantities are stored as `numeric(10,3)` and mapped to `number` in TypeScript. Enumerations are Postgres enums unless noted as extensible text.

Notation: `?` = nullable. `→` = foreign key.

## 1. Tenancy and identity

**user** — id, email (unique, citext), name, password_hash?, created_at.

**session** — managed by the auth library (see [10-architecture.md](10-architecture.md) §5).

**household** — id, name, locale (default `en-AE`), timezone (default `Asia/Dubai`), unit_system (`metric` only in v1), country_code (default `AE`), region_note? (free text, e.g. "Khalifa City, Abu Dhabi"; given to recipe generation for ingredient availability), members_see_plates (bool, default true), agent_may_apply (bool, default true; AGT-5), created_at.

**household_user** — household_id →, user_id →, role (`admin` | `member` | `kitchen`), member_id →? (links a login to an eater). Unique (household_id, user_id).

**invite** — id, household_id →, code (unique, 10 chars), role, member_id →?, expires_at, used_at?.

## 2. Members, targets, schedules

**member** — id, household_id →, display_name, emoji_avatar?, color (token name), birth_year?, sex? (`female` | `male` | `unspecified`), is_targeted (bool), appetite (`small` | `medium` | `large`, default `medium`; used for untargeted portions), notes?, archived_at?.

**target_profile** — id, member_id →, kind (`default` | `training`), kcal, protein_g, carbs_g, fat_g, sat_fat_max_g?, soluble_fibre_min_g?, fibre_min_g?, sodium_max_mg?. Unique (member_id, kind). A training profile is optional; without one, training days use `default` (DM-2).

**tolerance** — member_id → (PK), protein_g (default 5), carbs_g (default 5 — see OQ-1), fat_g (default 2), kcal (default 50 — see OQ-2), mode (`strict` | `flexible`, default `strict`). Applies per meal.

**slot_type** — id, household_id →, key (text, e.g. `breakfast`, `packed_school_lunch`, `pre_workout`, `custom_ab12`), label, emoji, sort_order, default_time (`time`), is_shared (bool: one dish for everyone attending; false = cooked per member), is_packed (bool), reheat_available (bool), is_training_slot (bool), constraints_note? (free text passed to recipe generation, e.g. "school is nut-free"), active (bool). Seeded per household from the defaults in [04-planner.md](04-planner.md) §2.

**member_slot_schedule** — member_id →, slot_type_id →, weekday (0–6), attends (bool). This is the detailed layer. The coarse layer is "attends every day" (row absent = attends, if the slot is active and not a training slot).

**training_schedule** — member_id →, weekday (0–6), session_time (`time`)?, intensity? (`light` | `moderate` | `hard`). Its presence makes that weekday a training day for the member: training slots attend, and the training target profile applies if one exists.

**day_override** — member_id →, date, kind (`training` | `rest` | `absent_slot` | `extra_slot`), slot_type_id →?. One-off exceptions ("no training this Wednesday", "away for lunch").

**meal_distribution** — member_id →, day_kind (`default` | `training`), slot_type_id →, share (numeric 0–1). Detailed layer. When absent, the defaults in [04-planner.md](04-planner.md) §3 apply. **slot_target_override** — member_id →, day_kind, slot_type_id →, kcal?, protein_g?, carbs_g?, fat_g? — expert layer: explicit per-slot targets.

## 3. Catalog (global, not household-scoped)

**ingredient** — id, slug (unique), name, aliases (text[]), category (enum: `poultry`, `red_meat`, `fish`, `seafood`, `egg`, `dairy`, `plant_protein`, `grain`, `starch`, `legume`, `vegetable`, `leafy_green`, `fruit`, `nut_seed`, `oil_fat`, `sauce_condiment`, `herb_spice`, `sweetener`, `bakery`, `beverage`, `supplement`, `other`), per 100 g edible raw: kcal, protein_g, carbs_g, fat_g, sat_fat_g, fibre_g, soluble_fibre_g?, sugar_g?, sodium_mg?; density_g_per_ml? (for ml/L display), unit_weight_g? (e.g. one egg = 50 g), unit_label? ("egg", "slice", "piece"), edible_portion (0–1; share of purchased weight that is edible), dietary_flags (text[]: `contains_nuts`, `contains_gluten`, `contains_dairy`, `contains_egg`, `contains_fish`, `contains_shellfish`, `contains_soy`, `contains_sesame`, `contains_pork`, `contains_alcohol`, `vegan`, `vegetarian`), nutrition_source (text: `usda_fdc:<id>`, `manual`, `ai_estimate`), nutrition_confidence (`high` | `medium` | `low`), locale_availability (jsonb: `{ "AE": "common" | "available" | "rare" }`), created_by_household_id →? (non-null = household-private ingredient added by that household or by the AI for it).

**preparation_method** — id, key (unique: `raw`, `boiled`, `steamed`, `poached`, `grilled`, `broiled`, `roasted`, `baked`, `air_fried`, `pan_seared`, `sauteed`, `stir_fried`, `shallow_fried`, `deep_fried`, `breaded_baked`, `breaded_fried`, `braised`, `stewed`, `slow_cooked`, `pressure_cooked`, `smoked`, `blended`, `marinated_raw`), label, description, appeal_tags (text[] e.g. `crispy`, `smoky`, `tender`). Yield and absorption parameters live in **method_yield** — method_id →, ingredient_category, yield_factor (cooked ÷ raw weight), fat_retention (share of the ingredient's own fat retained, 0–1), oil_absorption_g_per_100g_raw (default oil absorbed), coating_ingredient_id →? with coating_g_per_100g_raw?. See [03-nutrition-engine.md](03-nutrition-engine.md).

**cuisine** — id, key (unique: `american`, `british`, `italian`, `levantine`, `emirati_gulf`, `persian`, `turkish`, `indian`, `pakistani`, `mexican`, `tex_mex`, `mediterranean`, `greek`, `spanish`, `french`, `japanese`, `chinese`, `thai`, `korean`, `vietnamese`, `north_african`, `east_african`, `fusion`, extensible), label, flag_emoji?, parent_key?.

## 4. Recipes

**dish** — id, household_id →? (null = global seed library), name, slug, description, cuisine_id →, secondary_cuisine_id →?, slot_keys (text[]: slot keys it suits), flavour_tags (text[]), is_packable (bool), served_cold_ok (bool), source (`seed` | `ai` | `admin`), status (`draft` | `active` | `retired`), ai_generation_id →?, version (int), created_at, updated_at.

**component** — id, dish_id →, name, role (`protein` | `carb` | `vegetable` | `sauce` | `fat` | `garnish` | `side` | `drink` | `adjuster`), portioning (`continuous` | `unit` | `fixed`), unit_label? (for `unit`), min_serving_g, max_serving_g (cooked grams per plate; limits the solver), default_serving_g (for untargeted medium appetite), step_g (default 5; the rounding grid), sort_order, required (bool; if false the solver may set 0 g).

**variant** — id, component_id →, method_id →, label (e.g. "Grilled"), is_default (bool), steps (jsonb: ordered strings), cook_time_min?, notes?. At least one per component.

**variant_ingredient** — variant_id →, ingredient_id →, raw_g_per_batch (numeric), role_note? (e.g. "marinade"), is_absorbed_oil (bool: the oil counts through absorption rather than being fully consumed). The batch is the variant's reference recipe, with ingredient ratios expressed as raw grams for a reference batch of `reference_batch_cooked_g` (stored on **variant**, default 1000 g cooked).

DM-3 **Variant ingredient sets.** Variants of one component SHOULD share their core ingredients and differ in method, coating and cooking fat. This is how "same ingredients, different preparation" is represented. The planner's ingredient-economy score counts ingredients, not dishes or variants.

**dish_nutrition_cache** — variant_id → (PK), per 100 g cooked: kcal, protein, carbs, fat, sat_fat, fibre, soluble_fibre, sugar, sodium; cooked_yield_g_per_batch; computed_at; engine_version. Recomputed whenever the variant, its ingredients, the method yields or the engine version change (DM-4).

## 5. Plans

**plan_day** — id, household_id →, date, status (`draft` | `published` | `cooked`), weights_snapshot (jsonb), generated_at, generator_version. Unique (household_id, date).

**plan_meal** — id, plan_day_id →, slot_type_id →, dish_id →, dish_version, member_scope (`shared` | uuid of the member for a per-member slot), locked (bool: regeneration keeps it), score_breakdown (jsonb: macro, appeal, economy, repetition, total, and why), status (`planned` | `cooked` | `skipped`).

**plate** — id, plan_meal_id →, member_id →, fit_status (`in_tolerance` | `flexible_miss` | `infeasible` | `untargeted`), target (jsonb: the slot target used), actual (jsonb: computed nutrients), deviation (jsonb). **plate_item** — plate_id →, component_id →, variant_id →, cooked_g, raw_equivalent (jsonb: ingredient_id → raw g).

**cook_batch** (derived, materialised on publish) — plan_meal_id →, variant_id →, total_cooked_g, raw_ingredients (jsonb: ingredient_id → raw g), servings (int).

## 6. Feedback and learning

**review** — id, household_id →, author_user_id →, on_behalf_of_member_id →?, target_type (`dish` | `component` | `variant` | `ingredient` | `plan_meal` | `plate` | `plan_day` | `cuisine` | `method`), target_id (uuid or key), plan_meal_id →? (context: which meal it was eaten at), rating (1–5)?, tags (text[]; vocabulary in [06-feedback-and-learning.md](06-feedback-and-learning.md) §2), comment?, parent_review_id →? (threaded replies), created_at, edited_at?, processed_at? (by the learning pipeline).

**review_reaction** — review_id →, user_id →, kind (`agree` | `disagree` | `helpful`).

**preference** — id, household_id →, member_id →? (null = household-level), entity_type (`dish` | `ingredient` | `cuisine` | `method` | `flavour_tag` | `component_role`), entity_key, score (−1…1), evidence_weight (numeric, Σw), source (`explicit` | `learned` | `proposal`), locked (bool: admin-set, learning must not change it), hard (`none` | `never` | `always_ok`), updated_at. Unique (household_id, member_id, entity_type, entity_key, source).

**frequency_rule** — household_id →, member_id →?, entity_type (`dish` | `ingredient` | `cuisine` | `method`), entity_key, min_gap_days?, max_per_week?, source, locked.

**exclusion** — household_id →, member_id →?, kind (`ingredient` | `category` | `dietary_flag`), key, reason (`allergy` | `religious` | `dislike` | `medical` | `other`), hard (bool, always true for allergy). Household-level exclusions apply to all members. Allergy exclusions are never removed by learning or proposals without an explicit admin action (DM-5).

**planning_weights** — household_id → (PK), macro_precision (0–1, default 1.0), appeal (default 0.6), ingredient_economy (default 0.4), variety (default 0.3), fairness (0–1, default 0.5; see [04-planner.md](04-planner.md) §6.2), ai_generation (`auto` | `ask` | `off`, default `auto`), economy_window_days (default 7), updated_at. **weight_preset** — household_id →, name ("Weekend", "Busy week"), values (jsonb), applies_to_weekdays (int[])?.

## 7. Agent, proposals, change log

**conversation** — id, household_id →, user_id →, title, created_at, archived_at?.

**chat_message** — id, conversation_id →, role (`user` | `assistant` | `tool` | `event`), content (jsonb: the Anthropic content blocks stored verbatim for replay; text for display), created_at. Messages are append-only (see [07-agent.md](07-agent.md) §6).

**proposal** — id, household_id →, origin (`agent_chat` | `insights` | `rule`), conversation_id →?, message_id →?, kind (see [07-agent.md](07-agent.md) §4), payload (jsonb, validated by the kind's Zod schema), rationale (text), evidence (jsonb: review ids, metrics), fingerprint (text; for de-duplication and cooldown), status (`pending` | `accepted` | `rejected` | `expired` | `superseded`), decided_by_user_id →?, decided_at?, decision_note?, change_set_id →?, expires_at.

**change_set** — id, household_id →, actor (`user` | `agent` | `system`), actor_user_id →?, source (`ui` | `agent_apply` | `proposal_accept` | `learning`), summary, forward (jsonb: list of typed operations), inverse (jsonb: list of operations that restore the prior state), applied_at, undone_at?, undone_by_change_set_id →?.

DM-6 Every mutation of household configuration, preferences, recipes or plans MUST go through the change-set service, which writes forward and inverse operations in one transaction. The only exceptions are review creation and auth/session tables.

## 8. Knowledge graph

**kg_node** — id, household_id →? (null = global), type, key, label, props (jsonb). Unique (household_id, type, key).
**kg_edge** — id, household_id →?, src_id →, dst_id →, type, weight (numeric), props (jsonb), source (`seed` | `derived` | `learned` | `ai`), updated_at. Index on (src_id, type) and (dst_id, type).

See [08-knowledge-graph.md](08-knowledge-graph.md).

## 9. AI audit

**ai_generation** — id, household_id →, purpose (`recipe` | `insights` | `chat` | `comment_extraction`), model, request_summary (jsonb, no secrets), response_raw (jsonb), input_tokens, output_tokens, cache_read_tokens, stop_reason, validation_errors (jsonb)?, created_at. It is the audit trail for every Claude call (DM-7).
