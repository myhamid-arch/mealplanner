// The admin agent's wiring in the web process (R-2, R-46; leaf-1.3.5 SPEC-Q-1): the model from the
// environment, `AgentPorts` over the database services and 1.4.1's read helpers (household-scoped by
// the caller's session; the model never names a household), the append-only chat store, the
// household digest, and `POST /conversations/:id/messages` as a Server-Sent Events stream. One turn
// per conversation at a time (advisory lock, released in `finally`; SPEC-Q-11).
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type pg from "pg";
import {
  MAX_PLAN_RANGE_DAYS,
  ToolError,
  agentEffort,
  createAgentModel,
  householdDigest,
  runAgentTurn,
  screenContextText,
  type AgentModel,
  type AgentPorts,
  type ChatCallRecord,
  type ChatStore,
  type ChatStreamEvent,
  type DigestSnapshot,
  type Json,
  type StoredMessage,
  type ToolOutput,
} from "@mealplanner/ai/agent";
import { resolveClaudeConfig } from "@mealplanner/ai/client";
import type { ChangeOp } from "@mealplanner/core/changes";
import { createRepos } from "@mealplanner/db/repos";
import {
  chatMessage,
  component,
  ingredient,
  newId,
  planDay,
  planMeal,
  proposal,
  review,
  variant,
  variantIngredient,
} from "@mealplanner/db/schema";
import {
  AlreadyUndoneError,
  ChangeConflictError,
  ChangeOpError,
  ChangeSetNotFoundError,
  ChangeValidationError,
  LastAdminError,
  ProtectedOperationError,
  applyChangeSet,
  previewChangeSet,
  undoChangeSet,
} from "@mealplanner/db/services/changes";
import { recordAiGeneration } from "@mealplanner/db/services/plans";
import { createProposals, localDate } from "@mealplanner/db/services/proposals";
import { CrossHouseholdError, RowNotFoundError } from "@mealplanner/db/repos";
import type { CallerContext } from "../auth/context";
import { changeLog, conversationOne, proposals } from "./changes";
import { listReviews } from "./feedback";
import { afterChangeSet } from "./followups";
import { listAccess } from "./identity";
import { enqueueJob } from "./jobs";
import { logger } from "./log";
import { alternatives, mealDto, planDays } from "./plans";
import { ProblemError, conflict } from "./problem";
import { chatRateLimit } from "./rate-limit";
import {
  getDish,
  getSchedules,
  getWeights,
  listDishes,
  listExclusions,
  listMembers,
  listPreferences,
  listPresets,
  listSlots,
  listTargets,
} from "./reads";
import type { Runtime } from "./runtime";

// The model --------------------------------------------------------------------------------------

const MODEL_KEY = Symbol.for("mealplanner.web.agentModel");
type ModelHolder = { [MODEL_KEY]?: AgentModel | null };

/** The agent model from the environment (null without a credential), or the one tests installed. */
export function agentModel(): AgentModel | null {
  const holder = globalThis as ModelHolder;
  if (!(MODEL_KEY in holder))
    holder[MODEL_KEY] = createAgentModel(resolveClaudeConfig(), agentEffort());
  return holder[MODEL_KEY] ?? null;
}

/** Installs a model (tests: a scripted stub; null: no credential); undefined reads the env again. */
export function useAgentModel(model: AgentModel | null | undefined): void {
  const holder = globalThis as ModelHolder;
  if (model === undefined) Reflect.deleteProperty(holder, MODEL_KEY);
  else holder[MODEL_KEY] = model;
}

// Helpers ----------------------------------------------------------------------------------------

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function out(forModel: unknown, cards?: ToolOutput["cards"]): ToolOutput {
  return cards === undefined
    ? { forModel: asJson(forModel) }
    : { forModel: asJson(forModel), cards };
}

