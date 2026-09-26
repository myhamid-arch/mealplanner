// The worker's job handlers (ARC-7, R-40). Each returns the job result, stored as the `done` event.
// Actors of the change sets they write (leaf-1.4.1 SPEC-Q-12): a job a user started from the UI
// writes as that user (`ui`); triggered and scheduled jobs write as `system` (`learning`).
import { eq, inArray } from "drizzle-orm";
import type { KgSyncRequest } from "@mealplanner/graph/sync";
import { recomputeLibrary, syncGraph } from "@mealplanner/graph/sync";
import type { PlanProgress } from "@mealplanner/core/planner";
import type { HouseholdContext, Json } from "@mealplanner/core/types";
import { changeSet, component, dish, household, member, variant } from "@mealplanner/db/schema";
import { loadHouseholdConfig } from "@mealplanner/db/services/config";
import { expireProposals, localDate, runInsights } from "@mealplanner/db/services/proposals";
import {
  followUpJobs,
  generatePlan,
  loadPlanPool,
  recomputeNutrition,
  resolvePlates,
  substituteUnavailable,
  type ChangeActorInput,
} from "@mealplanner/db/services/plans";
import { requestDishesFor, synthesizeFor, generateDishes } from "../ai.js";
import { toJson, type JobContext, type JobHandler } from "../runner.js";
import { reviseRecipe } from "./revise.js";
import { purgeDueHouseholds } from "./purge.js";

const SYSTEM: ChangeActorInput = { actor: "system", source: "learning" };

function systemCtx(householdId: string): HouseholdContext {
  return { householdId, userId: null, role: "system" };
}

function payload(ctx: JobContext): unknown {
  return ctx.job.payload;
}

/** Queues the follow-ups of a change set the worker applied (as the API does). */
export async function followUps(
  ctx: JobContext,
  householdId: string,
  changeSetId: string | null,
): Promise<string[]> {
  if (changeSetId === null) return [];
  const [row] = await ctx.rt.db.select().from(changeSet).where(eq(changeSet.id, changeSetId));
  const [h] = await ctx.rt.db
    .select({ tz: household.timezone })
    .from(household)
    .where(eq(household.id, householdId));
  if (row === undefined || h === undefined) return [];
  const ids: string[] = [];
  for (const f of followUpJobs(row, localDate(new Date(), h.tz)))
    ids.push(await ctx.rt.enqueue(f.kind, householdId, f.payload, null));
  return ids;
}

function progressPayload(e: PlanProgress): Json {
  return toJson(e);
}

export const planGenerate: JobHandler = async (ctx) => {
  const p = payload(ctx) as { dates: string[]; seed?: number };
  const hh = ctx.household();
  const by: ChangeActorInput = hh.userId === null ? SYSTEM : { actor: "user", source: "ui" };
  const config = await loadHouseholdConfig(ctx.rt.db, hh);
  const result = await generatePlan(ctx.rt.db, hh, {
    dates: p.dates,
    seed: p.seed ?? 1,
    by,
    onProgress: (e) => {
      // The planner's own `done` is not the job's terminal event (the runner appends that).
      ctx.emit(e.type === "done" ? "planned" : e.type, progressPayload(e));
    },
    requestDishes: requestDishesFor(ctx.rt, hh, config, by, (type, data) => {
      ctx.emit(type, data);
    }),
  });
  const { stats } = result.plan;
  // ARC-12 planner metrics.
  ctx.log.info(
    { planner: stats, dates: result.plan.dates.length, flags: result.plan.flags.length },
    "plan generated",
  );
  return {
    changeSetId: result.changeSetId,
    dates: result.plan.dates,
    meals: result.plan.days.reduce((n, d) => n + d.meals.length, 0),
    flags: toJson(result.plan.flags),
    proposals: result.proposals.map((r) => r.id),
    stats: toJson(stats),
  };
};

