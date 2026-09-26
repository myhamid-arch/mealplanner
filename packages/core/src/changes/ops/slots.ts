// slot.create, slot.update, slot_schedule.set, distribution.set, slot_target.set (AGT-6, 02 §2,
// PLN-2 … PLN-4).
import { z } from "zod";
import { DAY_KINDS } from "../../types/index.js";
import { defineOp, definedFields, requireRow } from "../define.js";
import { ChangeOpError, type ChangeTx } from "../tx.js";
import { grams, id, share01, slotKey, time, weekday } from "./common.js";

const SlotFields = z.object({
  label: z.string().trim().min(1).max(60),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/, "an icon key (R2-UX-5)"),
  sortOrder: z.number().int().min(0).max(10_000),
  defaultTime: time,
  isShared: z.boolean(),
  isPacked: z.boolean(),
  reheatAvailable: z.boolean(),
  isTrainingSlot: z.boolean(),
  constraintsNote: z.string().max(500).nullable(),
  active: z.boolean(),
});

async function requireSlot(kind: string, tx: ChangeTx, slotTypeId: string) {
  return requireRow(kind, `slot ${slotTypeId}`, tx.get("slot_type", { id: slotTypeId }));
}

async function requireMember(kind: string, tx: ChangeTx, memberId: string) {
  return requireRow(kind, `member ${memberId}`, tx.get("member", { id: memberId }));
}

export const slotCreate = defineOp({
  kind: "slot.create",
  area: "schedule",
  schema: SlotFields.partial({ constraintsNote: true })
    .extend({ id: id.optional(), key: slotKey })
    .strict()
    .refine((p) => p.isPacked || !p.reheatAvailable, "reheat applies to packed slots only"),
  title: (p) => `Add slot "${p.label}"`,
  apply: async (tx, { id: slotId, constraintsNote, ...fields }) => {
    const clash = await tx.find("slot_type", { key: fields.key });
    if (clash.length > 0) throw new ChangeOpError("slot.create", `slot key "${fields.key}" exists`);
    await tx.insert("slot_type", {
      id: slotId ?? tx.newId(),
      householdId: tx.householdId,
      constraintsNote: constraintsNote ?? null,
      ...fields,
    });
  },
});

/** The key is immutable: dishes refer to slots by key (02 §4 dish.slot_keys). */
export const slotUpdate = defineOp({
  kind: "slot.update",
  area: "schedule",
  schema: SlotFields.partial()
    .extend({ slotTypeId: id })
    .strict()
    .refine((p) => Object.keys(p).length > 1, "at least one field"),
  title: (p) =>
    `Update slot (${Object.keys(p)
      .filter((k) => k !== "slotTypeId")
      .join(", ")})`,
  apply: async (tx, { slotTypeId, ...fields }) => {
    const slot = await requireSlot("slot.update", tx, slotTypeId);
    const next = { ...slot, ...definedFields(fields) };
    if (next.reheatAvailable && !next.isPacked)
      throw new ChangeOpError("slot.update", "reheat applies to packed slots only");
    await tx.update("slot_type", { id: slotTypeId }, definedFields(fields));
  },
});

/**
 * Detailed attendance layer (02 §2 member_slot_schedule). `attends: null` deletes the row, which
 * returns that weekday to the coarse default.
 */
export const slotScheduleSet = defineOp({
  kind: "slot_schedule.set",
  area: "schedule",
  schema: z
    .object({
      memberId: id,
      slotTypeId: id,
      days: z.array(z.object({ weekday, attends: z.boolean().nullable() }).strict()).min(1),
    })
    .strict()
    .refine(
      (p) => new Set(p.days.map((d) => d.weekday)).size === p.days.length,
      "duplicate weekday",
    ),
  title: (p) => `Set attendance for ${String(p.days.length)} weekday(s)`,
  apply: async (tx, { memberId, slotTypeId, days }) => {
    await requireMember("slot_schedule.set", tx, memberId);
    await requireSlot("slot_schedule.set", tx, slotTypeId);
    for (const { weekday: day, attends } of days) {
      const key = { memberId, slotTypeId, weekday: day };
      const existing = await tx.get("member_slot_schedule", key);
      if (attends === null) {
        if (existing !== null) await tx.remove("member_slot_schedule", key);
      } else if (existing === null) {
        await tx.insert("member_slot_schedule", { householdId: tx.householdId, ...key, attends });
      } else if (existing.attends !== attends) {
        await tx.update("member_slot_schedule", key, { attends });
      }
    }
  },
});

