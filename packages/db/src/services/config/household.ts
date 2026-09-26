// Household creation (ARC-6 "signing up creates a user and a household; the user becomes admin").
// The household row and the admin's login are created by the sign-up flow itself; the default
// configuration (PLN-2 slots, 02 §6 planning weights) is applied as one undoable change set (DM-6).
import {
  DEFAULT_PLANNING_WEIGHTS,
  DEFAULT_SLOTS,
  type HouseholdContext,
} from "@mealplanner/core/types";
import type { ChangeOp } from "@mealplanner/core/changes";
import type { Executor } from "../../repos/index.js";
import { household, householdUser } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";
import { applyChangeSet } from "../changes/index.js";

export interface CreateHouseholdInput {
  name: string;
  /** The signing-up user (already created by the auth library). */
  adminUserId: string;
  regionNote?: string;
  id?: string;
}

export interface CreatedHousehold {
  householdId: string;
  setupChangeSetId: string;
  /** Default slot ids by key. */
  slotIds: Record<string, string>;
}

/** The default configuration of a new household, as change ops. */
export function defaultSetupOps(): { ops: ChangeOp[]; slotIds: Record<string, string> } {
  const slotIds: Record<string, string> = {};
  const ops: ChangeOp[] = DEFAULT_SLOTS.map((slot) => {
    const id = newId();
    slotIds[slot.key] = id;
    // The PLN-2 share weight is not stored on the slot; the target resolver reads it by key.
    return {
      kind: "slot.create",
      payload: {
        id,
        key: slot.key,
        label: slot.label,
        emoji: slot.emoji,
        sortOrder: slot.sortOrder,
        defaultTime: slot.defaultTime,
        isShared: slot.isShared,
        isPacked: slot.isPacked,
        reheatAvailable: slot.reheatAvailable,
        isTrainingSlot: slot.isTrainingSlot,
        constraintsNote: null,
        active: slot.active,
      },
    };
  });
  ops.push({ kind: "weights.set", payload: { ...DEFAULT_PLANNING_WEIGHTS } });
  return { ops, slotIds };
}

export async function createHousehold(
  db: Executor,
  input: CreateHouseholdInput,
): Promise<CreatedHousehold> {
  return db.transaction(async (trx) => {
    const householdId = input.id ?? newId();
    const now = new Date();
    await trx.insert(household).values({
      id: householdId,
      name: input.name,
      regionNote: input.regionNote ?? null,
      createdAt: now,
    });
    await trx.insert(householdUser).values({
      householdId,
      userId: input.adminUserId,
      role: "admin",
      status: "active",
      memberId: null,
      createdAt: now,
    });
    const ctx: HouseholdContext = { householdId, userId: input.adminUserId, role: "admin" };
    const { ops, slotIds } = defaultSetupOps();
    const setup = await applyChangeSet(trx, ctx, {
      actor: "system",
      source: "ui",
      summary: "Household setup",
      ops,
    });
    return { householdId, setupChangeSetId: setup.changeSetId, slotIds };
  });
}
