"use client";
// A meal of the week plan (WeekPlan "click any meal to see plates, swap, lock, or move it"): its
// plates per person with fit and, where the viewer may read targets, the plate's calories of the
// day target (W-7: the day kind's profile, never a sum of plate targets); for admins lock / unlock,
// swap (PLN-13) and "Move to…" (UX-4, R-58). A cell can hold several meals: the shared dish and
// the own dishes of people taken out of it, or one dish per person in an individual slot.
import Link from "next/link";
import { useState } from "react";
import { Button, Chip, Icon, Sheet } from "../ui";
import { api, c, problemText, type Member, type MealOverride, type PlanMeal } from "./api";
import { ExtraIconSvg, FitBadge } from "./common";
import { num, weekdayName, type MoveOption } from "./logic";
import { MoveMenu } from "./move-menu";
import { SwapSheet } from "./swap-sheet";

/** The Move menu's days for a meal, or why it cannot move (from the week plan). */
export type MoveOf = (meal: PlanMeal) => { options: MoveOption[]; blocked: string | null };
/** A member's day target for a date (W-7), or null when the viewer may not read it. */
export type DayTargetOf = (
  memberId: string,
  date: string,
) => { kcal: number; label: string } | null;

function MealBlock({
  meal,
  members,
  admin,
  editable,
  onChanged,
  onSwap,
  moveOf,
  onMoved,
  dayTargetOf,
}: {
  readonly meal: PlanMeal;
  readonly members: readonly Member[];
  readonly admin: boolean;
  /** Past meals are history: no lock or swap. */
  readonly editable: boolean;
  readonly onChanged: () => void;
  readonly onSwap: (meal: PlanMeal) => void;
  readonly moveOf?: MoveOf;
  readonly onMoved?: (text: string) => void;
  readonly dayTargetOf?: DayTargetOf;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => members.find((m) => m.id === id)?.displayName ?? "Someone";
  const who = meal.memberScope === "shared" ? "Shared" : `${name(meal.memberScope)}'s own dish`;
  const toggleLock = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.call(meal.locked ? c.planMealsUnlock : c.planMealsLock, {
        params: { id: meal.id },
      });
      onChanged();
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label={`${who}: ${meal.dishName}`}
      className="flex flex-col gap-2.5 rounded-2xl bg-card p-3.5 shadow-card"
      data-testid="meal-block"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grow">
          <span className="block text-xs font-extrabold text-ink-muted uppercase">{who}</span>
          <span className="block font-extrabold" data-testid="meal-dish">
            {meal.dishName}
          </span>
        </span>
        {meal.locked && (
          <Chip size="sm" icon="lock">
            Locked
          </Chip>
        )}
        {meal.status !== "planned" && (
          <Chip size="sm" tone="basil">
            {meal.status}
          </Chip>
        )}
      </div>
      {meal.plates.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Plates">
          {meal.plates.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/today/plates/${p.id}`} className="grow font-bold">
                {name(p.memberId)}
              </Link>
              {p.target !== null && dayTargetOf?.(p.memberId, meal.date) != null && (
                <span className="tabular font-mono text-xs text-ink-soft" data-testid="day-target">
                  {num(p.target.kcal)} of {num(dayTargetOf(p.memberId, meal.date)?.kcal ?? 0)} kcal
                  today
                </span>
              )}
              <FitBadge status={p.fitStatus} />
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
      {admin && editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy} onClick={() => void toggleLock()}>
            {meal.locked ? (
              <ExtraIconSvg name="unlock" size={18} />
            ) : (
              <Icon name="lock" size={18} />
            )}
            {meal.locked ? "Unlock" : "Lock"}
          </Button>
          <Button
            icon="refresh"
            disabled={meal.locked}
            onClick={() => {
              onSwap(meal);
            }}
          >
            Swap
          </Button>
        </div>
      )}
      {admin && editable && moveOf !== undefined && onMoved !== undefined && (
        <MoveMenu
          meal={meal}
          options={moveOf(meal).options}
          blockedReason={moveOf(meal).blocked}
          onMoved={onMoved}
        />
      )}
      <Link
        href={`/recipes/${meal.dishId}`}
        className="inline-flex min-h-11 items-center self-start font-extrabold"
      >
        See the recipe
      </Link>
    </section>
  );
}

export function MealSheet({
  meals,
  members,
  admin,
  editable,
  overrideFor,
  open,
  onOpenChange,
  onChanged,
  onReplan,
  moveOf,
  onMoved,
  dayTargetOf,
}: {
  readonly meals: readonly PlanMeal[];
  readonly members: readonly Member[];
  readonly admin: boolean;
  readonly editable: (meal: PlanMeal) => boolean;
  readonly overrideFor: (meal: PlanMeal) => MealOverride | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChanged: () => void;
  readonly onReplan: (date: string, summary: string) => void;
  readonly moveOf?: MoveOf;
  /** A meal moved: the sheet closes and the week says what happened. */
  readonly onMoved?: (text: string) => void;
  readonly dayTargetOf?: DayTargetOf;
}) {
  const [swapping, setSwapping] = useState<PlanMeal | null>(null);
  const first = meals[0];
  if (first === undefined) return null;
  const title = `${weekdayName(first.date)} ${first.slotLabel.toLowerCase()}`;
  const shared = meals.find((m) => m.memberScope === "shared");
  return (
    <>
      <Sheet
        open={open && swapping === null}
        onOpenChange={onOpenChange}
        title={title}
        description={
          shared !== undefined
            ? `Shared by ${String(shared.attendees.length - shared.splitMembers.length)}${
                shared.splitMembers.length > 0
                  ? `; ${String(shared.splitMembers.length)} with their own dish`
                  : ""
              }`
            : `${String(meals.length)} individual dish${meals.length === 1 ? "" : "es"}`
        }
      >
        {meals.map((m) => (
          <MealBlock
            key={m.id}
            meal={m}
            members={members}
            admin={admin}
            editable={editable(m)}
            onChanged={onChanged}
            onSwap={setSwapping}
            {...(moveOf === undefined ? {} : { moveOf })}
            {...(onMoved === undefined ? {} : { onMoved })}
            {...(dayTargetOf === undefined ? {} : { dayTargetOf })}
          />
        ))}
        {admin && editable(first) && shared === undefined && overrideFor(first) !== null && (
          <Button
            variant="ghost"
            onClick={() => {
              setSwapping(first);
            }}
          >
            One-off change on {weekdayName(first.date)}
          </Button>
        )}
      </Sheet>
      {swapping !== null && (
        <SwapSheet
          meal={swapping}
          members={members}
          override={overrideFor(swapping)}
          open
          onOpenChange={(o) => {
            if (!o) setSwapping(null);
          }}
          onChanged={() => {
            setSwapping(null);
            onChanged();
          }}
          onReplan={(date, summary) => {
            setSwapping(null);
            onOpenChange(false);
            onReplan(date, summary);
          }}
        />
      )}
    </>
  );
}
