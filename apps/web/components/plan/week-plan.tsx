"use client";
// Week plan (UX-4 Plan; WeekPlan.dc.html). Days × slots at ≥ 1024 px, a day-by-day list below.
// Every slot row is labelled SHARED or INDIVIDUAL, split members are marked "+ Omar: own dish"
// (R2-MEAL-1/2), locked meals carry a lock. The header strip shows distinct ingredients, the share
// of targeted meals on target, and cuisines. Admins plan or regenerate the unlocked meals, send
// days to the kitchen (R-52), and open a meal to swap, lock or change it for one day.
// Drag to move is out of v1 (R-52, W-5).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, EmptyState, Icon } from "../ui";
import {
  api,
  c,
  followJob,
  problemText,
  useLoad,
  type CookSheet,
  type DishSummary,
  type MealOverride,
  type PlanDay,
  type PlanMeal,
  type Schedules,
} from "./api";
import { ExtraIconSvg, LoadError, Loading, loadBasics, type Basics } from "./common";
import {
  addDays,
  cuisineFamily,
  dayMonth,
  minutesOf,
  mondayOf,
  shortDay,
  weekDates,
  weekStats,
  weekdayName,
  weekdayOf,
  type FitStatus,
} from "./logic";
import { MealSheet } from "./meal-sheet";
import { useWide } from "./use-wide";

interface WeekData {
  basics: Basics;
  monday: string;
  dates: string[];
  days: Map<string, PlanDay>;
  sheets: CookSheet[];
  dishes: Map<string, DishSummary>;
  overrides: MealOverride[];
  schedules: Schedules | null;
}

async function loadWeek(week: string | null): Promise<WeekData> {
  const basics = await loadBasics();
  const monday = mondayOf(week ?? basics.today);
  const dates = weekDates(monday);
  const admin = basics.role === "admin";
  const [plans, sheets, dishes, overrides, schedules] = await Promise.all([
    api.call(c.plansList, { query: { from: dates[0] ?? monday, to: dates[6] ?? monday } }),
    Promise.all(dates.map((date) => api.call(c.cookSheetsGet, { params: { date } }))),
    api.call(c.dishesList, { query: {} }),
    admin
      ? api.call(c.mealOverridesList, { query: { from: monday, to: addDays(monday, 6) } })
      : Promise.resolve({ overrides: [] }),
    admin ? api.call(c.schedulesGet, {}) : Promise.resolve(null),
  ]);
  return {
    basics,
    monday,
    dates,
    days: new Map(plans.days.map((d) => [d.date, d])),
    sheets: sheets.filter((s) => s.meals.length > 0),
    dishes: new Map((dishes.dishes ?? []).map((d) => [d.id, d])),
    overrides: overrides.overrides,
    schedules,
  };
}

interface Row {
  slotTypeId: string;
  label: string;
  shared: boolean;
  time: string;
  /** Initials of the people who usually attend. */
  who: string;
}

