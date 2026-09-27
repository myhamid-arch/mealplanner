"use client";
// Swap (PLN-13; SwapDialog.dc.html): the current score, up to five alternatives with their
// Macros / Appeal / Economy bars, "Use this" (the plates are re-solved), and the one-off
// override for this date (R2-MEAL-2): take people out of the shared meal, or make it individual.
// An override re-plans the date (leaf-1.4.4 SPEC-Q-4), which the confirmation says first.
import Link from "next/link";
import { useState } from "react";
import { Button, Chip, Dialog, Sheet } from "../ui";
import {
  api,
  applyChanges,
  c,
  problemText,
  useLoad,
  type Alternatives,
  type Member,
  type MealOverride,
  type PlanMeal,
  type ScoreBreakdown,
} from "./api";
import { LoadError, Loading } from "./common";
import { weekdayName } from "./logic";

function Bar({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <>
      <span>{label}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${String(pct)} out of 100`}
        className="h-2 rounded-[4px] bg-flour"
      >
        <span className={`block h-2 rounded-[4px] ${color}`} style={{ width: `${String(pct)}%` }} />
      </span>
    </>
  );
}

function ScoreBars({ s }: { readonly s: ScoreBreakdown }) {
  return (
    <div className="grid grid-cols-[70px_1fr] items-center gap-x-2.5 gap-y-1 text-xs font-extrabold">
      <Bar label="Macros" value={s.macroFit} color="bg-action" />
      <Bar label="Appeal" value={s.appeal} color="bg-basil" />
      <Bar label="Economy" value={s.economy} color="bg-sea" />
    </div>
  );
}

/** Planner reasons end with a full stop so several read as sentences. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const two = (n: number) => n.toFixed(2).replace(/^0/, "");

function fitLine(
  plates: Alternatives["alternatives"][number]["plates"],
  names: ReadonlyMap<string, string>,
) {
  const targeted = plates.filter((p) => p.fitStatus !== "untargeted");
  const off = targeted.filter((p) => p.fitStatus !== "in_tolerance");
  if (targeted.length === 0) return "Portions for everyone; no targets at this meal.";
  if (off.length === 0) return "Everyone with targets on target.";
  return `Off target: ${off.map((p) => names.get(p.memberId) ?? "someone").join(", ")}.`;
}

export function SwapSheet({
  meal,
  members,
  override,
  open,
  onOpenChange,
  onChanged,
  onReplan,
}: {
  readonly meal: PlanMeal;
  readonly members: readonly Member[];
  readonly override: MealOverride | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** After a swap: reload the plan. */
  readonly onChanged: () => void;
  /** After an override change: re-plan the date. */
  readonly onReplan: (date: string, summary: string) => void;
}) {
  const alts = useLoad(
    () => api.call(c.planMealsAlternatives, { params: { id: meal.id } }),
    open ? meal.id : "",
  );
  const [busy, setBusy] = useState<string | null>(null);
  // SwapDialog: the best alternative is open; the others are rows that open on demand.
  const [expanded, setExpanded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | {
    kind: "split_member" | "make_individual" | "remove";
  }>(null);
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const attendees = meal.attendees
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => m !== undefined);
  const day = weekdayName(meal.date);
  const shared = meal.memberScope === "shared";

  const use = async (dishId: string) => {
    setBusy(dishId);
    setError(null);
    try {
      await api.call(c.planMealsSwap, { params: { id: meal.id }, body: { dishId } });
      onOpenChange(false);
      onChanged();
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(null);
    }
  };

  const applyOverride = async () => {
    if (confirm === null) return;
    setBusy("override");
    setError(null);
    try {
      if (confirm.kind === "remove") {
        await applyChanges(`Remove the one-off change to ${day} ${meal.slotLabel.toLowerCase()}`, [
          {
            kind: "meal_override.remove",
            payload: { planDate: meal.date, slotTypeId: meal.slotTypeId },
          },
        ]);
      } else {
        await applyChanges(
          confirm.kind === "make_individual"
            ? `Make ${day} ${meal.slotLabel.toLowerCase()} individual`
            : `Own dish on ${day} for ${picked.map((id) => names.get(id) ?? "").join(", ")}`,
          [
            {
              kind: "meal_override.set",
              payload: {
                planDate: meal.date,
                slotTypeId: meal.slotTypeId,
                kind: confirm.kind,
                memberIds: confirm.kind === "split_member" ? picked : [],
              },
            },
          ],
        );
      }
      setConfirm(null);
      onOpenChange(false);
      onReplan(meal.date, `Re-planning ${day} with the change`);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={`Swap ${meal.dishName}`}
        description={`${day} ${meal.slotLabel.toLowerCase()} · ${String(meal.attendees.length)} ${meal.attendees.length === 1 ? "person" : "people"}`}
      >
        {error !== null && (
          <p
            role="alert"
            className="m-0 rounded-lg bg-pomegranate-tint px-3 py-2 text-sm font-bold text-pomegranate-text"
          >
            {error}
          </p>
        )}
        {alts.data === null ? (
          alts.error !== null ? (
            <LoadError message={alts.error} onRetry={() => void alts.reload()} />
          ) : (
            <Loading label="Finding alternatives" />
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-flour px-3.5 py-3 text-sm">
              <span className="font-extrabold">Now: {two(alts.data.current.total)}</span>
              <span className="tabular font-mono text-xs">
                macros {two(alts.data.current.macroFit)} · appeal {two(alts.data.current.appeal)} ·
                economy {two(alts.data.current.economy)}
              </span>
              {alts.data.current.reasons[0] !== undefined && (
                <span className="text-ink-muted">{alts.data.current.reasons[0]}</span>
              )}
            </div>
            {alts.data.alternatives.length === 0 ? (
              <p className="m-0 text-sm text-ink-soft">
                No other dish in the library suits this meal for everyone. Ask the assistant for a
                new one.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Alternatives">
                {alts.data.alternatives.map((a, i) =>
                  i === expanded ? (
                    <li
                      key={a.dishId}
                      data-testid="alternative"
                      className={`flex flex-col gap-2 rounded-2xl bg-card p-3.5 ${i === 0 ? "border-[2.5px] border-basil" : "border-[2.5px] border-line-strong"}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="grow font-extrabold" data-testid="alternative-name">
                          {a.dishName}
                        </span>
                        <span
                          className={`tabular font-mono font-extrabold ${i === 0 ? "text-basil-text" : ""}`}
                        >
                          {two(a.scoreBreakdown.total)}
                        </span>
                      </div>
                      <ScoreBars s={a.scoreBreakdown} />
                      <span className="text-[13px] text-ink-soft">
                        {[...a.scoreBreakdown.reasons.slice(0, 2), fitLine(a.plates, names)]
                          .map(sentence)
                          .join(" ")}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          loading={busy === a.dishId}
                          disabled={busy !== null}
                          onClick={() => void use(a.dishId)}
                          aria-label={`Use ${a.dishName}`}
                        >
                          Use this
                        </Button>
                        <Link
                          href={`/recipes/${a.dishId}`}
                          className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-ink px-3.5 font-extrabold text-ink no-underline hover:text-ink"
                        >
                          See recipe
                        </Link>
                      </div>
                    </li>
                  ) : (
                    <li key={a.dishId} data-testid="alternative">
                      <button
                        type="button"
                        aria-expanded={false}
                        onClick={() => {
                          setExpanded(i);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-2xl bg-card p-3.5 text-left text-ink shadow-card hover:bg-flour"
                      >
                        <span className="flex grow flex-col">
                          <span className="font-extrabold" data-testid="alternative-name">
                            {a.dishName}
                          </span>
                          <span className="text-[13px] text-ink-soft">
                            {sentence(fitLine(a.plates, names))}
                          </span>
                        </span>
                        <span className="tabular font-mono font-extrabold">
                          {two(a.scoreBreakdown.total)}
                        </span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </>
        )}
        {shared && (
          <section
            aria-labelledby="override-title"
            className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-dashed border-saffron-text bg-card p-3.5"
          >
            <h3 id="override-title" className="font-body text-base font-extrabold">
              Just this {day}: take someone out of the shared {meal.slotLabel.toLowerCase()}
            </h3>
            <span className="text-[13px] text-ink-soft">
              They get their own dish, planned for them. Everyone else keeps the shared one.
            </span>
            <div role="group" aria-label="People at this meal" className="flex flex-wrap gap-1.5">
              {attendees.map((m) => {
                const on = picked.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id]);
                    }}
                    className={`min-h-11 rounded-full px-3 text-[13px] font-extrabold ${on ? "bg-ink text-paper" : "bg-flour text-ink"}`}
                  >
                    {m.displayName}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={picked.length === 0 || picked.length >= attendees.length || busy !== null}
                onClick={() => {
                  setConfirm({ kind: "split_member" });
                }}
              >
                Give {picked.length === 0 ? "them" : picked.map((id) => names.get(id)).join(", ")}{" "}
                their own dish
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  setConfirm({ kind: "make_individual" });
                }}
              >
                Make the whole meal individual
              </Button>
            </div>
            {override !== null && (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Chip tone="saffron" size="sm">
                  {override.kind === "make_individual"
                    ? "Individual this day"
                    : `Own dish: ${override.memberIds.map((id) => names.get(id) ?? "").join(", ")}`}
                </Chip>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    setConfirm({ kind: "remove" });
                  }}
                >
                  Back to one shared dish
                </Button>
              </div>
            )}
          </section>
        )}
        {!shared && override !== null && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Chip tone="saffron" size="sm">
              One-off change on {day}
            </Chip>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setConfirm({ kind: "remove" });
              }}
            >
              Back to one shared dish
            </Button>
          </div>
        )}
        <section className="mt-auto flex flex-col gap-2 rounded-2xl bg-agent p-3.5 text-on-agent">
          <AskBox />
        </section>
      </Sheet>
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={`Re-plan ${day}?`}
        description={`${day}'s meals that are not locked will be planned again with this change. Locked meals stay as they are.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button loading={busy === "override"} onClick={() => void applyOverride()}>
              Re-plan {day}
            </Button>
          </>
        }
      >
        <p className="m-0 text-sm">
          {confirm?.kind === "make_individual"
            ? `Everyone gets their own ${meal.slotLabel.toLowerCase()} on ${day}.`
            : confirm?.kind === "remove"
              ? `${meal.slotLabel} on ${day} goes back to one shared dish.`
              : `${picked.map((id) => names.get(id) ?? "").join(", ")} get${picked.length === 1 ? "s" : ""} their own dish on ${day}.`}
        </p>
      </Dialog>
    </>
  );
}

/** "None of these? Ask for something" (SwapDialog): opens the assistant with the text (R-53). */
function AskBox() {
  const [text, setText] = useState("");
  return (
    <form
      action="/chat"
      method="get"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        if (text.trim() === "") e.preventDefault();
      }}
    >
      <label htmlFor="swap-ask" className="font-extrabold">
        None of these? Ask for something
      </label>
      <div className="flex gap-2">
        <input
          id="swap-ask"
          name="prompt"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder="Something Italian the kids will love, using chicken"
          className="h-[46px] min-w-0 grow rounded-xl border-0 bg-card px-3 text-ink placeholder:text-ink-muted"
        />
        <button
          type="submit"
          className="h-[46px] rounded-xl bg-badge px-4 font-extrabold text-on-badge"
        >
          Ask
        </button>
      </div>
    </form>
  );
}
