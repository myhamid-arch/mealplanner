"use client";
// "Move to…" (UX-4 move, UX-6 keyboard path; BLD-8 R-58; leaf-1.4.8 SPEC-Q-7): a disclosure in
// the meal sheet listing the week's other days for this meal's slot. Each day says what happens
// ("Move here", "Swap with <dish>") or why it cannot ("Already sent to the kitchen"). Choosing a
// day calls `POST /plan-meals/{id}/move`; the result or the server's reason is announced.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui";
import { api, c, problemText, type PlanMeal } from "./api";
import { mediumDay, type MoveOption } from "./logic";

export function MoveMenu({
  meal,
  options,
  blockedReason,
  onMoved,
}: {
  readonly meal: PlanMeal;
  readonly options: readonly MoveOption[];
  /** Why this meal cannot be moved at all, or null. */
  readonly blockedReason: string | null;
  readonly onMoved: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    if (next !== undefined) {
      e.preventDefault();
      next.focus();
    }
  };
  const choose = async (o: MoveOption) => {
    setBusy(o.date);
    setError(null);
    try {
      await api.call(c.planMealsMove, { params: { id: meal.id }, body: { toDate: o.date } });
      setOpen(false);
      onMoved(
        o.kind === "swap"
          ? `${meal.dishName} is now on ${mediumDay(o.date)}; ${o.occupant ?? "the other meal"} moved to ${mediumDay(meal.date)}.`
          : `${meal.dishName} moved to ${mediumDay(o.date)}.`,
      );
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={root} className="flex flex-col gap-2" onKeyDown={onKey}>
      <Button
        variant="secondary"
        icon="arrowRight"
        disabled={blockedReason !== null}
        aria-expanded={open}
        aria-controls={listId}
        title={blockedReason ?? undefined}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        Move to…
      </Button>
      {blockedReason !== null && (
        <span className="text-xs text-ink-muted">Can’t move: {blockedReason}</span>
      )}
      {open && (
        <ul
          id={listId}
          ref={list}
          aria-label={`Move ${meal.dishName} to`}
          className="m-0 flex list-none flex-col gap-1 rounded-xl bg-flour/60 p-1.5"
        >
          {options.length === 0 && (
            <li className="px-2 py-2 text-sm text-ink-muted">No other day this week.</li>
          )}
          {options.map((o) => (
            <li key={o.date}>
              <button
                type="button"
                disabled={o.kind === "blocked" || busy !== null}
                aria-describedby={o.reason === null ? undefined : `${listId}-${o.date}`}
                data-testid={`move-to-${o.date}`}
                onClick={() => void choose(o)}
                className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm hover:bg-card disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="font-extrabold">{mediumDay(o.date)}</span>
                <span
                  id={`${listId}-${o.date}`}
                  className={o.kind === "blocked" ? "text-ink-muted" : "text-ink-soft"}
                >
                  {busy === o.date
                    ? "Moving…"
                    : o.kind === "move"
                      ? "Move here"
                      : o.kind === "swap"
                        ? `Swap with ${o.occupant ?? "the meal there"}`
                        : o.reason}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
    </div>
  );
}
