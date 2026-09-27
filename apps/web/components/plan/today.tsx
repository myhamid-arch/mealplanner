"use client";
// Today (UX-4; TodayPhone.dc.html, TodayDesktop.dc.html). Phones and members: the viewer's own
// meals of the day in time order, with the day ring against the day's target (R-28: kcal ±50 a
// day, carbs total). Admins at ≥ 1024 px: the household's day, the person × slot fit table, and
// what needs them (proposals, a plan to send, kitchen flags and their outcome, R2-UX-1).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isAvatarColor } from "@mealplanner/ui-tokens/tokens";
import { Avatar, Card, Chip, EmptyState, Icon, LinkButton, MacroRing } from "../ui";
import { DishArt } from "../recipe/dish-art";
import {
  api,
  c,
  useLoad,
  type Dish,
  type KitchenFlagView,
  type PlanDay,
  type PlanMeal,
  type Plate,
  type Proposal,
  type Review,
  type Targets,
} from "./api";
import { FitText, LoadError, Loading, cuisineLabel, loadBasics, type Basics } from "./common";
import { KitchenCard } from "./flag-results";
import {
  addDays,
  fitLook,
  fitSummary,
  hhmm,
  localMinutes,
  longDay,
  weekdayName,
  macroLine,
  macrosOf,
  mediumDay,
  minutesOf,
  num,
  sumMacros,
  type FitStatus,
  type MacroValues,
} from "./logic";
import { plateSummary } from "./plate-summary";
import { useWide } from "./use-wide";

interface TodayData {
  basics: Basics;
  day: PlanDay | null;
  dishes: Map<string, Dish>;
  targets: Targets | null;
  flags: KitchenFlagView[];
  proposals: Proposal[];
  reviews: Review[];
  /** The next day's plan (admins: "ready to send to the kitchen"). */
  nextDay: PlanDay | null;
}

async function loadToday(date: string | null): Promise<TodayData> {
  const basics = await loadBasics();
  const on = date ?? basics.today;
  const admin = basics.role === "admin";
  const [plans, targets, flags, proposals, reviews, next] = await Promise.all([
    api.call(c.plansList, { query: { from: on, to: on } }),
    basics.role === "kitchen" ? Promise.resolve(null) : api.call(c.targetsList, {}),
    admin
      ? api.call(c.cookSheetsFlags, { params: { date: on } }).then((r) => r.flags)
      : Promise.resolve([]),
    admin
      ? api.call(c.proposalsList, { query: { status: "pending" } }).then((r) => r.proposals ?? [])
      : Promise.resolve([]),
    basics.role === "kitchen"
      ? Promise.resolve([])
      : api
          .call(c.reviewsList, { query: { targetType: "plan_meal", limit: 200 } })
          .then((r) => r.reviews ?? []),
    admin
      ? api.call(c.plansList, { query: { from: addDays(on, 1), to: addDays(on, 1) } })
      : Promise.resolve({ days: [] }),
  ]);
  const day = plans.days[0] ?? null;
  const dishIds = [...new Set((day?.meals ?? []).map((m) => m.dishId))];
  const dishes = new Map(
    (await Promise.all(dishIds.map((id) => api.call(c.dishesGet, { params: { id } })))).map((d) => [
      d.id,
      d,
    ]),
  );
  return {
    basics,
    day,
    dishes,
    targets,
    flags,
    proposals,
    reviews,
    nextDay: next.days[0] ?? null,
  };
}

function plateMacros(p: Plate): MacroValues | null {
  return p.actual === null ? null : macrosOf(p.actual, p.target?.carbBasis ?? "total");
}

