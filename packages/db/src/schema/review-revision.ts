// 02 §6 review_revision (FBK-2 "edits are kept", BLD-8 R-26): one row per edit of a review,
// holding the values that edit replaced. Composite household FKs (BLD-8 R-8).
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";
import { tstz } from "./columns.js";
import { review } from "./feedback.js";
import { household, user } from "./tenancy.js";

export const reviewRevision = pgTable(
  "review_revision",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    reviewId: uuid("review_id").notNull(),
    rating: smallint("rating"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    comment: text("comment"),
    replacedAt: tstz("replaced_at").notNull(),
    editedByUserId: uuid("edited_by_user_id")
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    index("review_revision_household_id_idx").on(t.householdId),
    index("review_revision_review_idx").on(t.householdId, t.reviewId),
    foreignKey({
      name: "review_revision_review_fk",
      columns: [t.householdId, t.reviewId],
      foreignColumns: [review.householdId, review.id],
    }),
    check("review_revision_rating_range", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  ],
);
