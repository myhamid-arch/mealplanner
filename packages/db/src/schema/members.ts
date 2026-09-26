// 02 §2 Members, targets, schedules; BLD-8 R-8 (household_id + composite FKs), R-9 e, f.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { num, tstz } from "./columns.js";
import {
  appetite,
  componentRole,
  dayKind,
  dayOverrideKind,
  detailLevelValue,
  sex,
  targetKind,
  toleranceMode,
  trainingIntensity,
} from "./enums.js";
import { household } from "./tenancy.js";

const householdIdColumn = () =>
  uuid("household_id")
    .notNull()
    .references(() => household.id);

const WEEKDAY_CHECK = (column: unknown) => sql`${column} BETWEEN 0 AND 6`;

export const member = pgTable(
  "member",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    displayName: text("display_name").notNull(),
    emojiAvatar: text("emoji_avatar"),
    color: text("color").notNull(),
    birthYear: integer("birth_year"),
    sex: sex("sex"),
    isTargeted: boolean("is_targeted").notNull(),
    appetite: appetite("appetite").notNull().default("medium"),
    notes: text("notes"),
    archivedAt: tstz("archived_at"),
  },
  (t) => [
    index("member_household_id_idx").on(t.householdId),
    unique("member_household_id_id_key").on(t.householdId, t.id),
  ],
);

export const slotType = pgTable(
  "slot_type",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    emoji: text("emoji").notNull(),
    sortOrder: integer("sort_order").notNull(),
    defaultTime: time("default_time").notNull(),
    isShared: boolean("is_shared").notNull(),
    isPacked: boolean("is_packed").notNull(),
    reheatAvailable: boolean("reheat_available").notNull(),
    isTrainingSlot: boolean("is_training_slot").notNull(),
    constraintsNote: text("constraints_note"),
    active: boolean("active").notNull(),
  },
  (t) => [
    index("slot_type_household_id_idx").on(t.householdId),
    unique("slot_type_household_id_id_key").on(t.householdId, t.id),
    unique("slot_type_household_id_key_key").on(t.householdId, t.key),
  ],
);

/** Composite FK (household_id, member_id) → member (BLD-8 R-8). */
export function memberFk(name: string, householdId: AnyPgColumn, memberId: AnyPgColumn) {
  return foreignKey({
    name,
    columns: [householdId, memberId],
    foreignColumns: [member.householdId, member.id],
  });
}

/** Composite FK (household_id, slot_type_id) → slot_type (BLD-8 R-8). */
export function slotTypeFk(name: string, householdId: AnyPgColumn, slotTypeId: AnyPgColumn) {
  return foreignKey({
    name,
    columns: [householdId, slotTypeId],
    foreignColumns: [slotType.householdId, slotType.id],
  });
}

export const targetProfile = pgTable(
  "target_profile",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    memberId: uuid("member_id").notNull(),
    kind: targetKind("kind").notNull(),
    kcal: num("kcal").notNull(),
    proteinG: num("protein_g").notNull(),
    carbsG: num("carbs_g").notNull(),
    fatG: num("fat_g").notNull(),
    satFatMaxG: num("sat_fat_max_g"),
    solubleFibreMinG: num("soluble_fibre_min_g"),
    fibreMinG: num("fibre_min_g"),
    sodiumMaxMg: num("sodium_max_mg"),
  },
  (t) => [
    index("target_profile_household_id_idx").on(t.householdId),
    unique("target_profile_member_id_kind_key").on(t.memberId, t.kind),
    memberFk("target_profile_member_fk", t.householdId, t.memberId),
    check(
      "target_profile_non_negative",
      sql`${t.kcal} >= 0 AND ${t.proteinG} >= 0 AND ${t.carbsG} >= 0 AND ${t.fatG} >= 0`,
    ),
  ],
);

export const tolerance = pgTable(
  "tolerance",
  {
    memberId: uuid("member_id").primaryKey(),
    householdId: householdIdColumn(),
    proteinG: num("protein_g").notNull().default(5),
    carbsG: num("carbs_g").notNull().default(5),
    fatG: num("fat_g").notNull().default(2),
    kcal: num("kcal").notNull().default(50),
    mode: toleranceMode("mode").notNull().default("strict"),
  },
  (t) => [
    index("tolerance_household_id_idx").on(t.householdId),
    memberFk("tolerance_member_fk", t.householdId, t.memberId),
    check(
      "tolerance_non_negative",
      sql`${t.proteinG} >= 0 AND ${t.carbsG} >= 0 AND ${t.fatG} >= 0 AND ${t.kcal} >= 0`,
    ),
  ],
);