/** Domain refusals become tool errors the model can read; anything else stays unexpected. */
async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProblemError) throw new ToolError(error.message);
    if (error instanceof ChangeValidationError)
      throw new ToolError(error.message, asJson({ index: error.index, issues: error.issues }));
    if (error instanceof CrossHouseholdError || error instanceof RowNotFoundError)
      throw new ToolError("not found");
    if (
      error instanceof ChangeOpError ||
      error instanceof LastAdminError ||
      error instanceof ChangeConflictError ||
      error instanceof AlreadyUndoneError ||
      error instanceof ChangeSetNotFoundError
    )
      throw new ToolError(error.message);
    throw error;
  }
}

function dates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out.slice(0, MAX_PLAN_RANGE_DAYS);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ports ------------------------------------------------------------------------------------------

/** The AGT-4 tools for one admin in one conversation. */
export function agentPorts(rt: Runtime, caller: CallerContext, conversationId: string): AgentPorts {
  const ctx = caller.ctx;
  const job = async (kind: "plan.generate" | "insights.run" | "recipe.draft", payload: Json) => {
    const jobId = await enqueueJob(rt.db, rt.queue, {
      kind,
      householdId: ctx.householdId,
      payload,
      createdByUserId: ctx.userId,
    });
    return out({ jobId, status: "queued" }, [
      { type: "job_progress", jobId, kind, status: "queued" },
    ]);
  };

  return {
    getHousehold: () =>
      refusals(async () =>
        out({
          ...(await listMembers(rt, caller)),
          ...(await listTargets(rt, caller)),
          ...(await listSlots(rt, caller)),
          schedules: await getSchedules(rt, caller),
          weights: await getWeights(rt, caller),
          ...(await listPresets(rt, caller)),
          ...(await listExclusions(rt, caller, undefined)),
          // 1.3.6 (R-64, R-67): role.set needs the login's userId; no emails reach the model.
          logins: (await listAccess(rt, caller)).logins.map((l) => ({
            userId: l.userId,
            name: l.name,
            role: l.role,
            status: l.status,
            memberId: l.memberId,
            memberName: l.memberName,
          })),
          agentMayApply: caller.household.agentMayApply,
        }),
      ),

    getPlan: (i) =>
      refusals(async () => {
        const { days } = await planDays(rt, caller, i.from, i.to);
        return out(
          { days },
          days.map((d) => ({
            type: "plan_day" as const,
            date: d.date,
            meals: asJson(d.meals) as Json[],
          })),
        );
      }),

    explainMeal: (i) => refusals(async () => out(await mealDto(rt, caller, i.planMealId))),

    searchDishes: (i) =>
      refusals(async () => {
        const { dishes } = await listDishes(rt, caller, {
          q: i.query,
          cuisine: i.cuisine,
          slot: i.slot,
          status: "active",
        });
        let picked = dishes;
        if (i.ingredient !== undefined) {
          const rows =
            dishes.length === 0
              ? []
              : await rt.db
                  .selectDistinct({ dishId: component.dishId })
                  .from(component)
                  .innerJoin(variant, eq(variant.componentId, component.id))
                  .innerJoin(variantIngredient, eq(variantIngredient.variantId, variant.id))
                  .innerJoin(ingredient, eq(ingredient.id, variantIngredient.ingredientId))
                  .where(
                    and(
                      eq(ingredient.slug, i.ingredient),
                      inArray(
                        component.dishId,
                        dishes.map((d) => d.id),
                      ),
                    ),
                  );
          const withIt = new Set(rows.map((r) => r.dishId));
          picked = dishes.filter((d) => withIt.has(d.id));
        }
        return out({
          total: picked.length,
          dishes: picked.slice(0, i.limit).map((d) => ({
            id: d.id,
            name: d.name,
            cuisine: d.cuisineKey,
            slotKeys: d.slotKeys,
            source: d.source,
            isPackable: d.isPackable,
          })),
        });
      }),

    getDish: (i) =>
      refusals(async () => {
        const recipe = await getDish(rt, caller, i.dishId);
        const rated = await rt.db
          .select({ rating: review.rating })
          .from(review)
          .where(
            and(
              eq(review.householdId, ctx.householdId),
              eq(review.targetType, "dish"),
              eq(review.targetId, i.dishId),
            ),
          );
        const ratings = rated.map((r) => r.rating).filter((r): r is number => r !== null);
        return out({
          ...recipe,
          reviews: {
            count: rated.length,
            meanRating:
              ratings.length === 0
                ? null
                : Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10,
          },
        });
      }),

    getReviews: (i) =>
      refusals(async () => {
        const { reviews } = await listReviews(rt, caller, {
          targetType: i.target?.type,
          targetId: i.target?.id,
          memberId: i.memberId,
          limit: 1000,
        });
        const picked = (reviews as { rating: number | null; createdAt: string }[])
          .filter((r) => i.since === undefined || r.createdAt.slice(0, 10) >= i.since)
          .filter(
            (r) => i.minRating === undefined || (r.rating !== null && r.rating >= i.minRating),
          )
          .filter(
            (r) => i.maxRating === undefined || (r.rating !== null && r.rating <= i.maxRating),
          )
          .slice(0, i.limit);
        return out({ reviews: picked });
      }),

    getPreferences: (i) => refusals(async () => out(await listPreferences(rt, caller, i.memberId))),

    getProposals: (i) => refusals(async () => out(await proposals(rt, caller, i.status))),

    getChangeLog: (i) => refusals(async () => out(await changeLog(rt, ctx, { limit: i.limit }))),

    generatePlan: (i) =>
      job("plan.generate", {
        dates: dates(i.from, i.to),
        seed: 1,
        source: "agent",
        conversationId,
      }),

    suggestAlternatives: (i) =>
      refusals(async () => {
        const result = await alternatives(rt, caller, i.planMealId);
        return out({
          ...result,
          // SPEC-Q-17: no free-text scorer exists; the instruction is returned for the model to
          // apply, and something new is asked for with create_recipe.
          ...(i.instruction === undefined ? {} : { instruction: i.instruction }),
        });
      }),

    createRecipe: (i) =>
      job("recipe.draft", {
        conversationId,
        request: i.request,
        slot: i.slot ?? null,
        // 1.4.9 (R-61, R-66): the day the admin named, for the card's "Use for" link.
        date: i.date ?? null,
        count: i.count,
      }),

    runInsights: () => job("insights.run", { trigger: "on_demand", conversationId }),

    undoChange: (i) =>
      refusals(async () => {
        const result = await undoChangeSet(rt.db, ctx, i.changeSetId, {
          actor: "agent",
          source: "agent_apply",
        });
        await afterChangeSet(rt, ctx.householdId, result.changeSetId, ctx.userId);
        return out({ status: "undone", changeSetId: result.changeSetId });
      }),

    applyChange: (i) =>
      refusals(async () => {
        try {
          const applied = await applyChangeSet(rt.db, ctx, {
            actor: "agent",
            source: "agent_apply",
            summary: i.summary,
            ops: i.ops,
          });
          await afterChangeSet(rt, ctx.householdId, applied.changeSetId, ctx.userId);
          return {
            status: "applied" as const,
            changeSetId: applied.changeSetId,
            appliedAt: applied.appliedAt.toISOString(),
            descriptions: applied.descriptions,
          };
        } catch (error) {
          // AGT-5: the change-set service refused before writing anything.
          if (error instanceof ProtectedOperationError)
            return { status: "refused" as const, reason: error.reason, kinds: [...error.kinds] };
          throw error;
        }
      }),

    proposeChange: (i, call) =>
      refusals(async () => {
        const descriptions = await previewChangeSet(rt.db, ctx, i.ops);
        const ev = (i.evidence ?? {}) as { reviewIds?: unknown; note?: unknown };
        const reviewIds = Array.isArray(ev.reviewIds)
          ? ev.reviewIds.filter((x): x is string => typeof x === "string" && UUID.test(x))
          : [];
        const note = typeof ev.note === "string" && ev.note !== "" ? `\n\n${ev.note}` : "";
        const result = await createProposals(
          rt.db,
          ctx,
          [
            {
              origin: "agent_chat",
              title: i.title,
              rationale: `${i.rationale}${note}`,
              ops: i.ops as unknown as ChangeOp[],
              evidence: { reviewIds, count: reviewIds.length, metrics: {} },
              priority: 3,
            },
          ],
          { conversationId, messageId: call.assistantMessageId },
        );
        const stored = result.stored[0];
        if (stored === undefined) {
          const dropped = result.dropped[0];
          return {
            status: "dropped" as const,
            reason: dropped === undefined ? "not stored" : `${dropped.reason}: ${dropped.detail}`,
          };
        }
        return {
          status: "stored" as const,
          proposalId: stored.id,
          title: i.title,
          rationale: stored.rationale,
          descriptions,
          evidence: asJson(stored.evidence),
        };
      }),

    ingredientKey: async (key) => {
      const [bySlug] = await rt.db
        .select({ slug: ingredient.slug })
        .from(ingredient)
        .where(eq(ingredient.slug, key));
      if (bySlug !== undefined) return { status: "slug", slug: bySlug.slug };
      if (UUID.test(key)) {
        const [byId] = await rt.db
          .select({ slug: ingredient.slug })
          .from(ingredient)
          .where(eq(ingredient.id, key));
        if (byId !== undefined) return { status: "id", slug: byId.slug };
      }
      return { status: "unknown" };
    },
  };
}

