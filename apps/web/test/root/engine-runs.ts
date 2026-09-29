// The engine's runs on the compose stack (SC-1, SC-2): node-1.2 N3's inputs (F1's week, the given
// seed, `weights.set` {ingredientEconomy, aiGeneration: "off"}), queued through the API
// (`POST /change-sets`, `POST /plans/generate`) and run by the stack's own worker container.
import type pg from "pg";
import { F1_WEEK } from "../../../../packages/core/dist/test/planner/targets/config.js";
import { readPlan, type Flag, type StoredMeal } from "../node/engine-measure";
import { buildF1, type F1Household } from "./f1-api";
import { jobResult } from "./stack";

export { F1_WEEK };
/** node-1.2 N3's economy weight for SC-1 and SC-2's economy runs (engine.node.ts `ECONOMY`). */
export const ECONOMY = 0.4;

export interface QueuedRun {
  seed: number;
  economy: number;
  f1: F1Household;
  jobId: string;
  queuedAt: number;
}

export interface Run extends QueuedRun {
  flags: Flag[];
  seconds: number;
}

/**
 * A fresh API-built F1 household, its weights set, and F1's week queued at `seed`. `checkF1` runs
 * on the household as built, before the run changes its weights.
 */
export async function queueRun(
  tag: string,
  seed: number,
  economy: number,
  checkF1: (f1: F1Household) => Promise<void>,
): Promise<QueuedRun> {
  const f1 = await buildF1(tag);
  await checkF1(f1);
  const weights = await f1.adminApi("POST", "/change-sets", {
    summary: `root weights (economy ${String(economy)})`,
    ops: [{ kind: "weights.set", payload: { ingredientEconomy: economy, aiGeneration: "off" } }],
  });
  if (weights.status !== 201) throw new Error(`weights.set: ${JSON.stringify(weights.json)}`);
  const generate = await f1.adminApi("POST", "/plans/generate", { dates: F1_WEEK, seed });
  if (generate.status !== 202) throw new Error(`plans/generate: ${JSON.stringify(generate.json)}`);
  return {
    seed,
    economy,
    f1,
    jobId: (generate.json as { jobId: string }).jobId,
    queuedAt: Date.now(),
  };
}

export async function finishRun(db: pg.Pool, q: QueuedRun): Promise<Run> {
  const result = await jobResult(db, q.jobId, 10_800_000);
  return {
    ...q,
    flags: result.flags as Flag[],
    seconds: Math.round((Date.now() - q.queuedAt) / 1000),
  };
}

/**
 * A persisted plan by natural keys (member name, slot key, date; library dish, component and
 * variant ids are the same in every household), for comparing two households' plans.
 */
export function canonicalPlan(meals: readonly StoredMeal[], members: Record<string, string>) {
  const names = new Map(Object.entries(members).map(([key, id]) => [id, key]));
  const who = (id: string) => names.get(id) ?? `unknown:${id}`;
  return meals
    .map((m) => ({
      date: m.date,
      slot: m.slotKey,
      scope: m.memberScope === "shared" ? "shared" : who(m.memberScope),
      dish: m.dishId,
      attendees: [...m.attendees].map(who).sort(),
      plates: m.plates
        .map((p) => ({
          member: who(p.memberId),
          fit: p.fitStatus,
          items: p.items
            .map((i) => `${i.componentId}/${i.variantId}/${i.cookedG.toFixed(3)}`)
            .sort(),
        }))
        .sort((a, b) => a.member.localeCompare(b.member)),
    }))
    .sort((a, b) =>
      `${a.date}|${a.slot}|${a.scope}`.localeCompare(`${b.date}|${b.slot}|${b.scope}`),
    );
}

export async function planOf(db: pg.Pool, run: Run) {
  return canonicalPlan(await readPlan(db, run.f1.householdId, F1_WEEK), run.f1.members);
}