/** The viewer's day: plates in time order, totals, and the day target (sum of slot targets). */
function myDay(day: PlanDay | null, memberId: string | null) {
  const rows: Array<{ meal: PlanMeal; plate: Plate }> = [];
  for (const meal of day?.meals ?? []) {
    const plate = meal.plates.find((p) => p.memberId === memberId);
    if (plate !== undefined) rows.push({ meal, plate });
  }
  rows.sort((a, b) => minutesOf(a.meal.time) - minutesOf(b.meal.time));
  const actual = sumMacros(rows.map((r) => plateMacros(r.plate)).filter((m) => m !== null));
  const targeted = rows.filter((r) => r.plate.target !== null);
  const target =
    targeted.length === 0
      ? null
      : sumMacros(
          targeted.map((r) => ({
            kcal: r.plate.target?.kcal ?? 0,
            protein: r.plate.target?.protein ?? 0,
            carbs: r.plate.target?.carbs ?? 0,
            fat: r.plate.target?.fat ?? 0,
          })),
        );
  const statuses = rows.map((r) => r.plate.fitStatus);
  return { rows, actual, target, statuses };
}

function dayFit(statuses: readonly FitStatus[]): FitStatus {
  const targeted = statuses.filter((s) => s !== "untargeted");
  if (targeted.length === 0) return "untargeted";
  if (targeted.includes("infeasible")) return "infeasible";
  if (targeted.includes("flexible_miss")) return "flexible_miss";
  return "in_tolerance";
}

function DayNav({ date, today }: { readonly date: string; readonly today: string }) {
  const href = (d: string) => (d === today ? "/today" : `/today?date=${d}`);
  const cls =
    "flex size-11 items-center justify-center rounded-md bg-flour text-ink hover:bg-line-strong";
  return (
    <>
      <Link href={href(addDays(date, -1))} aria-label="Previous day" className={cls}>
        <Icon name="chevronLeft" size={18} strokeWidth={2.5} />
      </Link>
      <Link href={href(addDays(date, 1))} aria-label="Next day" className={cls}>
        <Icon name="chevronRight" size={18} strokeWidth={2.5} />
      </Link>
    </>
  );
}

function NoPlan({ basics, date }: { readonly basics: Basics; readonly date: string }) {
  return (
    <EmptyState
      headingLevel={2}
      icon="plan"
      title={`No plan for ${date === basics.today ? "today" : mediumDay(date)} yet`}
      description={
        basics.role === "admin"
          ? "Plan the week and every meal gets a dish and portions for each person."
          : "An admin of the household plans the week. Ask them, or check back later."
      }
      action={
        basics.role === "admin" ? (
          <LinkButton href={`/plan?week=${date}`}>Plan it</LinkButton>
        ) : undefined
      }
    />
  );
}

// Phone / member layout (TodayPhone) ---------------------------------------------------------------

function SlotCard({
  meal,
  plate,
  dish,
  state,
  rated,
}: {
  readonly meal: PlanMeal;
  readonly plate: Plate;
  readonly dish: Dish | undefined;
  readonly state: "eaten" | "next" | "later";
  readonly rated: boolean;
}) {
  const m = plateMacros(plate);
  const scope = meal.kind === "individual" || meal.memberScope !== "shared" ? "just for you" : null;
  const stateText = state === "eaten" ? "eaten" : state === "next" ? "up next" : scope;
  const eyebrow = [meal.slotLabel, hhmm(meal.time), stateText].filter(Boolean).join(" · ");
  const art = (
    <DishArt
      dishId={meal.dishId}
      cuisineKey={dish?.cuisineKey ?? ""}
      className="size-[54px] rounded-[14px]"
    />
  );
  const look = fitLook(plate.fitStatus);
  const body = (
    <span className="flex min-w-0 grow flex-col">
      <span
        className={`text-xs font-extrabold ${state === "next" ? "text-tomato-text" : "text-ink-muted"}`}
      >
        {eyebrow}
      </span>
      <span className="font-extrabold">{meal.dishName}</span>
      {m !== null && (
        <span className="tabular font-mono text-xs text-ink-soft">{macroLine(m)}</span>
      )}
    </span>
  );
  const href = `/today/plates/${plate.id}`;
  if (state === "next")
    return (
      <Link
        href={href}
        className="flex flex-col gap-2.5 rounded-[18px] border-[2.5px] border-action bg-card p-3 text-ink no-underline hover:text-ink"
        data-testid="slot-card"
      >
        <span className="flex items-center gap-3">
          {art}
          {body}
          <Icon name="chevronRight" size={22} strokeWidth={2.5} />
        </span>
        {dish !== undefined && (
          <span className="text-[13px] text-ink-soft">Your plate: {plateSummary(plate, dish)}</span>
        )}
      </Link>
    );
  return (
    <div
      className={`flex items-center gap-3 rounded-[18px] bg-card p-3 shadow-card ${rated ? "opacity-85" : ""}`}
      data-testid="slot-card"
    >
      <Link
        href={href}
        className="flex min-w-0 grow items-center gap-3 text-ink no-underline hover:text-ink"
      >
        {art}
        {body}
      </Link>
      {rated ? (
        <Chip tone="basil" size="sm" icon="check">
          Rated
        </Chip>
      ) : state === "eaten" ? (
        <LinkButton href={`/reviews/rate?planMealId=${meal.id}`} className="shrink-0">
          Rate
        </LinkButton>
      ) : (
        <span className="shrink-0">
          <Icon name={look.icon} size={22} strokeWidth={2.5} label={look.label} />
        </span>
      )}
    </div>
  );
}

