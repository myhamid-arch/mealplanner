// The worker's job handlers (ARC-7, R-40). Each returns the job result, stored as the `done` event.
// Actors of the change sets they write (leaf-1.4.1 SPEC-Q-12): a job a user started from the UI
// writes as that user (`ui`); triggered and scheduled jobs write as `system` (`learning`).
import { and, eq, inArray } from "drizzle-orm";
import type { KgSyncRequest } from "@mealplanner/graph/sync";
import { recomputeLibrary, syncGraph } from "@mealplanner/graph/sync";
import type { PlanProgress } from "@mealplanner/core/planner";
import type { HouseholdContext, Json } from "@mealplanner/core/types";
import {
  changeSet,
  component,
  dish,
  household,
  member,
  planDay,
  planMeal,
  variant,
} from "@mealplanner/db/schema";
import { loadHouseholdConfig } from "@mealplanner/db/services/config";
import { expireProposals, localDate, runInsights } from "@mealplanner/db/services/proposals";
import {
  followUpJobs,
  generatePlan,
  improveMeal,
  loadPlanPool,
  recomputeNutrition,
  resolvePlates,
  substituteUnavailable,
  type ChangeActorInput,
} from "@mealplanner/db/services/plans";
import { synthesizeFor, generateDishes } from "../ai.js";
import { toJson, type JobContext, type JobHandler } from "../runner.js";
import type { WorkerRuntime } from "../runtime.js";
import { reviseRecipe } from "./revise.js";
import { purgeDueHouseholds } from "./purge.js";
import { planReadySummary, postInsightDigest } from "./chat-events.js";
import { recipeDraft } from "./recipe-draft.js";
import { reviewsExtract } from "./reviews-extract.js";
import { plansPreview } from "./plans-preview.js";

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
  return followUpsOf(ctx.rt, householdId, changeSetId);
}

export async function followUpsOf(
  rt: WorkerRuntime,
  householdId: string,
  changeSetId: string | null,
): Promise<string[]> {
  if (changeSetId === null) return [];
  const [row] = await rt.db.select().from(changeSet).where(eq(changeSet.id, changeSetId));
  const [h] = await rt.db
    .select({ tz: household.timezone })
    .from(household)
    .where(eq(household.id, householdId));
  if (row === undefined || h === undefined) return [];
  let today: string;
  try {
    today = localDate(new Date(), h.tz);
  } catch {
    today = new Date().toISOString().slice(0, 10);
  }
  const ids: string[] = [];
  for (const f of followUpJobs(row, today))
    ids.push(await rt.enqueue(f.kind, householdId, f.payload, null));
  return ids;
}

function progressPayload(e: PlanProgress): Json {
  return toJson(e);
}

export const planGenerate: JobHandler = async (ctx) => {
  const p = payload(ctx) as { dates: string[]; seed?: number; source?: string };
  const hh = ctx.household();
  // R-49: a plan the admin asked the assistant for is the agent's (the agent adapter alone sets
  // `source: "agent"`; POST /plans/generate's body cannot carry it).
  const by: ChangeActorInput =
    hh.userId === null
      ? SYSTEM
      : p.source === "agent"
        ? { actor: "agent", source: "agent_apply" }
        : { actor: "user", source: "ui" };
  // W-30: the plan never waits for the recipe generator (minutes per meal at the recipe model's
  // effort). Weak meals keep the best dish there is; new recipes are written afterwards by
  // `plan.improve`, which swaps them in where they score higher.
  const result = await generatePlan(ctx.rt.db, hh, {
    dates: p.dates,
    seed: p.seed ?? 1,
    by,
    deferGeneration: true,
    onProgress: (e) => {
      // The planner's own `done` is not the job's terminal event (the runner appends that).
      ctx.emit(e.type === "done" ? "planned" : e.type, progressPayload(e));
    },
  });
  const improving = await queueImprovements(ctx, hh, result.deferred);
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
    // 1.4.9 (R-61): what the "plan is ready" row in Updates shows (W-9b).
    ready: planReadySummary(result.plan),
    // W-30: meals whose new recipes are being written in the background.
    improving,
  };
};

type Deferred = Awaited<ReturnType<typeof generatePlan>>["deferred"][number];

