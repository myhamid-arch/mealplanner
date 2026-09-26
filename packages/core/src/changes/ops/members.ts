// member.create, member.update, member.archive*, target.set, tolerance.set (* when looser),
// training.set, day_override.set (AGT-6, 02 §2).
import { z } from "zod";
import {
  APPETITES,
  COMPONENT_ROLES,
  PORTION_BIAS_BOUNDS,
  DAY_OVERRIDE_KINDS,
  DEFAULT_TOLERANCE,
  SEXES,
  TARGET_KINDS,
  TOLERANCE_MODES,
  TRAINING_INTENSITIES,
} from "../../types/index.js";
import { defineOp, definedFields, requireRow } from "../define.js";
import { ChangeOpError, type ChangeTx } from "../tx.js";
import { grams, id, isoDate, time, weekday } from "./common.js";

const MemberFields = z.object({
  displayName: z.string().trim().min(1).max(80),
  color: z.string().min(1).max(40),
  birthYear: z.number().int().min(1900).max(2100).nullable(),
  sex: z.enum(SEXES).nullable(),
  isTargeted: z.boolean(),
  appetite: z.enum(APPETITES),
  notes: z.string().max(2000).nullable(),
});

async function requireMember(kind: string, tx: ChangeTx, memberId: string) {
  return requireRow(kind, `member ${memberId}`, tx.get("member", { id: memberId }));
}

export const memberCreate = defineOp({
  kind: "member.create",
  area: "members",
  schema: MemberFields.partial({
    birthYear: true,
    sex: true,
    appetite: true,
    notes: true,
  })
    .extend({ id: id.optional() })
    .strict(),
  title: (p) => `Add ${p.displayName}`,
  apply: async (tx, p) => {
    const memberId = p.id ?? tx.newId();
    await tx.insert("member", {
      id: memberId,
      householdId: tx.householdId,
      displayName: p.displayName,
      color: p.color,
      birthYear: p.birthYear ?? null,
      sex: p.sex ?? null,
      isTargeted: p.isTargeted,
      appetite: p.appetite ?? "medium",
      notes: p.notes ?? null,
      archivedAt: null,
    });
    await tx.insert("tolerance", { memberId, householdId: tx.householdId, ...DEFAULT_TOLERANCE });
  },
});

export const memberUpdate = defineOp({
  kind: "member.update",
  area: "members",
  schema: MemberFields.partial()
    .extend({ memberId: id })
    .strict()
    .refine((p) => Object.keys(p).length > 1, "at least one field"),
  title: (p) =>
    `Update member (${Object.keys(p)
      .filter((k) => k !== "memberId")
      .join(", ")})`,
  apply: async (tx, { memberId, ...fields }) => {
    const member = await requireMember("member.update", tx, memberId);
    if (member.archivedAt !== null) throw new ChangeOpError("member.update", "member is archived");
    await tx.update("member", { id: memberId }, definedFields(fields));
  },
});

/** AGT-5: archiving a member is always protected. */
export const memberArchive = defineOp({
  kind: "member.archive",
  area: "members",
  schema: z.object({ memberId: id }).strict(),
  protected: true,
  title: () => "Archive member",
  apply: async (tx, { memberId }) => {
    const member = await requireMember("member.archive", tx, memberId);
    if (member.archivedAt !== null)
      throw new ChangeOpError("member.archive", "member is already archived");
    await tx.update("member", { id: memberId }, { archivedAt: tx.now() });
  },
});

const TargetProfile = z
  .object({
    kcal: grams,
    proteinG: grams,
    carbsG: grams,
    fatG: grams,
    satFatMaxG: grams.nullable().default(null),
    solubleFibreMinG: grams.nullable().default(null),
    fibreMinG: grams.nullable().default(null),
    sodiumMaxMg: grams.nullable().default(null),
  })
  .strict();

