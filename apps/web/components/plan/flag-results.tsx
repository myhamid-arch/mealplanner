"use client";
// R2-UX-1 admin view (TodayDesktop "Kitchen" card): each kitchen flag of the day with what the
// planner did about it: the substitute, every meal it changed ("Dinner: X → X (with Y)") and the
// re-checked plates. Reads GET /cook-sheets/{date}/flags (BLD-8 R-52).
import Link from "next/link";
import { Card } from "../ui";
import { hhmm, dayMonth } from "./logic";
import type { KitchenFlagView, PlanMeal } from "./api";
import { ExtraIconSvg, FitText } from "./common";

function when(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return hhmm(iso.slice(11, 19));
  }
}

/** One flag and its outcome, as a list item. */
export function FlagOutcome({
  flag,
  mealsById,
  timeZone,
  date,
}: {
  readonly flag: KitchenFlagView;
  readonly mealsById: ReadonlyMap<string, PlanMeal>;
  readonly timeZone: string;
  readonly date: string;
}) {
  const what =
    flag.kind === "unavailable"
      ? `No ${flag.ingredientName ?? "ingredient"} today`
      : "Recipe unclear";
  const note = flag.note === null ? "" : ` “${flag.note}”`;
  const result = flag.result;
  const running =
    flag.kind === "unavailable" &&
    (flag.job === null || flag.job.status === "queued" || flag.job.status === "running");
  const failed =
    flag.job !== null && (flag.job.status === "failed" || flag.job.status === "cancelled");
  return (
    <li className="flex flex-col gap-1.5 border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <span className="flex items-start gap-2 text-sm font-bold text-pomegranate-text">
        <ExtraIconSvg name="flag" size={16} className="mt-0.5 shrink-0" />
        <span>
          Flag from {flag.authorName} at {when(flag.createdAt, timeZone)}: {what}.{note}
        </span>
      </span>
      {flag.kind === "unclear" && (
        <span className="text-sm text-ink-soft">
          The assistant will look at the recipe with this note.
        </span>
      )}
      {running && (
        <span role="status" className="text-sm text-ink-soft">
          Looking for a substitute and re-checking the plates…
        </span>
      )}
      {failed && (
        <span className="text-sm text-ink-soft">
          The substitution did not run. The meals are unchanged; swap them in the plan.
        </span>
      )}
      {result !== null && result.meals.length === 0 && result.unresolved.length === 0 && (
        <span className="text-sm text-ink-soft">
          No planned meal from {dayMonth(date)} on uses it. Nothing to change.
        </span>
      )}
      {result !== null && result.meals.length > 0 && (
        <div className="flex flex-col gap-1 text-sm text-ink-soft" data-testid="substitution">
          <span>
            Using <strong className="text-ink">{result.substituteName ?? "a substitute"}</strong>{" "}
            instead. Macros re-checked:
          </span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {result.meals.map((m) => {
              const meal = mealsById.get(m.planMealId);
              const statuses = meal?.plates.map((p) => p.fitStatus) ?? [];
              const targeted = statuses.filter((s) => s !== "untargeted");
              const worst = targeted.includes("infeasible")
                ? "infeasible"
                : targeted.includes("flexible_miss")
                  ? "flexible_miss"
                  : targeted.length > 0
                    ? "in_tolerance"
                    : null;
              return (
                <li key={m.planMealId} className="flex flex-wrap items-center gap-x-2">
                  <span>
                    {m.date === date ? "" : `${dayMonth(m.date)} `}
                    {m.slotLabel}: {m.fromDishName} →{" "}
                    <strong className="text-ink">{m.toDishName}</strong>
                  </span>
                  {worst !== null && <FitText status={worst} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {result !== null && result.unresolved.length > 0 && (
        <span className="text-sm font-bold text-pomegranate-text">
          No substitute worked for {result.unresolved.length} meal
          {result.unresolved.length === 1 ? "" : "s"}. <Link href="/plan">Swap in the plan</Link>
        </span>
      )}
    </li>
  );
}

/** The Kitchen card: meals marked cooked and the day's flags with their outcome. */
export function KitchenCard({
  flags,
  meals,
  timeZone,
  date,
}: {
  readonly flags: readonly KitchenFlagView[];
  readonly meals: readonly PlanMeal[];
  readonly timeZone: string;
  readonly date: string;
}) {
  const mealsById = new Map(meals.map((m) => [m.id, m]));
  const cooked = meals.filter((m) => m.status === "cooked");
  return (
    <Card
      as="section"
      aria-labelledby="kitchen-card-title"
      className="flex flex-col gap-2 p-[18px]"
    >
      <h2 id="kitchen-card-title" className="font-body text-base font-extrabold">
        Kitchen
      </h2>
      {cooked.length > 0 && (
        <span className="text-sm text-ink-soft">
          Cooked: {cooked.map((m) => m.slotLabel.toLowerCase()).join(", ")}.
        </span>
      )}
      {flags.length === 0 ? (
        cooked.length === 0 && (
          <span className="text-sm text-ink-soft">No flags from the kitchen.</span>
        )
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Kitchen flags">
          {flags.map((f) => (
            <FlagOutcome
              key={f.reviewId}
              flag={f}
              mealsById={mealsById}
              timeZone={timeZone}
              date={date}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