function rows(data: WeekData): Row[] {
  const seen = new Map<string, Row>();
  const initials = (ids: readonly string[]) =>
    [...new Set(ids)]
      .map((id) => data.basics.members.find((m) => m.id === id)?.displayName.charAt(0) ?? "")
      .filter((x) => x !== "")
      .join(" · ");
  for (const slot of data.basics.slots) {
    const meals = [...data.days.values()].flatMap((d) =>
      d.meals.filter((m) => m.slotTypeId === slot.id),
    );
    if (meals.length === 0) continue;
    const attendees = meals.flatMap((m) => m.attendees);
    const all = data.basics.members.length;
    seen.set(slot.id, {
      slotTypeId: slot.id,
      label: slot.label,
      shared: slot.isShared,
      time: slot.defaultTime,
      who: new Set(attendees).size < all ? initials(attendees) : "",
    });
  }
  return [...seen.values()].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

function isNewAi(d: DishSummary | undefined, monday: string): boolean {
  return d !== undefined && d.source === "ai" && d.createdAt.slice(0, 10) >= addDays(monday, -7);
}

const TONE_BAR: Record<string, string> = {
  tomato: "var(--tomato)",
  sea: "var(--sea)",
  basil: "var(--basil)",
  saffron: "var(--saffron)",
  aubergine: "var(--aubergine)",
  olive: "var(--olive)",
  neutral: "var(--neutral)",
  pomegranate: "var(--pomegranate)",
};

function Cell({
  meals,
  data,
  onOpen,
  compact,
}: {
  readonly meals: readonly PlanMeal[];
  readonly data: WeekData;
  readonly onOpen: () => void;
  readonly compact: boolean;
}) {
  const shared = meals.find((m) => m.memberScope === "shared");
  const name = (id: string) => data.basics.members.find((m) => m.id === id)?.displayName ?? "";
  if (meals.length === 0)
    return (
      <span className="rounded-[10px] bg-flour/60 p-2 text-ink-muted" aria-label="No meal">
        —
      </span>
    );
  const lead = shared ?? meals[0];
  if (lead === undefined) return null;
  const dish = data.dishes.get(lead.dishId);
  const tone = cuisineFamily(dish?.cuisineKey ?? "").tone;
  const own = meals.filter((m) => m.memberScope !== "shared");
  const title =
    shared !== undefined
      ? shared.dishName
      : own.length === 1
        ? `${name(own[0]?.memberScope ?? "")}: ${own[0]?.dishName ?? ""}`
        : `${String(own.length)} dishes`;
  const locked = meals.some((m) => m.locked);
  const worst = meals
    .flatMap((m) => m.plates.map((p) => p.fitStatus))
    .find((s): s is FitStatus => s === "infeasible" || s === "flexible_miss");
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`cell-${lead.date}-${lead.slotKey}`}
      className="flex min-h-11 w-full flex-col items-stretch gap-0.5 rounded-[10px] bg-card p-2 text-left text-ink hover:bg-flour"
      style={{ boxShadow: `inset 0 -4px 0 ${TONE_BAR[tone] ?? "var(--olive)"}` }}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="min-w-0 break-words">
          {title}
          {isNewAi(dish, data.monday) && (
            <span className="ml-1 font-extrabold text-aubergine-text">NEW</span>
          )}
        </span>
        {locked && <Icon name="lock" size={14} strokeWidth={2.5} label="Locked" />}
      </span>
      {shared === undefined && own.length > 1 && !compact && (
        <span className="text-[11px] text-ink-muted">
          {own.map((m) => name(m.memberScope).charAt(0)).join(" · ")}
        </span>
      )}
      {shared !== undefined && shared.splitMembers.length > 0 && (
        <span className="text-[11px] font-extrabold text-saffron-text">
          + {shared.splitMembers.map(name).join(", ")}: own dish
        </span>
      )}
      {worst !== undefined && (
        <span className="text-[11px] font-extrabold text-pomegranate-text">
          {worst === "infeasible" ? "Misses a target" : "Close to target"}
        </span>
      )}
    </button>
  );
}

function kindLabel(shared: boolean) {
  return shared ? (
    <span className="text-[11px] font-extrabold text-sea-text">SHARED</span>
  ) : (
    <span className="text-[11px] font-extrabold text-saffron-text">INDIVIDUAL</span>
  );
}

function mealsAt(data: WeekData, date: string, slotTypeId: string): PlanMeal[] {
  return data.days.get(date)?.meals.filter((m) => m.slotTypeId === slotTypeId) ?? [];
}

/** A cell is individual on a date when it has no shared meal (the slot, or an override). */
function cellShared(meals: readonly PlanMeal[], row: Row): boolean {
  return meals.length === 0 ? row.shared : meals.some((m) => m.memberScope === "shared");
}

function trainingLine(data: WeekData, date: string): string | null {
  if (data.schedules === null) return null;
  const wd = weekdayOf(date);
  const who = data.schedules.training
    .filter((t) => t.weekday === wd)
    .map((t) => data.basics.members.find((m) => m.id === t.memberId)?.displayName.charAt(0))
    .filter((x): x is string => x !== undefined);
  return who.length === 0 ? "rest" : `${who.join(" · ")} trains`;
}