export const nutritionRecompute: JobHandler = async (ctx) => {
  const hh = ctx.job.householdId;
  const result = await recomputeNutrition(ctx.rt.db, {
    householdId: hh,
    factorsBySlug: ctx.rt.factorsBySlug,
  });
  return { variants: result.variants, needsReview: result.needsReview };
};

export const platesResolve: JobHandler = async (ctx) => {
  const p = payload(ctx) as { fromDate: string };
  const hh = ctx.household();
  const report = await resolvePlates(ctx.rt.db, systemCtx(hh.householdId), {
    fromDate: p.fromDate,
    by: SYSTEM,
  });
  return toJson(report);
};

export const platesSubstitute: JobHandler = async (ctx) => {
  const p = payload(ctx) as { date: string; ingredientId: string };
  const hh = systemCtx(ctx.household().householdId);
  const report = await substituteUnavailable(ctx.rt.db, hh, {
    date: p.date,
    ingredientId: p.ingredientId,
    by: SYSTEM,
    substitutes: (ingredientId) => ctx.rt.graph.substitutes(ingredientId, hh.householdId, 10),
  });
  const queued = await followUps(ctx, hh.householdId, report.changeSetId);
  return toJson({ ...report, followUps: queued });
};

export const insightsRun: JobHandler = async (ctx) => {
  const hh = systemCtx(ctx.household().householdId);
  const expired = await expireProposals(ctx.rt.db, hh);
  const digest = await runInsights(ctx.rt.db, hh, { synthesize: synthesizeFor(ctx.rt, hh) });
  return toJson({
    expired,
    runAt: digest.runAt,
    stored: digest.stored.map((r) => ({ id: r.id, kind: r.kind, origin: r.origin })),
    dropped: digest.dropped,
    notes: digest.notes,
    ruleCandidates: digest.ruleCandidates,
    synthesis: digest.synthesis,
    reviewsProcessed: digest.reviewsProcessed,
  });
};

/** KG-3 requests for the entities a change set touched (dishes, members, preferences). */
async function syncRequests(
  ctx: JobContext,
  householdId: string,
  changeSetId: string,
): Promise<KgSyncRequest[]> {
  const [row] = await ctx.rt.db.select().from(changeSet).where(eq(changeSet.id, changeSetId));
  if (row === undefined) return [];
  const images = (Array.isArray(row.inverse) ? row.inverse : []).flatMap((op) => {
    const imgs = (op as { payload?: { images?: unknown } }).payload?.images;
    return Array.isArray(imgs)
      ? (imgs as Array<{
          entity: string;
          key: Record<string, unknown>;
          before: Record<string, unknown> | null;
        }>)
      : [];
  });
  const dishIds = new Set<string>();
  const componentIds = new Set<string>();
  const variantIds = new Set<string>();
  const memberIds = new Set<string>();
  let householdPreference = false;
  for (const img of images) {
    const key = img.key;
    const before = img.before ?? {};
    if (img.entity === "dish" && typeof key.id === "string") dishIds.add(key.id);
    if (img.entity === "component") {
      if (typeof before.dishId === "string") dishIds.add(before.dishId);
      if (typeof key.id === "string") componentIds.add(key.id);
    }
    if (img.entity === "variant") {
      if (typeof before.componentId === "string") componentIds.add(before.componentId);
      if (typeof key.id === "string") variantIds.add(key.id);
    }
    if (img.entity === "variant_ingredient" && typeof before.variantId === "string")
      variantIds.add(before.variantId);
    if (img.entity === "member" && typeof key.id === "string") memberIds.add(key.id);
    if (img.entity === "preference") {
      if (typeof before.memberId === "string") memberIds.add(before.memberId);
      else householdPreference = true;
    }
  }
  const db = ctx.rt.db;
  if (variantIds.size > 0)
    for (const v of await db
      .select({ componentId: variant.componentId })
      .from(variant)
      .where(inArray(variant.id, [...variantIds])))
      componentIds.add(v.componentId);
  if (componentIds.size > 0)
    for (const c of await db
      .select({ dishId: component.dishId })
      .from(component)
      .where(inArray(component.id, [...componentIds])))
      dishIds.add(c.dishId);
  // Preference and member rows created by the change set have no before-image: read the current ones.
  if (
    images.some((i) => i.entity === "preference" && i.before === null) ||
    householdPreference ||
    images.some((i) => i.entity === "member" && i.before === null)
  )
    for (const m of await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.householdId, householdId)))
      memberIds.add(m.id);
  const scopes =
    dishIds.size === 0
      ? []
      : await db
          .select({ id: dish.id, householdId: dish.householdId })
          .from(dish)
          .where(inArray(dish.id, [...dishIds]));
  const requests: KgSyncRequest[] = [];
  const own = scopes.filter((d) => d.householdId === householdId).map((d) => d.id);
  const deleted = [...dishIds].filter((id) => !scopes.some((d) => d.id === id));
  if (own.length + deleted.length > 0)
    requests.push({ kind: "dish", householdId, dishIds: [...own, ...deleted].sort() });
  if (memberIds.size > 0) {
    requests.push({ kind: "member", householdId, memberIds: [...memberIds].sort() });
    requests.push({ kind: "preferences", householdId, memberIds: [...memberIds].sort() });
  }
  if (images.some((i) => i.entity === "ingredient"))
    requests.push({ kind: "catalogue", householdId });
  return requests;
}

