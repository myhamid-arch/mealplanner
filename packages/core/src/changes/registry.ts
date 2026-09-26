// The single change-op registry (AGT-6). UI forms, proposals, insights and the agent all use it;
// there is no other write path (DM-6). `rows.restore` is internal: it is the inverse of every op
// (BLD-8 R-7) and is not part of the public ChangeOpSchema.
import { z } from "zod";
import { RestorePayloadSchema, type ChangeArea, type OpDef } from "./define.js";
import type { ChangeTx } from "./tx.js";
import {
  accessBlock,
  accessLinkMember,
  accessRemove,
  accessUnblock,
  roleSet,
  supportGrant,
  supportRevoke,
} from "./ops/access.js";
import { householdUpdate } from "./ops/household.js";
import {
  dayOverrideSet,
  memberArchive,
  memberCreate,
  memberUpdate,
  targetSet,
  toleranceSet,
  trainingSet,
} from "./ops/members.js";
import { adjustersSet, presetDelete, presetUpsert, weightsSet } from "./ops/planning.js";
import {
  mealOverrideRemove,
  mealOverrideSet,
  planLock,
  planSaveDays,
  planSwapDish,
  planUnlock,
  plateOverride,
} from "./ops/plans.js";
import {
  dishCreate,
  dishRetire,
  dishUpdate,
  ingredientCreate,
  ingredientVerify,
} from "./ops/recipes.js";
import {
  distributionSet,
  slotCreate,
  slotScheduleSet,
  slotTargetSet,
  slotUpdate,
} from "./ops/slots.js";
import {
  exclusionAdd,
  exclusionRemove,
  frequencySet,
  preferenceReset,
  preferenceSet,
} from "./ops/taste.js";

/** Every public op: the AGT-6 v1 list plus the BLD-8 R-10 additions, in the spec's order. */
export const PUBLIC_OPS = [
  householdUpdate,
  memberCreate,
  memberUpdate,
  memberArchive,
  targetSet,
  toleranceSet,
  trainingSet,
  dayOverrideSet,
  slotCreate,
  slotUpdate,
  slotScheduleSet,
  distributionSet,
  slotTargetSet,
  weightsSet,
  presetUpsert,
  presetDelete,
  preferenceSet,
  preferenceReset,
  exclusionAdd,
  exclusionRemove,
  frequencySet,
  adjustersSet,
  dishCreate,
  dishUpdate,
  dishRetire,
  ingredientCreate,
  ingredientVerify,
  planLock,
  planUnlock,
  planSwapDish,
  plateOverride,
  roleSet,
  // BLD-8 R-10
  accessBlock,
  accessUnblock,
  accessRemove,
  accessLinkMember,
  mealOverrideSet,
  mealOverrideRemove,
  supportGrant,
  supportRevoke,
  planSaveDays,
] as const;

type PublicOp = (typeof PUBLIC_OPS)[number];
export type ChangeOpKind = PublicOp["kind"];

/** A public change op as sent by forms, proposals, insights and the agent. */
export type ChangeOp = {
  [O in PublicOp as O["kind"]]: { kind: O["kind"]; payload: z.input<O["schema"]> };
}[ChangeOpKind];

/** The same op after schema parsing (defaults filled in). */
export type ParsedChangeOp = {
  [O in PublicOp as O["kind"]]: { kind: O["kind"]; payload: z.output<O["schema"]> };
}[ChangeOpKind];

/** The internal inverse op (BLD-8 R-7). */
export const rowsRestore: OpDef<"rows.restore", z.output<typeof RestorePayloadSchema>> = {
  kind: "rows.restore",
  area: "household",
  schema: RestorePayloadSchema,
  protected: false,
  public: false,
  title: (p) => `Restore ${String(p.images.length)} row(s)`,
  describe: (p) => ({
    kind: "rows.restore",
    area: "household",
    title: `Restore ${String(p.images.length)} row(s)`,
    changes: [],
  }),
  apply: async (tx, p) => {
    // Later writes are undone first, so a row written twice ends at its first before-image.
    for (const image of [...p.images].reverse()) await tx.restore(image);
  },
  inverse: (stateBefore) => [{ kind: "rows.restore", payload: { images: stateBefore } }],
};

const byKind = new Map<string, OpDef>(
  (PUBLIC_OPS as unknown as readonly OpDef[]).map((op) => [op.kind, op]),
);

/** Public ops by kind. */
export const registry: ReadonlyMap<string, OpDef> = byKind;

/** The op definition for a public kind, or `rows.restore` only when `internal` is set. */
export function getOp(kind: string, options: { internal?: boolean } = {}): OpDef | undefined {
  if (kind === rowsRestore.kind)
    return options.internal === true ? (rowsRestore as OpDef) : undefined;
  return byKind.get(kind);
}

/** Zod schema of one public op, `{ kind, payload }`. `rows.restore` is rejected. */
export const ChangeOpSchema = z.discriminatedUnion(
  "kind",
  PUBLIC_OPS.map((op) =>
    z.object({ kind: z.literal(op.kind), payload: op.schema }).strict(),
  ) as unknown as [
    z.ZodObject<{ kind: z.ZodLiteral<string>; payload: z.ZodType }>,
    ...z.ZodObject<{ kind: z.ZodLiteral<string>; payload: z.ZodType }>[],
  ],
) as unknown as z.ZodType<ParsedChangeOp, ChangeOp>;

/** AGT-5: whether an op must become a proposal when the agent applies it. */
export async function isProtected(op: ParsedChangeOp, tx: ChangeTx): Promise<boolean> {
  const def = getOp(op.kind);
  if (def === undefined) throw new Error(`unknown op kind ${op.kind}`);
  return typeof def.protected === "function" ? def.protected(op.payload, tx) : def.protected;
}

/** The change-log area of an op kind (R2-ADM-7). */
export function areaOf(kind: string): ChangeArea | undefined {
  return getOp(kind, { internal: true })?.area;
}
