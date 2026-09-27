// `recipe.draft` (REC-6; R-46): the agent's `create_recipe`. Runs the recipe generator through the
// worker's one set of database ports (`generateDishes`, ai.ts) with the admin's request and
// `save: false`: the survivors are drafts for the chat's recipe card (Save applies `dish.create`
// through POST /change-sets; 1.4.5). The completion post puts the card into the conversation.
import { GenerationContextError, buildGenerationContext } from "@mealplanner/ai/recipes";
import type { HouseholdConfig } from "@mealplanner/core/types";
import { loadHouseholdConfig } from "@mealplanner/db/services/config";
import {
  generatedDishOps,
  householdDishSlugs,
  loadPlanPool,
  type ChangeActorInput,
} from "@mealplanner/db/services/plans";
import { localDate } from "@mealplanner/db/services/proposals";
import { generateDishes } from "../ai.js";
import { toJson, type JobHandler } from "../runner.js";

const SYSTEM: ChangeActorInput = { actor: "system", source: "learning" };

export interface RecipeDraftPayload {
  conversationId: string;
  request: string;
  slot: string | null;
  /** 1.4.9 (R-61, R-66): the day the admin named; absent in jobs queued before it existed. */
  date?: string | null;
  count: number;
}

/** The slot to write for: the one asked for, else dinner, else the first active shared slot. */
export function draftSlot(config: HouseholdConfig, asked: string | null): string {
  const active = config.slotTypes.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  if (asked !== null) {
    const found = active.find(
      (s) => s.key === asked || s.label.toLowerCase() === asked.toLowerCase(),
    );
    if (found === undefined)
      throw new Error(
        `there is no active slot "${asked}" (${active.map((s) => s.key).join(", ")})`,
      );
    return found.key;
  }
  const pick =
    active.find((s) => s.key === "dinner") ?? active.find((s) => s.isShared) ?? active[0];
  if (pick === undefined) throw new Error("the household has no active slot");
  return pick.key;
}

/** The days searched for someone attending the slot (a school lunch asked for on a Saturday). */
export const DRAFT_DAYS = 7;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today, or the next day within a week on which someone attends the slot. */
export function draftDate(
  config: HouseholdConfig,
  slotKey: string,
  count: number,
  today: string,
): string {
  for (let d = 0; d < DRAFT_DAYS; d += 1) {
    const date = addDays(today, d);
    try {
      buildGenerationContext({ config, date, slotKey, count });
      return date;
    } catch (error) {
      if (!(error instanceof GenerationContextError)) throw error;
    }
  }
  throw new Error(`nobody attends "${slotKey}" in the next ${String(DRAFT_DAYS)} days`);
}

export const recipeDraft: JobHandler = async (ctx) => {
  const p = ctx.job.payload as unknown as RecipeDraftPayload;
  const hh = ctx.household();
  const config = await loadHouseholdConfig(ctx.rt.db, hh);
  const pool = await loadPlanPool(ctx.rt.db, hh);
  const slotKey = draftSlot(config, p.slot);
  // 1.4.9 (R-61, R-66): the day the admin named, else the first day someone attends the slot.
  const date =
    typeof p.date === "string" && p.date !== ""
      ? p.date
      : draftDate(config, slotKey, p.count, localDate(new Date(), config.household.timezone));
  const outcome = await generateDishes(ctx.rt, hh, {
    config,
    pool,
    date,
    slotKey,
    count: p.count,
    adminRequest: p.request,
    by: SYSTEM,
    save: false,
  });
  if (outcome.status === "unavailable") throw new Error(outcome.reason);
  // Plates are labelled by pseudonym in the generator (REC-3); the admin's card shows names.
  const { scrub } = buildGenerationContext({ config, date, slotKey, count: p.count });
  const nameOf = new Map<string, string>();
  for (const m of config.members) nameOf.set(scrub(m.displayName), m.displayName);
  // Each draft carries the exact ops its Save applies through POST /change-sets (R-53: the one
  // mapping `saveGeneratedDishes` also uses). Slugs are free as of now and distinct across drafts.
  const taken = new Set(await householdDishSlugs(ctx.rt.db, hh));
  const draftOps = outcome.survivors.map((s) => {
    const { ops } = generatedDishOps({
      survivors: [{ dish: s.dish, newIngredients: s.newIngredients, call: s.call }],
      generationIds: outcome.run.generationIds,
      catalog: pool.catalog,
      takenSlugs: taken,
    });
    for (const op of ops)
      if (op.kind === "dish.create") taken.add((op.payload as { slug: string }).slug);
    return { ops, summary: `Add AI recipe "${s.dish.name.slice(0, 120)}"` };
  });
  return toJson({
    slotKey,
    date,
    dishes: outcome.survivors.map((s, i) => ({
      ...draftOps[i],
      dish: s.dish,
      newIngredients: s.newIngredients,
      nutrition: s.nutrition,
      candidate: s.candidate,
      reasons: s.reasons,
      plates: s.plates.map((plate) => ({
        ...plate,
        member: nameOf.get(plate.label) ?? plate.label,
      })),
    })),
    rejected: outcome.run.rejected.map((r) => ({ dishName: r.dishName, reasons: r.reasons })),
  });
};