function TodayPhone({ data, date }: { readonly data: TodayData; readonly date: string }) {
  const { basics, day } = data;
  const mine = myDay(day, basics.memberId);
  const firstName = basics.me.user.name.split(" ")[0] ?? basics.me.user.name;
  const now = date === basics.today ? localMinutes(new Date(), basics.household.timezone) : null;
  const past = date < basics.today;
  let nextFound = false;
  const states = mine.rows.map((r) => {
    if (past || (now !== null && minutesOf(r.meal.time) + 60 <= now)) return "eaten" as const;
    if (!nextFound && (now !== null || date > basics.today)) {
      nextFound = true;
      return "next" as const;
    }
    return "later" as const;
  });
  const fit = dayFit(mine.statuses);
  const tol = data.targets?.tolerances.find((t) => t.memberId === basics.memberId);
  const ring =
    mine.target === null ? null : (
      <MacroRing
        fit={fit}
        size={64}
        macros={{ protein: mine.actual.protein, carbs: mine.actual.carbs, fat: mine.actual.fat }}
        targetKcal={mine.target.kcal}
        label={`Day total ${String(Math.round(mine.actual.kcal))} of ${String(
          Math.round(mine.target.kcal),
        )} kcal, ${fitLook(fit).label.toLowerCase()}${tol === undefined ? "" : `, band plus or minus ${String(tol.kcal)} a day`}`}
      >
        <span className="tabular font-mono text-xs">{Math.round(mine.actual.kcal)}</span>
      </MacroRing>
    );
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 grow flex-col">
          <span className="text-[13px] font-extrabold text-ink-muted">{mediumDay(date)}</span>
          <h1 className="m-0 font-display text-[28px] font-bold">Hi {firstName}</h1>
        </div>
        <DayNav date={date} today={basics.today} />
        {ring}
      </div>
      {mine.target !== null && (
        <div className="grid grid-cols-3 gap-2 font-mono text-xs" aria-label="Day against target">
          <span className="rounded-[10px] bg-sea-tint p-2 text-center text-sea-text">
            P {Math.round(mine.actual.protein)}/{Math.round(mine.target.protein)}
          </span>
          <span
            className="rounded-[10px] bg-saffron-tint p-2 text-center text-saffron-text"
            aria-label={`Carbs, total: ${String(Math.round(mine.actual.carbs))} of ${String(Math.round(mine.target.carbs))} g`}
          >
            C {Math.round(mine.actual.carbs)}/{Math.round(mine.target.carbs)}
          </span>
          <span className="rounded-[10px] bg-olive-tint p-2 text-center text-olive-text">
            F {Math.round(mine.actual.fat)}/{Math.round(mine.target.fat)}
          </span>
        </div>
      )}
      {mine.rows.length === 0 ? (
        day === null ? (
          <NoPlan basics={basics} date={date} />
        ) : (
          <HouseholdMeals data={data} />
        )
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Your meals">
          {mine.rows.map((r, i) => (
            <li key={r.meal.id}>
              <SlotCard
                meal={r.meal}
                plate={r.plate}
                dish={data.dishes.get(r.meal.dishId)}
                state={states[i] ?? "later"}
                rated={data.reviews.some(
                  (rv) =>
                    rv.authorUserId === basics.me.user.id &&
                    rv.parentReviewId === null &&
                    rv.targetId === r.meal.id,
                )}
              />
            </li>
          ))}
        </ul>
      )}
      {mine.target !== null && <DayGoals data={data} actual={mine} />}
      {basics.role === "admin" && day !== null && (
        <KitchenCard
          flags={data.flags}
          meals={day.meals}
          timeZone={basics.household.timezone}
          date={date}
        />
      )}
    </div>
  );
}