export const kgSync: JobHandler = async (ctx) => {
  const p = payload(ctx) as { changeSetId?: string; request?: KgSyncRequest };
  const requests: KgSyncRequest[] =
    p.request !== undefined
      ? [p.request]
      : ctx.job.householdId !== null && p.changeSetId !== undefined
        ? await syncRequests(ctx, ctx.job.householdId, p.changeSetId)
        : [];
  for (const r of requests) await syncGraph(ctx.rt.graph, ctx.rt.kgSource, r);
  return toJson({ requests });
};

export const kgNightly: JobHandler = async (ctx) => {
  await recomputeLibrary(ctx.rt.graph, ctx.rt.kgSource);
  return { recomputed: true };
};

/** PLN-12 `ask`, accepted: generate the dishes the proposal asked for (saved to the library). */
export const recipeGenerate: JobHandler = async (ctx) => {
  const p = payload(ctx) as { date: string; slotKey: string; count: number; reason: string };
  const hh = systemCtx(ctx.household().householdId);
  const config = await loadHouseholdConfig(ctx.rt.db, hh);
  const pool = await loadPlanPool(ctx.rt.db, hh);
  const outcome = await generateDishes(ctx.rt, hh, {
    config,
    pool,
    date: p.date,
    slotKey: p.slotKey,
    count: p.count,
    adminRequest: p.reason,
    by: SYSTEM,
    save: true,
  });
  if (outcome.status === "unavailable") throw new Error(outcome.reason);
  return toJson({
    dishIds: outcome.dishIds,
    candidates: outcome.candidateIds,
    rejected: outcome.run.rejected.map((r) => ({ dishName: r.dishName, reasons: r.reasons })),
  });
};

export const recipeRevise: JobHandler = async (ctx) => {
  const result = await reviseRecipe(ctx);
  const queued = await followUps(ctx, ctx.household().householdId, result.changeSetId);
  return toJson({ ...result, followUps: queued });
};

export const householdPurge: JobHandler = async (ctx) => {
  return toJson({ purged: await purgeDueHouseholds(ctx.rt) });
};

export const HANDLERS: Record<string, JobHandler> = {
  "plan.generate": planGenerate,
  "nutrition.recompute": nutritionRecompute,
  "plates.resolve": platesResolve,
  "plates.substitute": platesSubstitute,
  "insights.run": insightsRun,
  "kg.sync": kgSync,
  "kg.nightly": kgNightly,
  "recipe.generate": recipeGenerate,
  "recipe.revise": recipeRevise,
  "household.purge": householdPurge,
};
