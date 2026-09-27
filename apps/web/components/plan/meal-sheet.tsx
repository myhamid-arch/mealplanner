"use client";
// A meal of the week plan (WeekPlan "click any meal to see plates, swap or lock it"): its plates
// per person with fit, and for admins lock / unlock and swap (PLN-13). A cell can hold several
// meals: the shared dish and the own dishes of people taken out of it, or one dish per person in
// an individual slot.
import Link from "next/link";
import { useState } from "react";
import { Button, Chip, Icon, Sheet } from "../ui";
import { api, c, problemText, type Member, type MealOverride, type PlanMeal } from "./api";
import { ExtraIconSvg, FitBadge } from "./common";
import { weekdayName } from "./logic";
import { SwapSheet } from "./swap-sheet";

function MealBlock({
  meal,
  members,
  admin,
  editable,
  onChanged,
  onSwap,
}: {
  readonly meal: PlanMeal;
  readonly members: readonly Member[];
  readonly admin: boolean;
  /** Past meals are history: no lock or swap. */
  readonly editable: boolean;
  readonly onChanged: () => void;
  readonly onSwap: (meal: PlanMeal) => void;
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