/** R-28 day goals: saturated-fat cap (own, else 6 % of energy) and fibre (14 g / 1,000 kcal). */
function DayGoals({
  data,
  actual,
}: {
  readonly data: TodayData;
  readonly actual: ReturnType<typeof myDay>;
}) {
  const kcal = actual.target?.kcal ?? 0;
  const profile = data.targets?.targets.find(
    (t) => t.memberId === data.basics.memberId && t.kind === "default",
  );
  const pct = data.basics.household.satFatDefaultPct;
  const cap = profile?.satFatMaxG ?? (kcal * pct) / 100 / 9;
  const fibreGoal = profile?.fibreMinG ?? (kcal / 1000) * 14;
  const solubleGoal = profile?.solubleFibreMinG ?? fibreGoal * 0.25;
  const sat = actual.rows.reduce((s, r) => s + (r.plate.actual?.satFat ?? 0), 0);
  const fibre = actual.rows.reduce((s, r) => s + (r.plate.actual?.fibre ?? 0), 0);
  const solubleKnown = actual.rows.every((r) => r.plate.actual?.solubleFibre !== null);
  const soluble = actual.rows.reduce((s, r) => s + (r.plate.actual?.solubleFibre ?? 0), 0);
  return (
    <p className="m-0 font-mono text-[13px] text-ink-soft">
      Sat fat {num(sat)} g (cap {num(cap)}) · Fibre {num(fibre)} g (goal {num(fibreGoal)}) · Soluble{" "}
      {solubleKnown ? `${num(soluble)} g` : "unknown"} (goal {num(solubleGoal)})
    </p>
  );
}