function Grid({
  data,
  onOpen,
}: {
  readonly data: WeekData;
  readonly onOpen: (meals: PlanMeal[]) => void;
}) {
  const rs = rows(data);
  return (
    <div
      role="table"
      aria-label={`Week of ${dayMonth(data.monday)}`}
      className="grid grid-cols-[120px_repeat(7,minmax(0,1fr))] gap-1.5 text-[13px]"
    >
      <div role="row" className="contents">
        <span role="columnheader">
          <span className="sr-only">Meal</span>
        </span>
        {data.dates.map((d) => {
          const t = trainingLine(data, d);
          return (
            <span key={d} role="columnheader" className="p-1.5 font-extrabold">
              {shortDay(d)}
              {d === data.basics.today && <span className="sr-only"> (today)</span>}
              {t !== null && (
                <span
                  className={`block text-[11px] ${t === "rest" ? "text-ink-muted" : "text-sea-text"}`}
                >
                  {t}
                </span>
              )}
            </span>
          );
        })}
      </div>
      {rs.map((r) => (
        <div key={r.slotTypeId} role="row" className="contents">
          <span role="rowheader" className="px-1 py-2 font-extrabold">
            {r.label}
            <br />
            {kindLabel(r.shared)}{" "}
            {r.who !== "" && <span className="text-[11px] text-ink-muted">{r.who}</span>}
          </span>
          {data.dates.map((d) => {
            const meals = mealsAt(data, d, r.slotTypeId);
            return (
              <span key={d} role="cell" className="flex">
                {meals.length > 0 && cellShared(meals, r) !== r.shared && (
                  <span className="sr-only">
                    {cellShared(meals, r) ? "Shared this day. " : "Individual this day. "}
                  </span>
                )}
                <Cell
                  meals={meals}
                  data={data}
                  compact={false}
                  onOpen={() => {
                    onOpen(meals);
                  }}
                />
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DayList({
  data,
  onOpen,
}: {
  readonly data: WeekData;
  readonly onOpen: (meals: PlanMeal[]) => void;
}) {
  const rs = rows(data);
  return (
    <ol
      className="m-0 flex list-none flex-col gap-3 p-0"
      aria-label={`Week of ${dayMonth(data.monday)}`}
    >
      {data.dates.map((d) => {
        const t = trainingLine(data, d);
        const day = data.days.get(d);
        return (
          <li key={d} className="flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-card">
            <h2 className="flex items-baseline gap-2 font-body text-base font-extrabold">
              {weekdayName(d)} {dayMonth(d)}
              {t !== null && (
                <span className={`text-xs ${t === "rest" ? "text-ink-muted" : "text-sea-text"}`}>
                  {t}
                </span>
              )}
            </h2>
            {day === undefined ? (
              <span className="text-sm text-ink-muted">Not planned yet.</span>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {rs.map((r) => {
                  const meals = mealsAt(data, d, r.slotTypeId);
                  if (meals.length === 0) return null;
                  return (
                    <li
                      key={r.slotTypeId}
                      className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 text-[13px]"
                    >
                      <span className="font-extrabold">
                        {r.label}
                        <br />
                        {kindLabel(cellShared(meals, r))}
                      </span>
                      <Cell
                        meals={meals}
                        data={data}
                        compact
                        onOpen={() => {
                          onOpen(meals);
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Stats({ data }: { readonly data: WeekData }) {
  const statuses = [...data.days.values()].flatMap((d) =>
    d.meals.flatMap((m) => m.plates.map((p) => p.fitStatus)),
  );
  const s = weekStats(data.sheets, statuses);
  const newAi = new Set(
    [...data.days.values()]
      .flatMap((d) => d.meals.map((m) => m.dishId))
      .filter((id) => isNewAi(data.dishes.get(id), data.monday)),
  ).size;
  const pill = "rounded-[14px] bg-card px-3.5 py-2.5 text-sm shadow-card";
  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-3 p-0"
      aria-label="This week"
      data-testid="week-stats"
    >
      <li className={pill} data-testid="stat-ingredients">
        <strong className="tabular font-mono">{s.distinctIngredients}</strong> different ingredients
      </li>
      {s.onTargetPct !== null && (
        <li className={pill} data-testid="stat-on-target">
          <strong className="tabular font-mono">{s.onTargetPct}%</strong> targeted meals on target
        </li>
      )}
      <li className={pill} data-testid="stat-cuisines">
        <strong className="tabular font-mono">{s.cuisines}</strong> cuisine
        {s.cuisines === 1 ? "" : "s"}
      </li>
      {newAi > 0 && (
        <li className="rounded-[14px] bg-aubergine-tint px-3.5 py-2.5 text-sm font-extrabold text-aubergine-text">
          {newAi} new AI recipe{newAi === 1 ? "" : "s"} this week
        </li>
      )}
    </ul>
  );
}

function Legend({ data }: { readonly data: WeekData }) {
  const present = new Map<string, string>();
  for (const d of data.days.values())
    for (const m of d.meals) {
      const f = cuisineFamily(data.dishes.get(m.dishId)?.cuisineKey ?? "");
      present.set(f.family, f.tone);
    }
  return (
    <div className="flex flex-wrap items-center gap-3.5 text-[13px] text-ink-soft">
      {[...present].map(([family, tone]) => (
        <span key={family} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-3 rounded-[3px]"
            style={{ background: TONE_BAR[tone] }}
          />
          {family}
        </span>
      ))}
      <span className="lg:ml-auto">Select any meal to see its plates, swap it or lock it.</span>
    </div>
  );
}

/** A new seed per run: "Regenerate" must be able to give a different plan (PLN-11 is seeded). */
function freshSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export function WeekPlanScreen({
  week,
  meal,
}: {
  readonly week: string | null;
  /** A meal to open on load (Today's "Needs you" links). */
  readonly meal: string | null;
}) {
  const loaded = useLoad(() => loadWeek(week), week ?? "");
  const [opened, setOpened] = useState(false);
  const wide = useWide();
  const [open, setOpen] = useState<PlanMeal[] | null>(null);
  const [job, setJob] = useState<{ line: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const reload = loaded.reload;
  useEffect(() => {
    if (opened || meal === null || loaded.data === null) return;
    setOpened(true);
    const m = [...loaded.data.days.values()].flatMap((d) => d.meals).find((x) => x.id === meal);
    if (m !== undefined) setOpen(mealsAt(loaded.data, m.date, m.slotTypeId));
  }, [opened, meal, loaded.data]);

  const runPlan = useCallback(
    async (dates: string[], summary: string) => {
      setMessage(null);
      setJob({ line: summary });
      try {
        const { jobId } = await api.call(c.plansGenerate, { body: { dates, seed: freshSeed() } });
        const end = await followJob(jobId, (line) => {
          setJob({ line });
        });
        setJob(null);
        await reload();
        setMessage(
          end.status === "done"
            ? { text: "The plan is ready.", error: false }
            : { text: end.error ?? "The planner could not finish.", error: true },
        );
      } catch (e) {
        setJob(null);
        setMessage({ text: problemText(e), error: true });
      }
    },
    [reload],
  );

  if (loaded.data === null)
    return loaded.error !== null ? (
      <LoadError message={loaded.error} onRetry={() => void loaded.reload()} />
    ) : (
      <Loading label="Loading the week" />
    );
  const data = loaded.data;
  const admin = data.basics.role === "admin";
  const planned = data.dates.filter((d) => data.days.has(d));
  const future = data.dates.filter((d) => d >= data.basics.today);
  const drafts = planned.filter(
    (d) => data.days.get(d)?.status === "draft" && d >= data.basics.today,
  );
  const status =
    planned.length === 0
      ? null
      : drafts.length > 0
        ? { text: "Draft · not sent to kitchen", tone: "saffron" as const }
        : { text: "Sent to kitchen", tone: "basil" as const };
  const overrideFor = (m: PlanMeal) =>
    data.overrides.find((o) => o.planDate === m.date && o.slotTypeId === m.slotTypeId) ?? null;
  const publish = async () => {
    setMessage(null);
    try {
      for (const d of drafts) await api.call(c.plansPublish, { params: { date: d } });
      await reload();
      setMessage({
        text: `Sent ${String(drafts.length)} day${drafts.length === 1 ? "" : "s"} to the kitchen.`,
        error: false,
      });
    } catch (e) {
      await reload();
      setMessage({ text: problemText(e), error: true });
    }
  };
  const prev = addDays(data.monday, -7);
  const next = addDays(data.monday, 7);
  const navCls =
    "flex size-11 items-center justify-center rounded-md bg-flour text-ink hover:bg-line-strong";
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/plan?week=${prev}`} aria-label="Previous week" className={navCls}>
          <Icon name="chevronLeft" size={18} strokeWidth={2.5} />
        </Link>
        <h1 className="m-0 font-display text-[26px] font-bold lg:text-[30px]">
          Week of {dayMonth(data.monday)}
        </h1>
        <Link href={`/plan?week=${next}`} aria-label="Next week" className={navCls}>
          <Icon name="chevronRight" size={18} strokeWidth={2.5} />
        </Link>
        {status !== null && (
          <span data-testid="week-status">
            <Chip tone={status.tone}>{status.text}</Chip>
          </span>
        )}
        {admin && future.length > 0 && (
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <Button
              variant={planned.length === 0 ? "primary" : "secondary"}
              icon="refresh"
              loading={job !== null}
              disabled={job !== null}
              onClick={() =>
                void runPlan(
                  future,
                  planned.length === 0 ? "Planning the week" : "Planning the unlocked meals again",
                )
              }
            >
              {planned.length === 0 ? "Plan this week" : "Regenerate unlocked"}
            </Button>
            {drafts.length > 0 && (
              <Button disabled={job !== null} onClick={() => void publish()}>
                Send to kitchen
              </Button>
            )}
          </div>
        )}
      </div>
      {job !== null && (
        <p
          role="status"
          className="m-0 flex items-center gap-2 rounded-xl bg-aubergine-tint px-3.5 py-2.5 text-sm font-bold text-aubergine-text"
        >
          <ExtraIconSvg name="scale" size={18} />
          {job.line}…
        </p>
      )}
      {message !== null && (
        <p
          role={message.error ? "alert" : "status"}
          className={`m-0 rounded-xl px-3.5 py-2.5 text-sm font-bold ${message.error ? "bg-pomegranate-tint text-pomegranate-text" : "bg-basil-tint text-basil-text"}`}
        >
          {message.text}
        </p>
      )}
      {planned.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon="plan"
          title="No plan for this week yet"
          description={
            admin
              ? future.length > 0
                ? "Plan it and every meal gets a dish and portions for each person."
                : "This week is over."
              : "An admin of the household plans the week."
          }
        />
      ) : (
        <>
          <Stats data={data} />
          {wide ? <Grid data={data} onOpen={setOpen} /> : <DayList data={data} onOpen={setOpen} />}
          <Legend data={data} />
        </>
      )}
      {open !== null && (
        <MealSheet
          meals={open.map((m) => data.days.get(m.date)?.meals.find((x) => x.id === m.id) ?? m)}
          members={data.basics.members}
          admin={admin}
          editable={(m) => m.date >= data.basics.today}
          overrideFor={overrideFor}
          open
          onOpenChange={(o) => {
            if (!o) setOpen(null);
          }}
          onChanged={() => {
            void reload().then(() => {
              setOpen((cur) => (cur === null ? null : [...cur]));
            });
          }}
          onReplan={(date, summary) => {
            setOpen(null);
            void runPlan([date], summary);
          }}
        />
      )}
    </div>
  );
}