// The chat store (AGT-8) -------------------------------------------------------------------------

function storedOf(row: typeof chatMessage.$inferSelect): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The conversation's rows, oldest first (the order they were appended in). */
export async function conversationRows(
  rt: Runtime,
  householdId: string,
  conversationId: string,
): Promise<StoredMessage[]> {
  const rows = await rt.db
    .select()
    .from(chatMessage)
    .where(
      and(eq(chatMessage.householdId, householdId), eq(chatMessage.conversationId, conversationId)),
    )
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id));
  return rows.map(storedOf);
}

/**
 * Appends rows with strictly increasing `created_at` (so the replay order is the append order) and
 * returns each row as read back from the database: requests are built from stored content only.
 */
export function chatStore(
  rt: Runtime,
  householdId: string,
  conversationId: string,
  last: StoredMessage | undefined,
): ChatStore {
  let lastAt = last === undefined ? 0 : Date.parse(last.createdAt);
  return {
    async append(role, content) {
      lastAt = Math.max(Date.now(), lastAt + 1);
      const [row] = await rt.db
        .insert(chatMessage)
        .values({
          id: newId(),
          householdId,
          conversationId,
          role,
          content,
          createdAt: new Date(lastAt),
        })
        .returning();
      if (row === undefined) throw new Error("chat_message insert returned nothing");
      return storedOf(row);
    },
  };
}