/** A login without its own plates (e.g. an admin who does not eat): the household's meals. */
function HouseholdMeals({ data }: { readonly data: TodayData }) {
  const meals = [...(data.day?.meals ?? [])].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Meals today">
      {meals.map((m) => (
        <li key={m.id}>
          <Card className="flex items-center gap-3 p-3">
            <DishArt
              dishId={m.dishId}
              cuisineKey={data.dishes.get(m.dishId)?.cuisineKey ?? ""}
              className="size-[54px] rounded-[14px]"
            />
            <span className="flex flex-col">
              <span className="text-xs font-extrabold text-ink-muted">
                {m.slotLabel} · {hhmm(m.time)}
              </span>
              <span className="font-extrabold">{m.dishName}</span>
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// Admin desktop layout (TodayDesktop) --------------------------------------------------------------

interface SlotColumn {
  slotTypeId: string;
  label: string;
  time: string;
  meals: PlanMeal[];
}

function columns(day: PlanDay): SlotColumn[] {
  const bySlot = new Map<string, SlotColumn>();
  for (const m of day.meals) {
    const col = bySlot.get(m.slotTypeId) ?? {
      slotTypeId: m.slotTypeId,
      label: m.slotLabel,
      time: m.time,
      meals: [],
    };
    col.meals.push(m);
    bySlot.set(m.slotTypeId, col);
  }
  return [...bySlot.values()].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

function SlotTile({
  col,
  data,
  highlight,
}: {
  readonly col: SlotColumn;
  readonly data: TodayData;
  readonly highlight: boolean;
}) {
  const shared = col.meals.find((m) => m.memberScope === "shared");
  const own = col.meals.filter((m) => m.memberScope !== "shared");
  const dish = shared === undefined ? undefined : data.dishes.get(shared.dishId);
  const cooked = col.meals.every((m) => m.status === "cooked");
  const variants = shared === undefined || dish === undefined ? null : variantMix(shared, dish);
  const status = cooked ? "cooked" : shared === undefined ? "per person" : null;
  const title = shared?.dishName ?? `${String(own.length)} different ${col.label.toLowerCase()}s`;
  const sub =
    shared !== undefined
      ? [cuisineLabel(data.basics, data.dishes.get(shared.dishId)?.cuisineKey), variants]
          .filter(Boolean)
          .join(" · ")
      : summariseNames(own.map((m) => m.dishName));
  const content = (
    <>
      <span
        className={`text-xs font-extrabold uppercase ${highlight ? "text-tomato-text" : "text-ink-muted"}`}
      >
        {col.label} {hhmm(col.time)}
        {status === null ? "" : ` · ${status}`}
      </span>
      <DishArt
        dishId={shared?.dishId ?? own[0]?.dishId ?? col.slotTypeId}
        cuisineKey={dish?.cuisineKey ?? ""}
        className="h-[70px] rounded-xl"
      />
      <span className="font-extrabold">{title}</span>
      <span className="text-xs font-extrabold text-ink-muted">{sub}</span>
      {shared !== undefined && shared.splitMembers.length > 0 && (
        <span className="text-xs font-extrabold text-saffron-text">
          +{" "}
          {shared.splitMembers
            .map((id) => data.basics.members.find((m) => m.id === id)?.displayName ?? "")
            .join(", ")}
          : own dish
        </span>
      )}
    </>
  );
  const cls = `flex min-w-0 flex-col gap-2 rounded-[18px] bg-card p-3.5 text-ink no-underline hover:text-ink ${
    highlight ? "border-[2.5px] border-action" : "shadow-card"
  }`;
  return (
    <Link
      href={`/kitchen?date=${data.day?.date ?? ""}${shared === undefined ? "" : `&meal=${shared.id}`}`}
      className={cls}
    >
      {content}
    </Link>
  );
}

function summariseNames(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, k]) => (k > 1 ? `${n} ×${String(k)}` : n)).join(" · ");
}

/** "Grilled ×2 · breaded-fried ×3": the variant mix of a shared meal's main component. */
function variantMix(meal: PlanMeal, dish: Dish): string | null {
  const multi = dish.components.find((c) => c.variants.length > 1);
  if (multi === undefined) return null;
  const labels = new Map(multi.variants.map((v) => [v.id, v.label]));
  const counts = new Map<string, number>();
  for (const p of meal.plates)
    for (const i of p.items)
      if (i.componentId === multi.id) {
        const l = labels.get(i.variantId) ?? "";
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
  if (counts.size === 0) return null;
  return [...counts].map(([l, k]) => `${l} ×${String(k)}`).join(" · ");
}

function PersonGrid({ data, cols }: { readonly data: TodayData; readonly cols: SlotColumn[] }) {
  const members = data.basics.members;
  const template = `150px repeat(${String(cols.length)}, minmax(0, 1fr)) 160px`;
  const cell = (memberId: string, col: SlotColumn) => {
    const meal = col.meals.find((m) => m.plates.some((p) => p.memberId === memberId));
    const plate = meal?.plates.find((p) => p.memberId === memberId);
    if (meal === undefined || plate === undefined) return <span className="text-ink-faint">—</span>;
    if (plate.fitStatus !== "untargeted") return <FitText status={plate.fitStatus} />;
    const own = meal.memberScope !== "shared";
    return (
      <span className="text-ink-muted">
        {own
          ? meal.dishName
          : `${portionWord(members.find((m) => m.id === memberId)?.appetite)} portion`}
      </span>
    );
  };
  return (
    <div
      role="region"
      aria-label="Everyone's day, scrolls sideways"
      tabIndex={0}
      className="overflow-x-auto rounded-[20px] bg-card text-sm shadow-card"
    >
      <div role="table" aria-label="Everyone's day">
        <div role="rowgroup" className="min-w-[760px]">
          <div
            role="row"
            className="grid gap-2.5 rounded-t-[20px] bg-flour px-[18px] py-3 text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase"
            style={{ gridTemplateColumns: template }}
          >
            <span role="columnheader">Person</span>
            {cols.map((c) => (
              <span key={c.slotTypeId} role="columnheader">
                {c.label}
              </span>
            ))}
            <span role="columnheader">Day vs target</span>
          </div>
        </div>
        <div role="rowgroup" className="min-w-[760px]">
          {members.map((m) => {
            const d = myDay(data.day, m.id);
            return (
              <div
                key={m.id}
                role="row"
                className="grid items-center gap-2.5 border-b border-flour px-[18px] py-3 last:border-b-0"
                style={{ gridTemplateColumns: template }}
              >
                <span role="rowheader" className="flex items-center gap-2 font-extrabold">
                  <Avatar
                    name={m.displayName}
                    color={isAvatarColor(m.color) ? m.color : null}
                    colorKey={m.id}
                    size={30}
                  />
                  {m.displayName}
                </span>
                {cols.map((c) => (
                  <span key={c.slotTypeId} role="cell">
                    {cell(m.id, c)}
                  </span>
                ))}
                <span role="cell" className="text-[13px]">
                  {d.target === null ? (
                    <span className="text-ink-muted">No targets</span>
                  ) : (
                    <span className="tabular font-mono">
                      {Math.round(d.actual.kcal)} / {Math.round(d.target.kcal)} kcal
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function portionWord(appetite: string | undefined): string {
  return appetite === "large" ? "Large" : appetite === "small" ? "Small" : "Regular";
}

function NeedsYou({ data, date }: { readonly data: TodayData; readonly date: string }) {
  const items: Array<{ href: string; text: string }> = [];
  if (data.proposals.length > 0)
    items.push({
      href: "/chat",
      text: `${String(data.proposals.length)} proposal${data.proposals.length === 1 ? "" : "s"} from the assistant`,
    });
  for (const d of [data.day, data.nextDay])
    if (d !== null && d.status === "draft")
      items.push({
        href: `/plan?week=${d.date}`,
        text: `${d.date === data.basics.today ? "Today" : weekdayName(d.date)}'s plan is ready to send to the kitchen`,
      });
  const flagged =
    data.day?.meals.filter((m) => m.plates.some((p) => p.fitStatus === "infeasible")) ?? [];
  for (const m of flagged)
    items.push({
      href: `/plan?week=${date}&meal=${m.id}`,
      text: `${m.slotLabel}: someone's plate misses its target`,
    });
  return (
    <section
      aria-labelledby="needs-you-title"
      className="flex flex-col gap-2.5 rounded-[20px] bg-agent p-[18px] text-on-agent"
    >
      <h2 id="needs-you-title" className="font-display text-xl font-bold text-on-agent">
        Needs you
      </h2>
      {items.length === 0 ? (
        <span className="text-sm">Nothing right now.</span>
      ) : (
        items.map((i) => (
          <Link
            key={i.text}
            href={i.href}
            className="rounded-xl bg-agent-raised px-3 py-2.5 text-sm font-bold text-on-agent no-underline hover:text-on-agent hover:underline"
          >
            {i.text}
          </Link>
        ))
      )}
    </section>
  );
}

function ReviewsToday({ data }: { readonly data: TodayData }) {
  const ids = new Set(data.day?.meals.map((m) => m.id) ?? []);
  const rated = data.reviews.filter(
    (r) => r.parentReviewId === null && r.rating !== null && ids.has(r.targetId),
  );
  const avg =
    rated.length === 0 ? null : rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length;
  return (
    <Card
      as="section"
      aria-labelledby="reviews-today-title"
      className="flex flex-col gap-2 p-[18px]"
    >
      <h2 id="reviews-today-title" className="font-body text-base font-extrabold">
        Reviews today
      </h2>
      <span className="text-sm text-ink-soft">
        {avg === null
          ? "No ratings yet."
          : `${String(rated.length)} rating${rated.length === 1 ? "" : "s"} · average ${avg.toFixed(1)}`}
      </span>
      <Link href="/reviews" className="text-sm font-extrabold">
        Read them
      </Link>
    </Card>
  );
}

function TodayDesktop({ data, date }: { readonly data: TodayData; readonly date: string }) {
  const { day, basics } = data;
  if (day === null)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h1 className="m-0 font-display text-[32px] font-bold">{longDay(date)}</h1>
          <DayNav date={date} today={basics.today} />
        </div>
        <NoPlan basics={basics} date={date} />
      </div>
    );
  const cols = columns(day);
  const now = date === basics.today ? localMinutes(new Date(), basics.household.timezone) : null;
  const upcoming = cols.find((c) => now === null || minutesOf(c.time) + 60 > now);
  const summary = fitSummary(day.meals.flatMap((m) => m.plates.map((p) => p.fitStatus)));
  return (
    <div className="flex gap-[22px]">
      <div className="flex min-w-0 grow flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={date === addDays(basics.today, 1) ? "/today" : `/today?date=${addDays(date, -1)}`}
            aria-label="Previous day"
            className="flex size-11 items-center justify-center rounded-md bg-flour text-ink"
          >
            <Icon name="chevronLeft" size={18} strokeWidth={2.5} />
          </Link>
          <h1 className="m-0 font-display text-[32px] font-bold">{longDay(date)}</h1>
          <Link
            href={addDays(date, 1) === basics.today ? "/today" : `/today?date=${addDays(date, 1)}`}
            aria-label="Next day"
            className="flex size-11 items-center justify-center rounded-md bg-flour text-ink"
          >
            <Icon name="chevronRight" size={18} strokeWidth={2.5} />
          </Link>
          <span className="ml-auto">
            <Chip tone={summary.tone} icon={summary.tone === "basil" ? "check" : "approx"}>
              {summary.text}
            </Chip>
          </span>
        </div>
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${String(Math.min(cols.length, 4))}, minmax(0, 1fr))`,
          }}
        >
          {cols.map((col) => (
            <SlotTile key={col.slotTypeId} col={col} data={data} highlight={col === upcoming} />
          ))}
        </div>
        <PersonGrid data={data} cols={cols} />
      </div>
      <aside className="flex w-[280px] shrink-0 flex-col gap-3.5" aria-label="For the admin">
        <NeedsYou data={data} date={date} />
        <KitchenCard
          flags={data.flags}
          meals={day.meals}
          timeZone={basics.household.timezone}
          date={date}
        />
        <ReviewsToday data={data} />
      </aside>
    </div>
  );
}

// Screen ---------------------------------------------------------------------------------------------

export function TodayScreen({ date }: { readonly date: string | null }) {
  const router = useRouter();
  const loaded = useLoad(() => loadToday(date), date ?? "");
  const wide = useWide();
  const role = loaded.data?.basics.role;
  useEffect(() => {
    if (role === "kitchen") router.replace("/kitchen");
  }, [role, router]);
  // Refresh while a substitution is running, so the admin sees its outcome arrive.
  const running = loaded.data?.flags.some(
    (f) =>
      f.kind === "unavailable" &&
      (f.job === null || f.job.status === "queued" || f.job.status === "running"),
  );
  const reload = loaded.reload;
  useEffect(() => {
    if (running !== true) return;
    const t = setInterval(() => void reload(), 4000);
    return () => {
      clearInterval(t);
    };
  }, [running, reload]);
  if (loaded.data === null)
    return loaded.error !== null ? (
      <LoadError message={loaded.error} onRetry={() => void loaded.reload()} />
    ) : (
      <Loading label="Loading today" />
    );
  const data = loaded.data;
  const on = date ?? data.basics.today;
  if (data.basics.role === "kitchen") return <Loading label="Opening the kitchen" />;
  return wide && data.basics.role === "admin" ? (
    <TodayDesktop data={data} date={on} />
  ) : (
    <TodayPhone data={data} date={on} />
  );
}