/** Sets or (training only, DM-2) removes a member's target profile of one kind. */
export const targetSet = defineOp({
  kind: "target.set",
  area: "targets",
  schema: z
    .object({ memberId: id, kind: z.enum(TARGET_KINDS), profile: TargetProfile.nullable() })
    .strict()
    .refine(
      (p) => p.profile !== null || p.kind === "training",
      "the default profile cannot be removed",
    ),
  title: (p) => (p.profile === null ? `Remove ${p.kind} targets` : `Set ${p.kind} targets`),
  apply: async (tx, { memberId, kind, profile }) => {
    const member = await requireMember("target.set", tx, memberId);
    if (profile !== null && !member.isTargeted)
      throw new ChangeOpError("target.set", "member is not targeted");
    const [existing] = await tx.find("target_profile", { memberId, kind });
    if (profile === null) {
      if (existing === undefined)
        throw new ChangeOpError("target.set", `no ${kind} profile to remove`);
      await tx.remove("target_profile", { id: existing.id });
    } else if (existing === undefined) {
      await tx.insert("target_profile", {
        id: tx.newId(),
        householdId: tx.householdId,
        memberId,
        kind,
        ...profile,
      });
    } else {
      await tx.update("target_profile", { id: existing.id }, profile);
    }
  },
});

