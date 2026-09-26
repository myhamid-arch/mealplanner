// applyChangeSet: the only write path for configuration, preferences, recipes and plans (DM-6,
// ARC-4). Validates every op, enforces AGT-5 for agent_apply, applies the ops through ChangeTx in
// one transaction, checks invariants, and stores forward and inverse ops (ADR-3).
import { desc, eq } from "drizzle-orm";
import {
  ChangeOpSchema,
  getOp,
  isProtected,
  type ChangeDescription,
  type ChangeOpKind,
  type ParsedChangeOp,
} from "@mealplanner/core/changes";
import type { ChangeActor, ChangeSource, HouseholdContext, Json } from "@mealplanner/core/types";
import type { Executor } from "../../repos/index.js";
import { changeSet, household } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";
import { ChangeValidationError, ProtectedOperationError } from "./errors.js";
import { assertHasActiveAdmin } from "./invariants.js";
import { DbChangeTx } from "./tx.js";

export interface ApplyChangeSetInput {
  actor: ChangeActor;
  source: ChangeSource;
  summary: string;
  /** Public ops `{ kind, payload }`, validated here with ChangeOpSchema. */
  ops: readonly unknown[];
}

export interface AppliedChangeSet {
  changeSetId: string;
  appliedAt: Date;
  /** One description per op: title and field-level before → after diff (AGT-7 cards). */
  descriptions: ChangeDescription[];
}

export class HouseholdNotFoundError extends Error {
  constructor(readonly householdId: string) {
    super(`household ${householdId} not found`);
    this.name = "HouseholdNotFoundError";
  }
}

/** Parses public ops; `rows.restore` and unknown kinds are rejected. */
export function parseOps(ops: readonly unknown[]): ParsedChangeOp[] {
  return ops.map((op, index) => {
    const result = ChangeOpSchema.safeParse(op);
    if (!result.success)
      throw new ChangeValidationError(
        index,
        result.error.issues.map((i) => ({ path: i.path, message: i.message })),
      );
    return result.data;
  });
}

/**
 * Opens the household's change-set transaction: locks the household row (change sets of one
 * household are serialised) and picks a timestamp strictly after the household's last change set.
 */
export async function inHouseholdTransaction<T>(
  db: Executor,
  ctx: HouseholdContext,
  work: (trx: Executor, timestamp: Date) => Promise<T>,
): Promise<T> {
  return db.transaction(async (trx) => {
    const [locked] = await trx
      .select({ id: household.id })
      .from(household)
      .where(eq(household.id, ctx.householdId))
      .for("update");
    if (locked === undefined) throw new HouseholdNotFoundError(ctx.householdId);
    const [last] = await trx
      .select({ appliedAt: changeSet.appliedAt })
      .from(changeSet)
      .where(eq(changeSet.householdId, ctx.householdId))
      .orderBy(desc(changeSet.appliedAt))
      .limit(1);
    const now = Date.now();
    const timestamp = new Date(
      last === undefined ? now : Math.max(now, last.appliedAt.getTime() + 1),
    );
    return work(trx, timestamp);
  });
}

/** Applies parsed ops through a ChangeTx and returns the per-op descriptions and inverse ops. */
export async function runOps(tx: DbChangeTx, ops: readonly ParsedChangeOp[], internal = false) {
  const descriptions: ChangeDescription[] = [];
  const inverses: { kind: string; payload: unknown }[][] = [];
  for (const op of ops) {
    const def = getOp(op.kind, { internal });
    if (def === undefined) throw new Error(`unknown op kind ${op.kind}`);
    const start = tx.images.length;
    await def.apply(tx, op.payload);
    const before = tx.images.slice(start);
    const after = await tx.imagesOf(before);
    descriptions.push(def.describe(op.payload, { before, after }));
    inverses.push(def.inverse(before, op.payload));
  }
  // Undo runs the ops' inverses last-op-first.
  const inverse = inverses.reverse().flat();
  return { descriptions, inverse };
}

export async function insertChangeSet(
  trx: Executor,
  ctx: HouseholdContext,
  values: {
    id: string;
    actor: ChangeActor;
    source: ChangeSource;
    summary: string;
    forward: readonly unknown[];
    inverse: readonly unknown[];
    appliedAt: Date;
  },
): Promise<void> {
  await trx.insert(changeSet).values({
    id: values.id,
    householdId: ctx.householdId,
    actor: values.actor,
    actorUserId: ctx.userId,
    source: values.source,
    summary: values.summary,
    forward: values.forward as Json,
    inverse: values.inverse as Json,
    appliedAt: values.appliedAt,
    undoneAt: null,
    undoneByChangeSetId: null,
  });
}

async function refuseForAgent(tx: DbChangeTx, ops: readonly ParsedChangeOp[]): Promise<void> {
  const row = await tx.get("household", { id: tx.householdId });
  const opKinds = ops.map((op) => op.kind);
  if (row !== null && !row.agentMayApply)
    throw new ProtectedOperationError("agent_may_apply_off", opKinds);
  const flagged: ChangeOpKind[] = [];
  for (const op of ops) if (await isProtected(op, tx)) flagged.push(op.kind);
  if (flagged.length > 0) throw new ProtectedOperationError("protected", flagged);
}

export async function applyChangeSet(
  db: Executor,
  ctx: HouseholdContext,
  input: ApplyChangeSetInput,
): Promise<AppliedChangeSet> {
  const ops = parseOps(input.ops);
  if (ops.length === 0) throw new Error("a change set needs at least one op");
  if (input.summary.trim() === "") throw new Error("a change set needs a summary");
  // AGT-1: user and agent changes are made with a login's authority; only system jobs have none.
  if (input.actor !== "system" && ctx.userId === null)
    throw new Error(
      `a change set by ${input.actor} needs the acting user in the household context`,
    );
  return inHouseholdTransaction(db, ctx, async (trx, timestamp) => {
    const tx = new DbChangeTx(trx, ctx, timestamp);
    // AGT-5: enforced on the server, before anything is written.
    if (input.source === "agent_apply") await refuseForAgent(tx, ops);
    const { descriptions, inverse } = await runOps(tx, ops);
    await assertHasActiveAdmin(trx, ctx.householdId);
    const changeSetId = newId();
    await insertChangeSet(trx, ctx, {
      id: changeSetId,
      actor: input.actor,
      source: input.source,
      summary: input.summary,
      forward: ops,
      inverse,
      appliedAt: timestamp,
    });
    return { changeSetId, appliedAt: timestamp, descriptions };
  });
}

class PreviewRollback extends Error {
  constructor(readonly descriptions: ChangeDescription[]) {
    super("preview rollback");
  }
}

/**
 * Describes what ops would change without keeping the change: they run in a transaction that is
 * rolled back (for proposal cards, AGT-7). Validation and op preconditions apply as in a real run.
 */
export async function previewChangeSet(
  db: Executor,
  ctx: HouseholdContext,
  rawOps: readonly unknown[],
): Promise<ChangeDescription[]> {
  const ops = parseOps(rawOps);
  try {
    await inHouseholdTransaction(db, ctx, async (trx, timestamp) => {
      const { descriptions } = await runOps(new DbChangeTx(trx, ctx, timestamp), ops);
      throw new PreviewRollback(descriptions);
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.descriptions;
    throw error;
  }
  throw new Error("unreachable");
}
