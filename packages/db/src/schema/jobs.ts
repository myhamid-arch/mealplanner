// Background jobs and their progress events (ARC-7 "job_event"), and the support-access log
// (R2-ADM-8). BLD-8 R-40 (leaf-1.4.1 SPEC-Q-7, SPEC-Q-8).
//
// `job.id` is the pg-boss job id. `household_id` is null for platform jobs (kg.nightly, the
// catalogue sync). Status changes by the worker are operational writes outside DM-6 (R-40); a job
// row inserted by a change op (`recipe.generate`, `recipe.revise`) can be deleted by that change
// set's undo only while it is still `queued` (trigger in migration 0004).
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { JOB_STATUSES, type Json } from "@mealplanner/core/types";
import { tstz } from "./columns.js";
import { household, platformOperator, user } from "./tenancy.js";

export const jobStatus = pgEnum("job_status", JOB_STATUSES);

export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id").references(() => household.id),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Json>().notNull(),
    status: jobStatus("status").notNull().default("queued"),
    error: jsonb("error").$type<Json>(),
    createdByUserId: uuid("created_by_user_id").references(() => user.id),
    createdAt: tstz("created_at").notNull(),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
  },
  (t) => [
    index("job_household_id_idx").on(t.householdId),
    index("job_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const jobEvent = pgTable(
  "job_event",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id),
    seq: integer("seq").notNull(),
    householdId: uuid("household_id").references(() => household.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Json>().notNull(),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.seq] }),
    index("job_event_household_id_idx").on(t.householdId),
  ],
);

export const supportAccess = pgTable(
  "support_access",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    // No foreign key: 1.1.2's G1 negative control drops `support_grant`, which a dependent FK would
    // block. The id is written only after the grant has been checked in the same request.
    grantId: uuid("grant_id").notNull(),
    operatorUserId: uuid("operator_user_id")
      .notNull()
      .references(() => platformOperator.userId),
    method: text("method").notNull(),
    path: text("path").notNull(),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [index("support_access_household_id_idx").on(t.householdId)],
);