/** W-30: one `plan.improve` job per slot (a batch of new dishes serves every date it was short). */
async function queueImprovements(
  ctx: JobContext,
  hh: HouseholdContext,
  deferred: readonly Deferred[],
): Promise<number> {
  const bySlot = new Map<string, Deferred[]>();
  for (const r of deferred) bySlot.set(r.slotKey, [...(bySlot.get(r.slotKey) ?? []), r]);
  for (const [slotKey, rs] of bySlot) {
    const first = rs[0];
    if (first === undefined) continue;
    await ctx.rt.enqueue(
      "plan.improve",
      hh.householdId,
      {
        slotKey,
        dates: [...new Set(rs.map((r) => r.date))].sort(),
        count: Math.max(...rs.map((r) => r.count)),
        reason: first.reason.slice(0, 500),
        palette: first.palette,
        avoidRecentCuisines: [...new Set(rs.flatMap((r) => r.avoidRecentCuisines))].sort(),
        avoidDishes: [...new Set(rs.flatMap((r) => r.avoidDishes))].sort(),
      },
      hh.userId,
    );
  }
  return deferred.length;
}

/**
 * W-30: writes new dishes for a slot the plan was short on, then gives each planned meal of that
 * slot on those dates the best new dish where it scores higher (`improveMeal`: unlocked, future,
 * still a draft). Each swap is its own logged, undoable change set.
 */
export const planImprove: JobHandler = async (ctx) => {
  const p = payload(ctx) as {
    slotKey: string;
    dates: string[];
    count: number;
    reason: string;
    palette?: { slug: string; timesUsed: number }[];
    avoidRecentCuisines?: string[];
    avoidDishes?: string[];
  };
  const hh = systemCtx(ctx.household().householdId);
  const config = await loadHouseholdConfig(ctx.rt.db, hh);
  const pool = await loadPlanPool(ctx.rt.db, hh);
  const outcome = await generateDishes(ctx.rt, hh, {
    config,
    pool,
    date: p.dates[0] ?? "",
    slotKey: p.slotKey,
    count: p.count,
    ...(p.palette === undefined ? {} : { palette: p.palette }),
    ...(p.avoidRecentCuisines === undefined ? {} : { avoidRecentCuisines: p.avoidRecentCuisines }),
    ...(p.avoidDishes === undefined ? {} : { avoidDishes: p.avoidDishes }),
    by: SYSTEM,
    save: true,
  });
  if (outcome.status === "unavailable") return toJson({ written: 0, reason: outcome.reason });
  await followUps(ctx, hh.householdId, outcome.changeSetId);
  const slot = config.slotTypes.find((s) => s.key === p.slotKey);
  if (slot === undefined || outcome.dishIds.length === 0)
    return toJson({ written: outcome.dishIds.length, improved: [] });
  const [h] = await ctx.rt.db
    .select({ tz: household.timezone })
    .from(household)
    .where(eq(household.id, hh.householdId));
  let today: string;
  try {
    today = localDate(new Date(), h?.tz ?? "UTC");
  } catch {
    today = new Date().toISOString().slice(0, 10);
  }
  const meals = await ctx.rt.db
    .select({ id: planMeal.id, date: planDay.date })
    .from(planMeal)
    .innerJoin(planDay, eq(planDay.id, planMeal.planDayId))
    .where(
      and(
        eq(planDay.householdId, hh.householdId),
        inArray(planDay.date, p.dates),
        eq(planMeal.slotTypeId, slot.id),
      ),
    );
  const improved: { date: string; dish: string }[] = [];
  for (const m of meals) {
    const name = await improveMeal(ctx.rt.db, hh, {
      planMealId: m.id,
      dishIds: outcome.dishIds,
      today,
      by: SYSTEM,
    });
    if (name !== null) improved.push({ date: m.date, dish: name });
  }
  ctx.log.info({ written: outcome.dishIds.length, improved: improved.length }, "plan improved");
  return toJson({ written: outcome.dishIds.length, improved });
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
  // The proposals are committed: a failed chat post is logged, and does not fail the run (CP3).
  await postInsightDigest(ctx.rt, ctx.job, digest).catch((error: unknown) => {
    ctx.log.error({ err: error }, "the insights digest could not be posted to chat");
  });
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
  const queued = await followUps(ctx, hh.householdId, outcome.changeSetId);
  return toJson({
    followUps: queued,
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
  "plan.improve": planImprove,
  "nutrition.recompute": nutritionRecompute,
  "plates.resolve": platesResolve,
  "plates.substitute": platesSubstitute,
  "insights.run": insightsRun,
  "kg.sync": kgSync,
  "kg.nightly": kgNightly,
  "recipe.generate": recipeGenerate,
  "recipe.revise": recipeRevise,
  "household.purge": householdPurge,
  "reviews.extract": reviewsExtract,
  "recipe.draft": recipeDraft,
  "plans.preview": plansPreview,
};