// The digest (AGT-3) -----------------------------------------------------------------------------

export async function digestSnapshot(
  rt: Runtime,
  caller: CallerContext,
  now = new Date(),
): Promise<DigestSnapshot> {
  const r = createRepos(rt.db, caller.ctx);
  const tz = caller.household.timezone;
  const today = localDate(now, tz);
  const members = (await r.member.list()).filter((m) => m.archivedAt === null);
  const targets = await r.target_profile.list();
  const slots = (await r.slot_type.list())
    .filter((s) => s.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const weights = await r.planning_weights.get({ householdId: caller.ctx.householdId });
  const [pending] = await rt.db
    .select({ n: count() })
    .from(proposal)
    .where(and(eq(proposal.householdId, caller.ctx.householdId), eq(proposal.status, "pending")));
  const [day] = await rt.db
    .select({ id: planDay.id })
    .from(planDay)
    .where(and(eq(planDay.householdId, caller.ctx.householdId), eq(planDay.date, today)));
  const [meals] =
    day === undefined
      ? [{ n: 0 }]
      : await rt.db
          .select({ n: count() })
          .from(planMeal)
          .where(
            and(eq(planMeal.householdId, caller.ctx.householdId), eq(planMeal.planDayId, day.id)),
          );
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return {
    now: `${today} ${time}`,
    timezone: tz,
    members: members
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((m) => {
        const t = targets.find((x) => x.memberId === m.id && x.kind === "default");
        return {
          id: m.id,
          name: m.displayName,
          targeted: m.isTargeted,
          targets:
            m.isTargeted && t !== undefined
              ? {
                  kcal: t.kcal,
                  protein: t.proteinG,
                  carbs: t.carbsG,
                  fat: t.fatG,
                }
              : null,
        };
      }),
    slots: slots.map((s) => ({ key: s.key, label: s.label, shared: s.isShared })),
    weights: {
      macroPrecision: weights?.macroPrecision ?? 1,
      appeal: weights?.appeal ?? 0.6,
      ingredientEconomy: weights?.ingredientEconomy ?? 0.4,
      aiGeneration: weights?.aiGeneration ?? "auto",
    },
    pendingProposals: pending?.n ?? 0,
    agentMayApply: caller.household.agentMayApply,
    today: {
      date: today,
      status: day === undefined ? "not planned" : "planned",
      meals: meals?.n ?? 0,
    },
  };
}

// The turn (POST /conversations/:id/messages) ---------------------------------------------------

function frame(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Holds the conversation's advisory lock on a dedicated connection, or null when a turn runs. */
async function lockConversation(
  rt: Runtime,
  conversationId: string,
): Promise<pg.PoolClient | null> {
  const client = await rt.pool.connect();
  try {
    const res = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS ok",
      [`chat:${conversationId}`],
    );
    if (res.rows[0]?.ok === true) return client;
  } catch (error) {
    client.release();
    throw error;
  }
  client.release();
  return null;
}

async function unlockConversation(client: pg.PoolClient, conversationId: string): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`chat:${conversationId}`]);
    client.release();
  } catch (error) {
    // A connection that could not unlock is destroyed: its session lock goes with it.
    client.release(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * One chat turn as a Server-Sent Events response (AGT-2, AGT-7). Refusals (not the admin's
 * conversation, no credential, over the rate limit, a turn already running) are answered before
 * anything is stored.
 */
export async function sendMessage(
  rt: Runtime,
  caller: CallerContext,
  conversationId: string,
  body: { text: string; screen?: string | undefined },
  request: Request,
): Promise<Response> {
  const conversationRow = await conversationOne(rt, caller, conversationId);
  if (conversationRow.archivedAt !== null)
    throw conflict("conversation_archived", "this conversation is archived");
  const model = agentModel();
  if (model === null)
    throw new ProblemError(
      503,
      "assistant_unavailable",
      "the assistant is unavailable: no Anthropic credential is configured (set ANTHROPIC_API_KEY)",
    );
  await chatRateLimit(rt.db, caller.ctx.householdId, rt.config.chatTurnsPerHour);
  const lock = await lockConversation(rt, conversationId);
  if (lock === null)
    throw conflict("turn_in_progress", "a reply to this conversation is still running");

  const log = logger.child({ householdId: caller.ctx.householdId, conversationId });
  const abort = new AbortController();
  const onAbort = () => {
    abort.abort();
  };
  request.signal.addEventListener("abort", onAbort);
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame(event)));
        } catch {
          closed = true;
        }
      };
      try {
        const history = await conversationRows(rt, caller.ctx.householdId, conversationId);
        const digest = householdDigest(await digestSnapshot(rt, caller));
        await runAgentTurn({
          model,
          ports: agentPorts(rt, caller, conversationId),
          store: chatStore(rt, caller.ctx.householdId, conversationId, history.at(-1)),
          history,
          text: body.text,
          screen: body.screen === undefined ? null : screenContextText(body.screen),
          digest,
          sink: send,
          signal: abort.signal,
          recordCall: async (record: ChatCallRecord) => {
            await recordAiGeneration(rt.db, caller.ctx, {
              ...record,
              requestSummary: asJson({
                conversationId,
                ...(record.requestSummary as Record<string, Json>),
              }),
            });
          },
          onUnexpected: (error, tool) => {
            log.error({ err: error, tool }, "agent tool failed");
          },
        });
      } catch (error) {
        log.error({ err: error }, "chat turn failed");
        send({ type: "error", code: "internal_error", message: "the turn failed unexpectedly" });
        send({ type: "done", stopReason: "error", modelCalls: 0 });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        await unlockConversation(lock, conversationId);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // the client already went away
          }
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
