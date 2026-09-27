// GET /api/v1/cook-sheets/{date}/flags (BLD-8 R-52, R2-UX-1): the kitchen flags of a date with
// their `plates.substitute` job and its result, so admins see what a flag changed.
//
// A flag is a kitchen-tag review (`ingredient_unavailable` on an ingredient, `recipe_unclear` on
// a variant; lib/server/plans.ts `kitchenFlag`). It belongs to date D when its substitution job's
// payload says D, else when its plan meal is on D, else when it was written on D in the
// household's time zone. Admins see every flag of the date; kitchen users see their own.
import { and, arrayOverlaps, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  dish,
  household,
  ingredient,
  job,
  jobEvent,
  planDay,
  planMeal,
  review,
  slotType,
  user,
} from "@mealplanner/db/schema";
import { localDate } from "@mealplanner/db/services/proposals";
import type { CallerContext } from "../auth/context";
import type { Runtime } from "./runtime";

export const FLAG_TAGS = ["ingredient_unavailable", "recipe_unclear"] as const;

/** The `plates.substitute` job result (SubstituteReport, @mealplanner/db/services/plans). */
interface StoredReport {
  changeSetId?: unknown;
  substituteId?: unknown;
  copies?: unknown;
  unresolved?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function zoned(at: Date, timeZone: string): string {
  try {
    return localDate(at, timeZone);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export async function listKitchenFlags(rt: Runtime, caller: CallerContext, date: string) {
  const hh = caller.ctx.householdId;
  const [h] = await rt.db
    .select({ timezone: household.timezone })
    .from(household)
    .where(eq(household.id, hh));
  const timeZone = h?.timezone ?? "UTC";

  const rows = await rt.db
    .select({ r: review, authorName: user.name })
    .from(review)
    .innerJoin(user, eq(user.id, review.authorUserId))
    .where(
      and(
        eq(review.householdId, hh),
        isNull(review.parentReviewId),
        inArray(review.targetType, ["ingredient", "variant"]),
        arrayOverlaps(review.tags, [...FLAG_TAGS]),
        ...(caller.ctx.role === "admin" ? [] : [eq(review.authorUserId, caller.ctx.userId)]),
      ),
    )
    .orderBy(asc(review.createdAt));
  if (rows.length === 0) return { flags: [] };

  const reviewIds = rows.map((x) => x.r.id);
  const jobs = await rt.db
    .select()
    .from(job)
    .where(
      and(
        eq(job.householdId, hh),
        eq(job.kind, "plates.substitute"),
        inArray(sql<string>`${job.payload}->>'reviewId'`, reviewIds),
      ),
    );
  const jobOf = new Map(
    jobs.map((j) => [str((j.payload as Record<string, unknown>).reviewId) ?? "", j]),
  );

  const mealIds = rows.map((x) => x.r.planMealId).filter((x): x is string => x !== null);
  const mealDate = new Map(
    (mealIds.length === 0
      ? []
      : await rt.db
          .select({ id: planMeal.id, date: planDay.date })
          .from(planMeal)
          .innerJoin(planDay, eq(planDay.id, planMeal.planDayId))
          .where(and(eq(planMeal.householdId, hh), inArray(planMeal.id, mealIds)))
    ).map((m) => [m.id, m.date]),
  );

  const flagDate = (x: (typeof rows)[number]): string => {
    const j = jobOf.get(x.r.id);
    const fromJob = j === undefined ? null : str((j.payload as Record<string, unknown>).date);
    if (fromJob !== null) return fromJob;
    const fromMeal = x.r.planMealId === null ? undefined : mealDate.get(x.r.planMealId);
    return fromMeal ?? zoned(x.r.createdAt, timeZone);
  };
  const ofDate = rows.filter((x) => flagDate(x) === date);
  if (ofDate.length === 0) return { flags: [] };

  // The terminal `done` event of each job carries the handler's result (apps/worker runner).
  const doneJobIds = ofDate
    .map((x) => jobOf.get(x.r.id))
    .filter((j): j is NonNullable<typeof j> => j !== undefined && j.status === "succeeded")
    .map((j) => j.id);
  const reports = new Map<string, StoredReport>(
    (doneJobIds.length === 0
      ? []
      : await rt.db
          .select({ jobId: jobEvent.jobId, payload: jobEvent.payload })
          .from(jobEvent)
          .where(and(inArray(jobEvent.jobId, doneJobIds), eq(jobEvent.type, "done")))
    ).map((e) => [e.jobId, (e.payload ?? {}) as StoredReport]),
  );

  // Names: flagged and substitute ingredients, original and copied dishes.
  const ingredientIds = new Set<string>();
  const dishIds = new Set<string>();
  const copiesOf = new Map<string, Array<{ fromDishId: string; toDishId: string }>>();
  for (const [jobId, rep] of reports) {
    const sub = str(rep.substituteId);
    if (sub !== null) ingredientIds.add(sub);
    const copies = (Array.isArray(rep.copies) ? rep.copies : [])
      .map((c) => c as Record<string, unknown>)
      .map((c) => ({ fromDishId: str(c.fromDishId) ?? "", toDishId: str(c.toDishId) ?? "" }))
      .filter((c) => c.fromDishId !== "" && c.toDishId !== "");
    copiesOf.set(jobId, copies);
    for (const c of copies) {
      dishIds.add(c.fromDishId);
      dishIds.add(c.toDishId);
    }
  }
  for (const x of ofDate) if (x.r.targetType === "ingredient") ingredientIds.add(x.r.targetId);
  const ingredientName = new Map(
    (ingredientIds.size === 0
      ? []
      : await rt.db
          .select({ id: ingredient.id, name: ingredient.name })
          .from(ingredient)
          .where(inArray(ingredient.id, [...ingredientIds]))
    ).map((i) => [i.id, i.name]),
  );
  const dishName = new Map(
    (dishIds.size === 0
      ? []
      : await rt.db
          .select({ id: dish.id, name: dish.name })
          .from(dish)
          .where(inArray(dish.id, [...dishIds]))
    ).map((d) => [d.id, d.name]),
  );
  // Meals now served by a copy: the re-solved meals of each run.
  const copyIds = [...new Set([...copiesOf.values()].flat().map((c) => c.toDishId))];
  const servedByCopy =
    copyIds.length === 0
      ? []
      : await rt.db
          .select({
            id: planMeal.id,
            dishId: planMeal.dishId,
            date: planDay.date,
            slotLabel: slotType.label,
            slotOrder: slotType.sortOrder,
          })
          .from(planMeal)
          .innerJoin(planDay, eq(planDay.id, planMeal.planDayId))
          .innerJoin(slotType, eq(slotType.id, planMeal.slotTypeId))
          .where(and(eq(planMeal.householdId, hh), inArray(planMeal.dishId, copyIds)))
          .orderBy(asc(planDay.date), asc(slotType.sortOrder));

  return {
    flags: ofDate.map(({ r, authorName }) => {
      const j = jobOf.get(r.id);
      const rep = j === undefined ? undefined : reports.get(j.id);
      const copies = j === undefined ? [] : (copiesOf.get(j.id) ?? []);
      const fromOf = new Map(copies.map((c) => [c.toDishId, c.fromDishId]));
      const substituteId = rep === undefined ? null : str(rep.substituteId);
      return {
        reviewId: r.id,
        kind: r.tags.includes("ingredient_unavailable")
          ? ("unavailable" as const)
          : ("unclear" as const),
        ingredientId: r.targetType === "ingredient" ? r.targetId : null,
        ingredientName:
          r.targetType === "ingredient" ? (ingredientName.get(r.targetId) ?? null) : null,
        variantId: r.targetType === "variant" ? r.targetId : null,
        planMealId: r.planMealId,
        note: r.comment,
        authorName,
        createdAt: r.createdAt.toISOString(),
        job:
          j === undefined
            ? null
            : { id: j.id, status: j.status, finishedAt: j.finishedAt?.toISOString() ?? null },
        result:
          rep === undefined
            ? null
            : {
                substituteId,
                substituteName:
                  substituteId === null ? null : (ingredientName.get(substituteId) ?? null),
                changeSetId: str(rep.changeSetId),
                meals: servedByCopy
                  .filter((m) => fromOf.has(m.dishId) && m.date >= date)
                  .map((m) => ({
                    planMealId: m.id,
                    date: m.date,
                    slotLabel: m.slotLabel,
                    fromDishName: dishName.get(fromOf.get(m.dishId) ?? "") ?? "",
                    toDishName: dishName.get(m.dishId) ?? "",
                  })),
                unresolved: (Array.isArray(rep.unresolved) ? rep.unresolved : [])
                  .map(str)
                  .filter((x): x is string => x !== null),
              },
      };
    }),
  };
}
