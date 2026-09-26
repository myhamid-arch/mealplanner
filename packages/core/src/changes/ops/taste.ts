// preference.set, preference.reset, exclusion.add, exclusion.remove*, frequency.set (AGT-6,
// 02 §6, FBK-4, FBK-6, DM-5).
import { z } from "zod";
import {
  EXCLUSION_KINDS,
  EXCLUSION_REASONS,
  FREQUENCY_ENTITY_TYPES,
  PREFERENCE_ENTITY_TYPES,
  PREFERENCE_HARDNESS,
  PREFERENCE_SOURCES,
  type ExclusionRow,
} from "../../types/index.js";
import { defineOp, requireRow } from "../define.js";
import { ChangeOpError, type ChangeTx } from "../tx.js";
import { id } from "./common.js";

const entityKey = z.string().trim().min(1).max(200);

async function requireMemberOrHousehold(kind: string, tx: ChangeTx, memberId: string | null) {
  if (memberId !== null)
    await requireRow(kind, `member ${memberId}`, tx.get("member", { id: memberId }));
}

export const preferenceSet = defineOp({
  kind: "preference.set",
  area: "taste",
  schema: z
    .object({
      memberId: id.nullable(),
      entityType: z.enum(PREFERENCE_ENTITY_TYPES),
      entityKey,
      score: z.number().min(-1).max(1),
      source: z.enum(PREFERENCE_SOURCES).default("explicit"),
      evidenceWeight: z.number().nonnegative().optional(),
      locked: z.boolean().optional(),
      hard: z.enum(PREFERENCE_HARDNESS).optional(),
    })
    .strict(),
  title: (p) => `Set ${p.entityType} preference "${p.entityKey}" to ${p.score.toFixed(2)}`,
  apply: async (
    tx,
    { memberId, entityType, entityKey: key, score, source, evidenceWeight, locked, hard },
  ) => {
    await requireMemberOrHousehold("preference.set", tx, memberId);
    const [existing] = await tx.find("preference", {
      memberId,
      entityType,
      entityKey: key,
      source,
    });
    if (existing === undefined) {
      await tx.insert("preference", {
        id: tx.newId(),
        householdId: tx.householdId,
        memberId,
        entityType,
        entityKey: key,
        score,
        evidenceWeight: evidenceWeight ?? 0,
        source,
        locked: locked ?? false,
        hard: hard ?? "none",
        updatedAt: tx.now(),
      });
    } else {
      if (existing.locked && source === "learned" && locked !== false)
        throw new ChangeOpError(
          "preference.set",
          "locked preferences are never changed by learning (FBK-4)",
        );
      await tx.update(
        "preference",
        { id: existing.id },
        {
          score,
          updatedAt: tx.now(),
          ...(evidenceWeight === undefined ? {} : { evidenceWeight }),
          ...(locked === undefined ? {} : { locked }),
          ...(hard === undefined ? {} : { hard }),
        },
      );
    }
  },
});

/** Deletes the preference rows for one key (one source, or all sources), back to automatic. */
export const preferenceReset = defineOp({
  kind: "preference.reset",
  area: "taste",
  schema: z
    .object({
      memberId: id.nullable(),
      entityType: z.enum(PREFERENCE_ENTITY_TYPES),
      entityKey,
      source: z.enum(PREFERENCE_SOURCES).optional(),
    })
    .strict(),
  title: (p) => `Reset ${p.entityType} preference "${p.entityKey}"`,
  apply: async (tx, { memberId, entityType, entityKey: key, source }) => {
    await requireMemberOrHousehold("preference.reset", tx, memberId);
    const rows = await tx.find("preference", {
      memberId,
      entityType,
      entityKey: key,
      ...(source === undefined ? {} : { source }),
    });
    if (rows.length === 0) throw new ChangeOpError("preference.reset", "no preference to reset");
    for (const row of rows) await tx.remove("preference", { id: row.id });
  },
});

/** SPEC-Q-7: allergies, and hard medical or religious rules, are protected against relaxing. */
function isProtectedExclusion(row: Pick<ExclusionRow, "reason" | "hard">): boolean {
  return (
    row.reason === "allergy" ||
    (row.hard && (row.reason === "medical" || row.reason === "religious"))
  );
}