export const memberSlotSchedule = pgTable(
  "member_slot_schedule",
  {
    householdId: householdIdColumn(),
    memberId: uuid("member_id").notNull(),
    slotTypeId: uuid("slot_type_id").notNull(),
    weekday: smallint("weekday").notNull(),
    attends: boolean("attends").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.slotTypeId, t.weekday] }),
    index("member_slot_schedule_household_id_idx").on(t.householdId),
    memberFk("member_slot_schedule_member_fk", t.householdId, t.memberId),
    slotTypeFk("member_slot_schedule_slot_type_fk", t.householdId, t.slotTypeId),
    check("member_slot_schedule_weekday_range", WEEKDAY_CHECK(t.weekday)),
  ],
);

export const trainingSchedule = pgTable(
  "training_schedule",
  {
    householdId: householdIdColumn(),
    memberId: uuid("member_id").notNull(),
    weekday: smallint("weekday").notNull(),
    sessionTime: time("session_time"),
    intensity: trainingIntensity("intensity"),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.weekday] }),
    index("training_schedule_household_id_idx").on(t.householdId),
    memberFk("training_schedule_member_fk", t.householdId, t.memberId),
    check("training_schedule_weekday_range", WEEKDAY_CHECK(t.weekday)),
  ],
);

export const dayOverride = pgTable(
  "day_override",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    memberId: uuid("member_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    kind: dayOverrideKind("kind").notNull(),
    slotTypeId: uuid("slot_type_id"),
  },
  (t) => [
    index("day_override_household_id_idx").on(t.householdId),
    unique("day_override_member_date_kind_slot_key")
      .on(t.memberId, t.date, t.kind, t.slotTypeId)
      .nullsNotDistinct(),
    memberFk("day_override_member_fk", t.householdId, t.memberId),
    slotTypeFk("day_override_slot_type_fk", t.householdId, t.slotTypeId),
    check(
      "day_override_slot_matches_kind",
      sql`(${t.kind} IN ('absent_slot', 'extra_slot')) = (${t.slotTypeId} IS NOT NULL)`,
    ),
  ],
);

export const mealDistribution = pgTable(
  "meal_distribution",
  {
    householdId: householdIdColumn(),
    memberId: uuid("member_id").notNull(),
    dayKind: dayKind("day_kind").notNull(),
    slotTypeId: uuid("slot_type_id").notNull(),
    share: num("share").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.dayKind, t.slotTypeId] }),
    index("meal_distribution_household_id_idx").on(t.householdId),
    memberFk("meal_distribution_member_fk", t.householdId, t.memberId),
    slotTypeFk("meal_distribution_slot_type_fk", t.householdId, t.slotTypeId),
    check("meal_distribution_share_range", sql`${t.share} >= 0 AND ${t.share} <= 1`),
  ],
);

export const slotTargetOverride = pgTable(
  "slot_target_override",
  {
    householdId: householdIdColumn(),
    memberId: uuid("member_id").notNull(),
    dayKind: dayKind("day_kind").notNull(),
    slotTypeId: uuid("slot_type_id").notNull(),
    kcal: num("kcal"),
    proteinG: num("protein_g"),
    carbsG: num("carbs_g"),
    fatG: num("fat_g"),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.dayKind, t.slotTypeId] }),
    index("slot_target_override_household_id_idx").on(t.householdId),
    memberFk("slot_target_override_member_fk", t.householdId, t.memberId),
    slotTypeFk("slot_target_override_slot_type_fk", t.householdId, t.slotTypeId),
  ],
);

/** FBK-5 learned_role_bias (BLD-8 R-9 e). */
export const portionBias = pgTable(
  "portion_bias",
  {
    householdId: householdIdColumn(),
    memberId: uuid("member_id").notNull(),
    componentRole: componentRole("component_role").notNull(),
    bias: num("bias").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.componentRole] }),
    index("portion_bias_household_id_idx").on(t.householdId),
    memberFk("portion_bias_member_fk", t.householdId, t.memberId),
    check("portion_bias_bias_range", sql`${t.bias} >= 0.6 AND ${t.bias} <= 1.6`),
  ],
);

/** R2-DL-1: level per (member, section); member null = a household-level section (R-9 f). */
export const detailLevel = pgTable(
  "detail_level",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    memberId: uuid("member_id"),
    section: text("section").notNull(),
    level: detailLevelValue("level").notNull(),
  },
  (t) => [
    index("detail_level_household_id_idx").on(t.householdId),
    unique("detail_level_household_member_section_key")
      .on(t.householdId, t.memberId, t.section)
      .nullsNotDistinct(),
    memberFk("detail_level_member_fk", t.householdId, t.memberId),
  ],
);
