// `household.purge` (R2-ADM-6; leaf-1.4.1 SPEC-Q-16): deletes every household whose deletion was
// confirmed more than 14 days ago, with all its rows, in one transaction per household. Logins go
// with it; users left without any household lose their sessions. `mealplanner.purge` lets the
// transaction delete finished job rows (migration 0004's trigger).
import { and, isNotNull, lt, sql } from "drizzle-orm";
import { household } from "@mealplanner/db/schema";
import type { WorkerRuntime } from "../runtime.js";

export const GRACE_MS = 14 * 86_400_000;

/** Household tables in foreign-key order (children first); each has `household_id` (R-8). */
const TABLES = [
  "support_access",
  "job_event",
  "job",
  "review_revision",
  "review_reaction",
  "review",
  "proposal",
  "chat_message",
  "conversation",
  "cook_batch",
  "plate_item",
  "plate",
  "plan_meal",
  "plan_day",
  "meal_override",
  "kg_edge",
  "kg_node",
  "dish_nutrition_cache",
  "variant_ingredient",
  "variant",
  "component",
  "household_adjuster",
  "dish",
  "ai_generation",
  "preference",
  "frequency_rule",
  "exclusion",
  "portion_bias",
  "slot_target_override",
  "meal_distribution",
  "day_override",
  "training_schedule",
  "member_slot_schedule",
  "tolerance",
  "target_profile",
  "detail_level",
  "planning_weights",
  "weight_preset",
  "invite",
  "support_grant",
  "household_user",
  "slot_type",
  "member",
  "change_set",
] as const;

export async function purgeHousehold(rt: WorkerRuntime, householdId: string): Promise<void> {
  await rt.db.transaction(async (trx) => {
    await trx.execute(sql`SELECT set_config('mealplanner.purge', 'on', true)`);
    const logins = await trx.execute<{ user_id: string }>(
      sql`SELECT user_id FROM household_user WHERE household_id = ${householdId}`,
    );
    await trx.execute(
      sql`UPDATE review SET parent_review_id = NULL WHERE household_id = ${householdId}`,
    );
    await trx.execute(
      sql`UPDATE change_set SET undone_by_change_set_id = NULL WHERE household_id = ${householdId}`,
    );
    for (const table of TABLES)
      await trx.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE household_id = ${householdId}`,
      );
    await trx.execute(sql`DELETE FROM ingredient WHERE created_by_household_id = ${householdId}`);
    await trx.execute(sql`DELETE FROM household WHERE id = ${householdId}`);
    for (const { user_id } of logins.rows)
      await trx.execute(
        sql`DELETE FROM session WHERE user_id = ${user_id} AND NOT EXISTS (SELECT 1 FROM household_user WHERE user_id = ${user_id})`,
      );
  });
}

export async function purgeDueHouseholds(rt: WorkerRuntime, now = new Date()): Promise<string[]> {
  const due = await rt.db
    .select({ id: household.id })
    .from(household)
    .where(
      and(
        isNotNull(household.deletionConfirmedAt),
        lt(household.deletionConfirmedAt, new Date(now.getTime() - GRACE_MS)),
      ),
    );
  // Each household on its own: one that fails does not keep the others past their grace.
  const purged: string[] = [];
  const failed: string[] = [];
  for (const { id } of due)
    try {
      await purgeHousehold(rt, id);
      purged.push(id);
    } catch (error) {
      rt.log.error({ err: error, householdId: id }, "household purge failed");
      failed.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  if (failed.length > 0)
    throw new Error(`purged ${String(purged.length)} household(s); failed: ${failed.join("; ")}`);
  return purged;
}
