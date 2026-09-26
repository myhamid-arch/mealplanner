// 02 §1 Tenancy and identity, 13 §4 (R2-ADM), auth-library tables (ADR-4), BLD-8 R-9 g–k, R-11.
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
  varchar,
  check,
} from "drizzle-orm/pg-core";
import { citext, num, tstz } from "./columns.js";
import {
  householdRole,
  householdUserStatus,
  insightFrequency,
  toleranceMode,
  unitSystem,
} from "./enums.js";
import { member } from "./members.js";

export const user = pgTable("user", {
  id: uuid("id").primaryKey(),
  email: citext("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  platformBlockedAt: tstz("platform_blocked_at"),
  createdAt: tstz("created_at").notNull(),
  updatedAt: tstz("updated_at").notNull(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: tstz("created_at").notNull(),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tstz("created_at").notNull(),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: tstz("created_at").notNull(),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** R2-ADM-5 TOTP secret (better-auth two-factor plugin table). */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: tstz("locked_until"),
  },
  (t) => [
    index("two_factor_user_id_idx").on(t.userId),
    index("two_factor_secret_idx").on(t.secret),
  ],
);

/** R2-ADM-8: a platform role outside households (SPEC-Q-9). */
export const platformOperator = pgTable("platform_operator", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id),
  createdAt: tstz("created_at").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => user.id),
});

/** R2-ADM-5 notification preferences (R-9 j). */
export const userNotificationPref = pgTable(
  "user_notification_pref",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const household = pgTable(
  "household",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    locale: text("locale").notNull().default("en-AE"),
    timezone: text("timezone").notNull().default("Asia/Dubai"),
    unitSystem: unitSystem("unit_system").notNull().default("metric"),
    countryCode: text("country_code").notNull().default("AE"),
    regionNote: text("region_note"),
    membersSeePlates: boolean("members_see_plates").notNull().default(true),
    agentMayApply: boolean("agent_may_apply").notNull().default(true),
    // R2-ADM-5/6 settings (R-9 h).
    requireTotpForAdmins: boolean("require_totp_for_admins").notNull().default(false),
    kitchenSeesNames: boolean("kitchen_sees_names").notNull().default(true),
    membersReviewForSiblings: boolean("members_review_for_siblings").notNull().default(true),
    insightFrequency: insightFrequency("insight_frequency").notNull().default("nightly"),
    defaultPrecision: toleranceMode("default_precision").notNull().default("strict"),
    satFatDefaultPct: num("sat_fat_default_pct").notNull().default(10),
    // R2-ADM-6 deletion grace, R2-ADM-8 suspension (R-9 i).
    deletionRequestedAt: tstz("deletion_requested_at"),
    deletionRequestedByUserId: uuid("deletion_requested_by_user_id").references(() => user.id),
    suspendedAt: tstz("suspended_at"),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [
    check(
      "household_sat_fat_default_pct_range",
      sql`${t.satFatDefaultPct} > 0 AND ${t.satFatDefaultPct} <= 100`,
    ),
  ],
);

export const householdUser = pgTable(
  "household_user",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    role: householdRole("role").notNull(),
    memberId: uuid("member_id"),
    status: householdUserStatus("status").notNull().default("active"),
    blockedReason: text("blocked_reason"),
    lastActiveAt: tstz("last_active_at"),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    index("household_user_household_id_idx").on(t.householdId),
    index("household_user_user_id_idx").on(t.userId),
    foreignKey({
      name: "household_user_member_fk",
      columns: [t.householdId, t.memberId],
      foreignColumns: [member.householdId, member.id],
    }),
  ],
);

export const invite = pgTable(
  "invite",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    code: varchar("code", { length: 10 }).notNull().unique(),
    role: householdRole("role").notNull(),
    memberId: uuid("member_id"),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    revokedAt: tstz("revoked_at"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [
    index("invite_household_id_idx").on(t.householdId),
    check("invite_code_length", sql`char_length(${t.code}) = 10`),
    foreignKey({
      name: "invite_member_fk",
      columns: [t.householdId, t.memberId],
      foreignColumns: [member.householdId, member.id],
    }),
  ],
);

/** R2-ADM-8: time-limited operator access granted by a household admin. */
export const supportGrant = pgTable(
  "support_grant",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    operatorUserId: uuid("operator_user_id")
      .notNull()
      .references(() => platformOperator.userId),
    grantedByUserId: uuid("granted_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: tstz("created_at").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    index("support_grant_household_id_idx").on(t.householdId),
    check("support_grant_expires_after_created", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