/**
 * Replaces a member's meal split for one day kind (PLN-4 detailed layer). `shares: null` clears it
 * (back to automatic). Shares must sum to 1 ± 0.001.
 */
export const distributionSet = defineOp({
  kind: "distribution.set",
  area: "targets",
  schema: z
    .object({
      memberId: id,
      dayKind: z.enum(DAY_KINDS),
      shares: z
        .array(z.object({ slotTypeId: id, share: share01 }).strict())
        .min(1)
        .nullable(),
    })
    .strict()
    .refine(
      (p) =>
        p.shares === null || new Set(p.shares.map((s) => s.slotTypeId)).size === p.shares.length,
      "duplicate slot",
    )
    .refine(
      (p) =>
        p.shares === null || Math.abs(p.shares.reduce((sum, s) => sum + s.share, 0) - 1) <= 0.001,
      "shares must sum to 1 ± 0.001",
    ),
  title: (p) =>
    p.shares === null
      ? `Reset ${p.dayKind} meal split to automatic`
      : `Set ${p.dayKind} meal split`,
  apply: async (tx, { memberId, dayKind, shares }) => {
    await requireMember("distribution.set", tx, memberId);
    const existing = await tx.find("meal_distribution", { memberId, dayKind });
    const wanted = new Map((shares ?? []).map((s) => [s.slotTypeId, s.share]));
    for (const row of existing) {
      if (!wanted.has(row.slotTypeId))
        await tx.remove("meal_distribution", { memberId, dayKind, slotTypeId: row.slotTypeId });
    }
    for (const [slotTypeId, share] of wanted) {
      await requireSlot("distribution.set", tx, slotTypeId);
      const row = existing.find((r) => r.slotTypeId === slotTypeId);
      if (row === undefined) {
        await tx.insert("meal_distribution", {
          householdId: tx.householdId,
          memberId,
          dayKind,
          slotTypeId,
          share,
        });
      } else if (row.share !== share) {
        await tx.update("meal_distribution", { memberId, dayKind, slotTypeId }, { share });
      }
    }
  },
});

/** Expert layer: explicit per-slot macro targets (02 §2 slot_target_override); null clears. */
export const slotTargetSet = defineOp({
  kind: "slot_target.set",
  area: "targets",
  schema: z
    .object({
      memberId: id,
      dayKind: z.enum(DAY_KINDS),
      slotTypeId: id,
      values: z
        .object({
          kcal: grams.nullable().default(null),
          proteinG: grams.nullable().default(null),
          carbsG: grams.nullable().default(null),
          fatG: grams.nullable().default(null),
        })
        .strict()
        .refine((v) => Object.values(v).some((x) => x !== null), "at least one value")
        .nullable(),
    })
    .strict(),
  title: (p) => (p.values === null ? "Clear slot target" : "Set slot target"),
  apply: async (tx, { memberId, dayKind, slotTypeId, values }) => {
    await requireMember("slot_target.set", tx, memberId);
    await requireSlot("slot_target.set", tx, slotTypeId);
    const key = { memberId, dayKind, slotTypeId };
    const existing = await tx.get("slot_target_override", key);
    if (values === null) {
      if (existing === null) throw new ChangeOpError("slot_target.set", "no slot target to clear");
      await tx.remove("slot_target_override", key);
    } else if (existing === null) {
      await tx.insert("slot_target_override", { householdId: tx.householdId, ...key, ...values });
    } else {
      await tx.update("slot_target_override", key, values);
    }
  },
});
