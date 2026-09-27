// First-days follow-up questions (R2-ONB-6; BLD-8 R-56, leaf-1.4.7 SPEC-Q-11). One row per
// household and follow-up key once the admin answered or dismissed it; an open follow-up has no
// row. Like `detail_level` (R-24) this is UI state written directly through its repository, outside
// DM-6: an answer that changes the configuration applies its ops as its own change set, whose id is
// kept here. Rows go with their household (`household.purge` deletes the household last), and
// the change-set and user references are cleared rather than blocking those deletions.
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { FOLLOWUP_STATUSES } from "@mealplanner/core/onboarding/followups";
import { changeSet } from "./agent.js";
import { tstz } from "./columns.js";
import { household, user } from "./tenancy.js";

export const setupFollowupStatus = pgEnum("setup_followup_status", FOLLOWUP_STATUSES);

export const setupFollowup = pgTable(
  "setup_followup",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    /** `school_nut_free`, `dinner_time` or `training_kcal:<member id>`. */
    key: text("key").notNull(),
    status: setupFollowupStatus("status").notNull(),
    /** The one-tap choice of an answer; null for a dismissal. */
    choice: text("choice"),
    /** The change set the answer applied, if it changed the configuration. */
    changeSetId: uuid("change_set_id").references(() => changeSet.id, { onDelete: "set null" }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: tstz("resolved_at").notNull(),
  },
  (t) => [
    index("setup_followup_household_id_idx").on(t.householdId),
    unique("setup_followup_household_key_key").on(t.householdId, t.key),
    check("setup_followup_key_length", sql`char_length(${t.key}) BETWEEN 1 AND 80`),
    check(
      "setup_followup_choice",
      sql`(${t.status} = 'answered') = (${t.choice} IS NOT NULL)`,
    ),
  ],
);
