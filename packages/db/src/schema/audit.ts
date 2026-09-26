// 02 §9 AI audit (DM-7): one row per Claude call.
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { Json } from "@mealplanner/core/types";
import { tstz } from "./columns.js";
import { aiPurpose } from "./enums.js";
import { household } from "./tenancy.js";

export const aiGeneration = pgTable(
  "ai_generation",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    purpose: aiPurpose("purpose").notNull(),
    model: text("model").notNull(),
    requestSummary: jsonb("request_summary").$type<Json>().notNull(),
    responseRaw: jsonb("response_raw").$type<Json>().notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    stopReason: text("stop_reason").notNull(),
    validationErrors: jsonb("validation_errors").$type<Json>(),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [index("ai_generation_household_id_idx").on(t.householdId, t.createdAt)],
);
