# leaf-1.1.2 ADR-1: Drizzle schema conventions

Status: accepted (CP1 APPROVED with amendments; built for CP2)
Requirement: DM-1, 02-domain-model (all tables), 13-revision-r2 §3–§4, ARC-1

## Decision

- **drizzle-orm 0.45.3** with the `pg` 8.23.0 driver (`drizzle-orm/node-postgres`), both already declared in `packages/db/package.json` (leaf-1.1.1 ADR-6). Schema is written with `drizzle-orm/pg-core` (`pgTable`, `pgEnum`, `uuid`, `numeric`, `timestamp({ withTimezone: true })`, `jsonb`, `text().array()`, `customType` for `citext`).
- One file per spec section under `packages/db/src/schema/`: `enums.ts`, `tenancy.ts` (§1 + r2 §4 + auth-library tables, see ADR-4), `members.ts` (§2), `catalog.ts` (§3), `recipes.ts` (§4), `plans.ts` (§5 + r2 `meal_override`), `feedback.ts` (§6), `agent.ts` (§7), `graph.ts` (§8), `audit.ts` (§9), re-exported by `schema/index.ts` (subpath `@mealplanner/db/schema`, BLD-8 R-1).
- **Names.** Table and column names are the spec's snake_case names verbatim; TypeScript keys are camelCase. G1 introspects the migrated database against a spec list written independently of the schema (`packages/db/test/spec-columns.ts`), so a rename is caught.
- **IDs.** `uuid` columns, UUIDv7 generated in the app (02 preamble). The generator is a ~20-line RFC 9562 implementation over `crypto.getRandomValues` in `packages/db/src/schema/ids.ts` (no new dependency). No database default.
- **Enums.** Postgres enums for every closed enumeration in 02. The value lists live once, as `as const` arrays in `packages/core/src/types/enums.ts`; `pgEnum` is built from those arrays, and Zod enums in the change-op registry use the same arrays, so the DB and the op schemas cannot drift. Extensible text fields stay `text` (cuisine key, slot key, review tags, dietary flags, preference `entity_key`).
- **Numbers.** Nutrient quantities `numeric(10,3)`, mapped to `number` with `numeric({ mode: "number" })` (supported in 0.45: `PgNumericNumber`). Shares/weights/scores are `numeric(10,3)` too.
- **Household scoping at the database level (DM-1).** Every table whose rows belong to one household has `household_id` + an index, including member-scoped child tables where 02 lists only `member_id` (`target_profile`, `tolerance`, schedules, overrides, distributions; `plan_meal`, `plate`, `plate_item`, `cook_batch`; `chat_message`; `review_reaction`). References to `member`, `slot_type`, `plan_day`, `plan_meal`, `plate`, `conversation`, `review` are **composite foreign keys `(household_id, x_id) → x(household_id, id)`**, so a row can never point at another household's entity even if a repository bug let it through. Recipe tables (`dish` and its children, `dish_nutrition_cache`) and `ingredient`, `kg_node`, `kg_edge` carry a nullable `household_id` (null = global). See SPEC-Q-2.
- **Keys where 02 gives none.** Natural composite primary keys where the spec implies one row per key: `member_slot_schedule (member_id, slot_type_id, weekday)`, `training_schedule (member_id, weekday)`, `meal_distribution` and `slot_target_override (member_id, day_kind, slot_type_id)`, `review_reaction (review_id, user_id, kind)`, `method_yield (method_id, ingredient_category)`. All other tables get `id uuid` (SPEC-Q-3).
- No household-owned foreign key cascades. A cascade would delete rows without passing through `ChangeTx`, so the change set's inverse would have no before-image for them (ADR-3); ops delete children explicitly instead (e.g. `dish.update` removes variant ingredients, variants, then components). Only the auth-library tables (`session`, `account`, `two_factor`, `user_notification_pref`) cascade from `user`.
- Timestamps are `timestamptz(3)` (millisecond precision), so a value read into a JS `Date` and written back by an undo is identical to the original.
- Weekdays are `0 = Monday … 6 = Sunday` (SPEC-Q-10); `weekdayOf(date)` in `@mealplanner/core/types` converts a date.
- R-9 a–l, R-11 and R-12 are built as ruled: see the column list in `packages/db/test/spec-columns.ts`, which G1 checks against the live database.

## Consequences

- Other leaves import tables and inferred row types from `@mealplanner/db/schema`. Domain types that `core` needs (pure, no drizzle) live in `@mealplanner/core/types` and are what the schema's enum arrays come from.