const ExclusionAdd = z
  .object({
    memberId: id.nullable(),
    kind: z.enum(EXCLUSION_KINDS),
    key: z.string().trim().min(1).max(120),
    reason: z.enum(EXCLUSION_REASONS),
    hard: z.boolean().default(true),
  })
  .strict()
  .refine((p) => p.reason !== "allergy" || p.hard, "an allergy exclusion is always hard (DM-5)");

/**
 * Adds an exclusion, or changes the reason/hardness of an existing one for the same key.
 * Protected when that change relaxes a protected exclusion (AGT-5).
 */
export const exclusionAdd = defineOp({
  kind: "exclusion.add",
  area: "taste",
  schema: ExclusionAdd,
  protected: async (p, tx) => {
    const [existing] = await tx.find("exclusion", {
      memberId: p.memberId,
      kind: p.kind,
      key: p.key,
    });
    return existing !== undefined && isProtectedExclusion(existing) && !isProtectedExclusion(p);
  },
  title: (p) => `Exclude ${p.kind.replace("_", " ")} "${p.key}" (${p.reason})`,
  apply: async (tx, { memberId, kind, key, reason, hard }) => {
    await requireMemberOrHousehold("exclusion.add", tx, memberId);
    const [existing] = await tx.find("exclusion", { memberId, kind, key });
    if (existing === undefined) {
      await tx.insert("exclusion", {
        id: tx.newId(),
        householdId: tx.householdId,
        memberId,
        kind,
        key,
        reason,
        hard,
      });
    } else if (existing.reason !== reason || existing.hard !== hard) {
      await tx.update("exclusion", { id: existing.id }, { reason, hard });
    }
  },
});

export const exclusionRemove = defineOp({
  kind: "exclusion.remove",
  area: "taste",
  schema: z.object({ exclusionId: id }).strict(),
  protected: async (p, tx) => {
    const row = await tx.get("exclusion", { id: p.exclusionId });
    return row !== null && isProtectedExclusion(row);
  },
  title: () => "Remove exclusion",
  apply: async (tx, { exclusionId }) => {
    await requireRow(
      "exclusion.remove",
      `exclusion ${exclusionId}`,
      tx.get("exclusion", { id: exclusionId }),
    );
    await tx.remove("exclusion", { id: exclusionId });
  },
});

/** FBK-6: sets frequency limits for one entity; both limits null removes the rule. */
export const frequencySet = defineOp({
  kind: "frequency.set",
  area: "taste",
  schema: z
    .object({
      memberId: id.nullable(),
      entityType: z.enum(FREQUENCY_ENTITY_TYPES),
      entityKey,
      minGapDays: z.number().int().min(1).max(365).nullable(),
      maxPerWeek: z.number().int().min(0).max(21).nullable(),
      source: z.enum(PREFERENCE_SOURCES).default("explicit"),
      locked: z.boolean().default(false),
    })
    .strict(),
  title: (p) =>
    p.minGapDays === null && p.maxPerWeek === null
      ? `Remove frequency rule for "${p.entityKey}"`
      : `Set frequency rule for "${p.entityKey}"`,
  apply: async (
    tx,
    { memberId, entityType, entityKey: key, minGapDays, maxPerWeek, source, locked },
  ) => {
    await requireMemberOrHousehold("frequency.set", tx, memberId);
    const [existing] = await tx.find("frequency_rule", { memberId, entityType, entityKey: key });
    if (minGapDays === null && maxPerWeek === null) {
      if (existing === undefined) throw new ChangeOpError("frequency.set", "no rule to remove");
      await tx.remove("frequency_rule", { id: existing.id });
    } else if (existing === undefined) {
      await tx.insert("frequency_rule", {
        id: tx.newId(),
        householdId: tx.householdId,
        memberId,
        entityType,
        entityKey: key,
        minGapDays,
        maxPerWeek,
        source,
        locked,
      });
    } else {
      if (existing.locked && source === "learned")
        throw new ChangeOpError("frequency.set", "locked rules are never changed by learning");
      await tx.update(
        "frequency_rule",
        { id: existing.id },
        { minGapDays, maxPerWeek, source, locked },
      );
    }
  },
});