const ToleranceSet = z
  .object({
    memberId: id,
    proteinG: grams.optional(),
    carbsG: grams.optional(),
    fatG: grams.optional(),
    kcal: grams.optional(),
    mode: z.enum(TOLERANCE_MODES).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 1, "at least one field");
type ToleranceSetPayload = z.output<typeof ToleranceSet>;

/** AGT-5, FBK-8: a tolerance change is protected when any band widens or strict becomes flexible. */
export async function toleranceLoosens(p: ToleranceSetPayload, tx: ChangeTx): Promise<boolean> {
  const current = await tx.get("tolerance", { memberId: p.memberId });
  const base = current ?? { ...DEFAULT_TOLERANCE };
  const wider = (next: number | undefined, now: number) => next !== undefined && next > now;
  return (
    wider(p.proteinG, base.proteinG) ||
    wider(p.carbsG, base.carbsG) ||
    wider(p.fatG, base.fatG) ||
    wider(p.kcal, base.kcal) ||
    (p.mode === "flexible" && base.mode === "strict")
  );
}

export const toleranceSet = defineOp({
  kind: "tolerance.set",
  area: "targets",
  schema: ToleranceSet,
  protected: toleranceLoosens,
  title: () => "Change per-meal tolerance",
  apply: async (tx, { memberId, ...fields }) => {
    await requireMember("tolerance.set", tx, memberId);
    const current = await tx.get("tolerance", { memberId });
    if (current === null) {
      await tx.insert("tolerance", {
        memberId,
        householdId: tx.householdId,
        ...DEFAULT_TOLERANCE,
        ...definedFields(fields),
      });
    } else {
      await tx.update("tolerance", { memberId }, definedFields(fields));
    }
  },
});

/** Replaces a member's weekly training schedule (PRD-7, 02 §2). */
export const trainingSet = defineOp({
  kind: "training.set",
  area: "schedule",
  schema: z
    .object({
      memberId: id,
      days: z.array(
        z
          .object({
            weekday,
            sessionTime: time.nullable().default(null),
            intensity: z.enum(TRAINING_INTENSITIES).nullable().default(null),
          })
          .strict(),
      ),
    })
    .strict()
    .refine(
      (p) => new Set(p.days.map((d) => d.weekday)).size === p.days.length,
      "duplicate weekday",
    ),
  title: (p) =>
    p.days.length === 0 ? "Clear training days" : `Set ${String(p.days.length)} training day(s)`,
  apply: async (tx, { memberId, days }) => {
    await requireMember("training.set", tx, memberId);
    const existing = await tx.find("training_schedule", { memberId });
    const wanted = new Map(days.map((d) => [d.weekday, d]));
    for (const row of existing) {
      if (!wanted.has(row.weekday))
        await tx.remove("training_schedule", { memberId, weekday: row.weekday });
    }
    for (const day of days) {
      const row = existing.find((r) => r.weekday === day.weekday);
      if (row === undefined) {
        await tx.insert("training_schedule", { householdId: tx.householdId, memberId, ...day });
      } else if (row.sessionTime !== day.sessionTime || row.intensity !== day.intensity) {
        await tx.update(
          "training_schedule",
          { memberId, weekday: day.weekday },
          { sessionTime: day.sessionTime, intensity: day.intensity },
        );
      }
    }
  },
});

/** Adds (`active: true`) or removes a one-off exception for one date (02 §2 day_override). */
export const dayOverrideSet = defineOp({
  kind: "day_override.set",
  area: "schedule",
  schema: z
    .object({
      memberId: id,
      date: isoDate,
      kind: z.enum(DAY_OVERRIDE_KINDS),
      slotTypeId: id.nullable().default(null),
      active: z.boolean(),
    })
    .strict()
    .refine(
      (p) => (p.kind === "absent_slot" || p.kind === "extra_slot") === (p.slotTypeId !== null),
      "absent_slot and extra_slot need a slot; training and rest must not have one",
    ),
  title: (p) => `${p.active ? "Add" : "Remove"} ${p.kind.replace("_", " ")} on ${p.date}`,
  apply: async (tx, { memberId, date, kind, slotTypeId, active }) => {
    await requireMember("day_override.set", tx, memberId);
    if (slotTypeId !== null)
      await requireRow(
        "day_override.set",
        `slot ${slotTypeId}`,
        tx.get("slot_type", { id: slotTypeId }),
      );
    const [existing] = await tx.find("day_override", { memberId, date, kind, slotTypeId });
    if (active && existing === undefined) {
      if (kind === "training" || kind === "rest") {
        const opposite = await tx.find("day_override", {
          memberId,
          date,
          kind: kind === "training" ? "rest" : "training",
        });
        for (const row of opposite) await tx.remove("day_override", { id: row.id });
      }
      await tx.insert("day_override", {
        id: tx.newId(),
        householdId: tx.householdId,
        memberId,
        date,
        kind,
        slotTypeId,
      });
    } else if (!active) {
      if (existing === undefined)
        throw new ChangeOpError("day_override.set", "no such override to remove");
      await tx.remove("day_override", { id: existing.id });
    }
  },
});

/**
 * FBK-5 learned role bias for an untargeted member (BLD-8 R-24): written by the learning pipeline
 * as a `learning` change set; `bias: null` resets the role to 1.0 (row removed). Targeted members'
 * grams are fixed by their targets, so their quantity feedback never reaches this op.
 */
export const portionBiasSet = defineOp({
  kind: "portion_bias.set",
  area: "taste",
  schema: z
    .object({
      memberId: id,
      componentRole: z.enum(COMPONENT_ROLES),
      bias: z.number().min(PORTION_BIAS_BOUNDS.min).max(PORTION_BIAS_BOUNDS.max).nullable(),
    })
    .strict(),
  title: (p) =>
    p.bias === null
      ? `Reset ${p.componentRole} portion bias`
      : `Set ${p.componentRole} portion bias to ${p.bias.toFixed(2)}`,
  apply: async (tx, { memberId, componentRole, bias }) => {
    const member = await requireMember("portion_bias.set", tx, memberId);
    if (member.isTargeted)
      throw new ChangeOpError(
        "portion_bias.set",
        "targeted members' portions are fixed by their targets (FBK-5)",
      );
    const key = { memberId, componentRole };
    const existing = await tx.get("portion_bias", key);
    if (bias === null) {
      if (existing === null) throw new ChangeOpError("portion_bias.set", "no bias to reset");
      await tx.remove("portion_bias", key);
    } else if (existing === null) {
      await tx.insert("portion_bias", { householdId: tx.householdId, ...key, bias });
    } else {
      await tx.update("portion_bias", key, { bias });
    }
  },
});
