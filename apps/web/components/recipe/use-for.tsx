"use client";
// "Use for <day> <slot>" (R-53 deferral; BLD-8 R-58, R-60; leaf-1.4.8 SPEC-Q-5): a recipe page
// opened with `?date=YYYY-MM-DD&slot=<slot key>` (optionally `&member=<member id>` for an
// individual meal) offers admins to put this dish on that meal through `planMeals.swap`, which
// re-solves the plates (PLN-13). A dish the planner refuses (exclusions, never-preferences, slot)
// or whose plates cannot meet a strict member's targets (PLN-8, R-60) is refused by the server
// with the reason, which is shown. When the meal cannot be changed, the button is disabled and
// says why.
import Link from "next/link";
import { useState } from "react";
import { Button } from "../ui";
import { api, c, problemText, useLoad, type PlanMeal } from "../plan/api";
import type { Basics } from "../plan/common";
import { mondayOf, weekdayName } from "../plan/logic";

export interface UseForTarget {
  date: string;
  slot: string;
  member: string | null;
}

/** "Wed" from an ISO date (WeekPlan and ChatSidePanel write "Use for Wed dinner"). */
function shortWeekday(date: string): string {
  return weekdayName(date).slice(0, 3);
}

async function loadMeal(target: UseForTarget): Promise<PlanMeal | null> {
  const plans = await api.call(c.plansList, { query: { from: target.date, to: target.date } });
  return (
    plans.days[0]?.meals.find(
      (m) => m.slotKey === target.slot && m.memberScope === (target.member ?? "shared"),
    ) ?? null
  );
}

export function UseFor({
  dishId,
  dishName,
  retired,
  basics,
  target,
}: {
  readonly dishId: string;
  readonly dishName: string;
  readonly retired: boolean;
  readonly basics: Basics;
  readonly target: UseForTarget;
}) {
  const loaded = useLoad(
    () => loadMeal(target),
    `${target.date}|${target.slot}|${target.member ?? ""}`,
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean; mealId?: string } | null>(
    null,
  );
  const slotLabel = (
    basics.slots.find((s) => s.key === target.slot)?.label ?? target.slot.replaceAll("_", " ")
  ).toLowerCase();
  const who =
    target.member === null
      ? ""
      : `${basics.members.find((m) => m.id === target.member)?.displayName ?? "their"}'s `;
  const label = `Use for ${shortWeekday(target.date)} ${who}${slotLabel}`;
  const meal = loaded.data;
  const blocked =
    loaded.loading && meal === null
      ? "Looking up the meal…"
      : loaded.error !== null
        ? loaded.error
        : meal === null
          ? `Nothing is planned for ${weekdayName(target.date)} ${who}${slotLabel} yet.`
          : target.date < basics.today
            ? "That meal is in the past."
            : meal.dishId === dishId
              ? `It is already ${weekdayName(target.date)}'s ${slotLabel}.`
              : meal.locked
                ? "That meal is locked. Unlock it on the plan first."
                : retired
                  ? "This recipe is retired."
                  : null;

  const use = async () => {
    if (meal === null) return;
    setBusy(true);
    setResult(null);
    try {
      await api.call(c.planMealsSwap, { params: { id: meal.id }, body: { dishId } });
      setResult({
        text: `${dishName} is now ${weekdayName(target.date)}'s ${slotLabel}. Plates were re-solved.`,
        error: false,
        mealId: meal.id,
      });
      await loaded.reload();
    } catch (e) {
      setResult({ text: problemText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="use-for">
      <Button
        icon="plan"
        loading={busy}
        disabled={blocked !== null}
        aria-describedby={blocked === null ? undefined : "use-for-why"}
        onClick={() => void use()}
      >
        {label}
      </Button>
      {blocked !== null && result === null && (
        <span id="use-for-why" className="max-w-[320px] text-xs text-ink-muted">
          {blocked}
        </span>
      )}
      {result !== null && (
        <p
          role={result.error ? "alert" : "status"}
          className={`m-0 max-w-[360px] rounded-xl px-3 py-2 text-sm font-bold ${result.error ? "bg-pomegranate-tint text-pomegranate-text" : "bg-basil-tint text-basil-text"}`}
        >
          {result.text}{" "}
          {result.mealId !== undefined && (
            <Link
              href={`/plan?week=${mondayOf(target.date)}&meal=${result.mealId}`}
              className="underline"
            >
              See the plan
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
