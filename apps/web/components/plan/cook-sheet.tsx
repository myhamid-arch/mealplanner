"use client";
// Kitchen (UX-4; CookSheet.dc.html; PLN-14): a date and meal picker, the weigh-and-measure banner
// (NUT-6) and the per-attendee allergy banners (R2-UX-2), the plating table (people × components,
// cooked grams and variant), one card per batch with raw quantities (discarded frying oil apart)
// and steps to tick off, large text for tablets, print (A4, one meal per page), "Mark cooked"
// (R-52) and the kitchen flags (R2-UX-1). Admins also see every flag and its outcome.
import { useEffect, useMemo, useState } from "react";
import { Button, Chip, EmptyState, Icon } from "../ui";
import {
  api,
  c,
  problemText,
  useLoad,
  type CookSheet,
  type CookSheetMeal,
  type Dish,
  type KitchenFlagView,
  type PlanDay,
} from "./api";
import { ExtraIconSvg, LoadError, Loading, loadBasics, type Basics } from "./common";
import { KitchenCard } from "./flag-results";
import { FlagDialog, OwnFlags, ingredientChoices, variantChoices } from "./kitchen-flags";
import { addDays, hhmm, localMinutes, mediumDay, minutesOf, num, titleCase } from "./logic";

interface KitchenData {
  basics: Basics;
  date: string;
  sheet: CookSheet;
  day: PlanDay | null;
  dishes: Map<string, Dish>;
  names: Map<string, string>;
  flags: KitchenFlagView[];
}

async function loadKitchen(date: string | null): Promise<KitchenData> {
  const basics = await loadBasics();
  const on = date ?? basics.today;
  const [sheet, plans, ingredients, flags] = await Promise.all([
    api.call(c.cookSheetsGet, { params: { date: on } }),
    api.call(c.plansList, { query: { from: on, to: on } }),
    api.call(c.ingredientsList, { query: { limit: 500 } }),
    basics.role === "member"
      ? Promise.resolve([])
      : api.call(c.cookSheetsFlags, { params: { date: on } }).then((r) => r.flags),
  ]);
  const dishIds = [...new Set(sheet.meals.map((m) => m.dishId))];
  const dishes = new Map(
    (await Promise.all(dishIds.map((id) => api.call(c.dishesGet, { params: { id } })))).map((d) => [
      d.id,
      d,
    ]),
  );
  return {
    basics,
    date: on,
    sheet,
    day: plans.days[0] ?? null,
    dishes,
    names: new Map((ingredients.ingredients ?? []).map((i) => [i.id, i.name])),
    flags,
  };
}

const VARIANT_TINT = ["bg-sea-tint", "bg-saffron-tint", "bg-olive-tint", "bg-aubergine-tint"];

function slugName(slug: string): string {
  return titleCase(slug.replaceAll("-", "_"));
}

/** Start time: the meal time less its longest variant cook time and 15 minutes to plate. */
function startTime(meal: CookSheetMeal, dish: Dish | undefined): string | null {
  if (dish === undefined) return null;
  const used = new Set(meal.batches.map((b) => b.variantId));
  const longest = Math.max(
    0,
    ...dish.components.flatMap((comp) =>
      comp.variants.filter((v) => used.has(v.id)).map((v) => v.cookTimeMin ?? 0),
    ),
  );
  if (longest === 0) return null;
  const t = minutesOf(meal.time) - longest - 15;
  if (t < 0) return null;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function PlatingTable({ meal }: { readonly meal: CookSheetMeal }) {
  const { columns, rows } = meal.plating;
  // Variant order per column, for tints and the "345 + 460" totals.
  const order = columns.map((col) => [
    ...new Set(
      rows.flatMap((r) =>
        r.cells.filter((x) => x.componentId === col.componentId).map((x) => x.variantLabel ?? ""),
      ),
    ),
  ]);
  const allergic = new Set(meal.allergyBanners.map((b) => b.memberName));
  const hasSides = rows.some((r) => r.sides.length > 0);
  const template = `minmax(96px, 150px) repeat(${String(columns.length + (hasSides ? 1 : 0))}, minmax(72px, 1fr))`;
  return (
    <section
      aria-labelledby={`plating-${meal.planMealId}`}
      className="flex flex-col gap-2.5 rounded-[20px] bg-card p-4 shadow-card lg:px-5"
    >
      <h2 id={`plating-${meal.planMealId}`} className="font-display text-[22px]">
        Plating table{" "}
        <span className="font-body text-sm font-bold text-ink-muted">grams cooked</span>
      </h2>
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={`Plating table for ${meal.slotLabel.toLowerCase()}, scrolls sideways`}
      >
        <div
          role="table"
          aria-label="Plating table, grams cooked"
          className="grid min-w-max gap-1.5 text-[15px]"
          style={{ gridTemplateColumns: template }}
        >
          <div role="row" className="contents">
            <span role="columnheader">
              <span className="sr-only">Person</span>
            </span>
            {columns.map((col) => (
              <span key={col.componentId} role="columnheader" className="font-extrabold">
                {col.name}
              </span>
            ))}
            {hasSides && (
              <span role="columnheader" className="font-extrabold">
                Sides
              </span>
            )}
          </div>
          {rows.map((r) => (
            <div key={r.memberId} role="row" className="contents">
              <span role="rowheader" className="flex items-center gap-2 font-extrabold">
                {r.memberName}
              </span>
              {columns.map((col, ci) => {
                const cell = r.cells.find((x) => x.componentId === col.componentId);
                if (cell === undefined || cell.cookedG === 0)
                  return (
                    <span
                      key={col.componentId}
                      role="cell"
                      className="rounded-[10px] bg-paper p-2.5 text-ink-muted"
                    >
                      —
                    </span>
                  );
                const variants = order[ci] ?? [];
                const vi = variants.indexOf(cell.variantLabel ?? "");
                const odd =
                  allergic.has(r.memberName) &&
                  variants.length > 1 &&
                  vi > 0 &&
                  vi === variants.length - 1;
                const tint = odd
                  ? "bg-pomegranate-tint font-extrabold text-pomegranate-text"
                  : variants.length > 1
                    ? (VARIANT_TINT[vi] ?? "bg-paper")
                    : "bg-paper";
                const amount =
                  cell.units !== null
                    ? `${num(cell.units)} ${col.unitLabel ?? ""}`.trim()
                    : String(Math.round(cell.cookedG));
                return (
                  <span
                    key={col.componentId}
                    role="cell"
                    className={`tabular rounded-[10px] p-2.5 font-mono ${tint}`}
                  >
                    {amount}
                    {variants.length > 1 && cell.variantLabel !== null
                      ? ` · ${cell.variantLabel.toLowerCase()}`
                      : ""}
                  </span>
                );
              })}
              {hasSides && (
                <span
                  role="cell"
                  className="tabular rounded-[10px] bg-paper p-2.5 font-mono text-sm"
                >
                  {r.sides.length === 0
                    ? "—"
                    : r.sides.map((s) => `${s.dishName} ${s.label}`).join(", ")}
                </span>
              )}
            </div>
          ))}
          <div role="row" className="contents">
            <span role="rowheader" className="font-extrabold text-ink-muted">
              Total cooked
            </span>
            {columns.map((col, ci) => {
              const totals = (order[ci] ?? []).map((label) =>
                rows.reduce(
                  (s, r) =>
                    s +
                    (r.cells.find(
                      (x) => x.componentId === col.componentId && (x.variantLabel ?? "") === label,
                    )?.cookedG ?? 0),
                  0,
                ),
              );
              return (
                <span
                  key={col.componentId}
                  role="cell"
                  className="tabular p-2.5 font-mono font-extrabold"
                >
                  {totals
                    .filter((t) => t > 0)
                    .map((t) => String(Math.round(t)))
                    .join(" + ") || "—"}
                </span>
              );
            })}
            {hasSides && <span role="cell" />}
          </div>
        </div>
      </div>
    </section>
  );
}

function stepKey(date: string, mealId: string, variantId: string, i: number) {
  return `mise.cook.${date}.${mealId}.${variantId}.${String(i)}`;
}

function readTicks(date: string, meal: CookSheetMeal): Set<string> {
  const out = new Set<string>();
  try {
    for (const b of meal.batches)
      b.steps.forEach((_, i) => {
        const k = stepKey(date, meal.planMealId, b.variantId, i);
        if (localStorage.getItem(k) === "1") out.add(k);
      });
  } catch {
    // Storage may be unavailable (private mode); ticks then last for the visit only.
  }
  return out;
}

function BatchCards({
  meal,
  date,
  names,
}: {
  readonly meal: CookSheetMeal;
  readonly date: string;
  readonly names: ReadonlyMap<string, string>;
}) {
  const [ticks, setTicks] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setTicks(readTicks(date, meal));
  }, [date, meal]);
  const toggle = (k: string) => {
    const next = new Set(ticks);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setTicks(next);
    try {
      if (next.has(k)) localStorage.setItem(k, "1");
      else localStorage.removeItem(k);
    } catch {
      // See readTicks.
    }
  };
  const nameOf = (id: string, slug: string) => names.get(id) ?? slugName(slug);
  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      {meal.batches.map((b) => (
        <section
          key={`${b.kind}-${b.variantId}`}
          aria-label={`${b.variantLabel} ${b.componentName}`}
          className="flex flex-col gap-2 rounded-[20px] bg-card p-[18px] shadow-card break-inside-avoid"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-xl">
              {meal.batches.filter((x) => x.componentName === b.componentName).length > 1
                ? `${b.variantLabel} ${b.componentName.toLowerCase()}`
                : b.componentName}
              {b.kind === "adjuster" && (
                <span className="ml-2 align-middle">
                  <Chip size="sm">side</Chip>
                </span>
              )}
            </h3>
            <span className="tabular font-mono font-extrabold">
              makes {Math.round(b.totalCookedG)} g · {b.servings}{" "}
              {b.servings === 1 ? "plate" : "plates"}
            </span>
          </div>
          <p className="m-0 font-mono text-sm">
            {b.raw.map((r) => `${nameOf(r.ingredientId, r.slug)} ${num(r.rawG)} g`).join(" · ")}
          </p>
          {b.discardedFat.length > 0 && (
            <p className="m-0 font-mono text-sm text-ink-soft">
              For frying:{" "}
              {b.discardedFat
                .map((r) => `${nameOf(r.ingredientId, r.slug)} ${num(r.rawG)} g`)
                .join(" · ")}{" "}
              (mostly discarded, not eaten)
            </p>
          )}
          {b.steps.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {b.steps.map((step, i) => {
                const k = stepKey(date, meal.planMealId, b.variantId, i);
                return (
                  <li key={k}>
                    <label className="flex min-h-11 items-start gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={ticks.has(k)}
                        onChange={() => {
                          toggle(k);
                        }}
                        className="mt-0.5 size-5 shrink-0 accent-basil"
                      />
                      <span className={ticks.has(k) ? "text-ink-muted line-through" : ""}>
                        {step}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function MealSheetView({
  data,
  meal,
  visible,
  onChanged,
}: {
  readonly data: KitchenData;
  readonly meal: CookSheetMeal;
  readonly visible: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const [flag, setFlag] = useState<"unavailable" | "unclear" | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planMeal = data.day?.meals.find((m) => m.id === meal.planMealId);
  const cooked = planMeal?.status === "cooked";
  const role = data.basics.role;
  const canCook = role === "admin" || role === "kitchen";
  const start = startTime(meal, data.dishes.get(meal.dishId));
  const nameOf = (id: string, slug: string) => data.names.get(id) ?? slugName(slug);
  const setStatus = async (status: "cooked" | "planned") => {
    setBusy(true);
    setError(null);
    try {
      await api.call(c.planMealsStatus, { params: { id: meal.planMealId }, body: { status } });
      await onChanged();
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  const mealFlags = data.flags.filter((f) => f.planMealId === meal.planMealId);
  return (
    <article
      aria-label={`${meal.slotLabel}: ${meal.dishName}`}
      data-testid="cook-meal"
      className={`cook-meal flex flex-col gap-4 ${visible ? "" : "hidden print:flex"}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 grow flex-col">
          <span className="text-sm font-extrabold text-ink-muted">
            {mediumDay(data.date)} · {meal.slotLabel} {hhmm(meal.time)}
            {start === null ? "" : ` · start ${start}`}
            {meal.kind === "individual" ? " · individual" : ""}
          </span>
          <h2 className="m-0 font-display text-[26px] leading-tight font-bold lg:text-[30px]">
            {meal.dishName}
          </h2>
        </div>
        {canCook && (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {cooked ? (
              <>
                <Chip tone="basil" icon="check">
                  Cooked
                </Chip>
                <Button variant="ghost" loading={busy} onClick={() => void setStatus("planned")}>
                  Not cooked yet
                </Button>
              </>
            ) : (
              <Button
                loading={busy}
                icon="check"
                onClick={() => void setStatus("cooked")}
                className="bg-basil-text text-card hover:bg-basil-text hover:text-card"
              >
                Mark cooked
              </Button>
            )}
          </div>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-rail px-4 py-3 text-sm text-rail-ink-strong">
        <ExtraIconSvg name="scale" size={22} className="shrink-0 text-rail-focus" />
        <span className="grow">
          {data.sheet.banner.length > 0 ? (
            data.sheet.banner.join(" ")
          ) : (
            <>
              <strong>Weigh every plate</strong> to the grams below (cooked weight).{" "}
              <strong>Measure all oil</strong>.
            </>
          )}
        </span>
        {meal.allergyBanners.map((b) => (
          <span
            key={b.memberName + b.allergen}
            className="rounded-lg bg-pomegranate-tint px-2.5 py-1 font-extrabold text-pomegranate-text"
            data-testid="allergy-banner"
          >
            {b.text}
          </span>
        ))}
      </div>
      {meal.notes.length > 0 && (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          {meal.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <PlatingTable meal={meal} />
      <BatchCards meal={meal} date={data.date} names={data.names} />
      {canCook && (
        <div
          className="flex flex-col gap-2 rounded-[14px] bg-flour px-4 py-3 print:hidden"
          data-testid="flag-bar"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-extrabold">Something missing or unclear?</span>
            <Button
              className="bg-ink text-paper hover:bg-ink hover:text-paper"
              onClick={() => {
                setFlag("unavailable");
              }}
            >
              <ExtraIconSvg name="flag" size={18} />
              Flag an ingredient
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setFlag("unclear");
              }}
            >
              Recipe unclear
            </Button>
            <span className="text-[13px] text-ink-muted lg:ml-auto">
              Flags reach the admins and the assistant re-checks the macros.
            </span>
          </div>
          {sent !== null && (
            <p role="status" className="m-0 text-sm font-bold text-basil-text">
              {sent}
            </p>
          )}
          {role === "kitchen" && <OwnFlags flags={mealFlags} />}
        </div>
      )}
      {flag !== null && (
        <FlagDialog
          kind={flag}
          date={data.date}
          meal={meal}
          choices={flag === "unavailable" ? ingredientChoices(meal, nameOf) : variantChoices(meal)}
          open
          onOpenChange={(o) => {
            if (!o) setFlag(null);
          }}
          onSent={(text) => {
            setSent(text);
            void onChanged();
          }}
        />
      )}
    </article>
  );
}

function slotsOf(meals: readonly CookSheetMeal[]) {
  const out: Array<{ slotKey: string; label: string; time: string; count: number }> = [];
  for (const m of meals) {
    const g = out.find((x) => x.slotKey === m.slotKey);
    if (g === undefined)
      out.push({ slotKey: m.slotKey, label: m.slotLabel, time: m.time, count: 1 });
    else g.count += 1;
  }
  return out;
}

/** Print (PLN-14): A4, one meal per page, no navigation or controls. */
const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  nav[aria-label="Main"], nav[aria-label="Tabs"], a[aria-label^="Open assistant"], a[href="#main"],
  .kitchen-controls { display: none !important; }
  html, body { background: #FFFFFF !important; }
  main#main { padding: 0 !important; }
  .cook-meal { break-after: page; }
  .cook-meal:last-of-type { break-after: auto; }
}
`;

export function CookSheetScreen({
  date,
  mealId,
}: {
  readonly date: string | null;
  readonly mealId: string | null;
}) {
  const loaded = useLoad(() => loadKitchen(date), date ?? "");
  const [large, setLarge] = useState(false);
  const [picked, setPicked] = useState<string | null>(mealId);
  useEffect(() => {
    try {
      setLarge(localStorage.getItem("mise.kitchen.large") === "1");
    } catch {
      // Defaults to normal text.
    }
  }, []);
  useEffect(() => {
    // Large text for tablets: rem-based sizes grow with the root font size.
    const root = document.documentElement;
    const before = root.style.fontSize;
    if (large) root.style.fontSize = "125%";
    return () => {
      root.style.fontSize = before;
    };
  }, [large]);
  const data = loaded.data;
  const running = data?.flags.some(
    (f) =>
      f.kind === "unavailable" &&
      (f.job === null || f.job.status === "queued" || f.job.status === "running"),
  );
  useEffect(() => {
    if (running !== true) return;
    const t = setInterval(() => void loaded.reload(), 4000);
    return () => {
      clearInterval(t);
    };
  }, [running, loaded]);
  // The picker groups a slot's meals (a shared dish, or one dish per person in an individual
  // slot); the selected slot's meals are shown, every meal prints on its own page.
  const current = useMemo(() => {
    if (data === null) return null;
    const meals = data.sheet.meals;
    const byPick = meals.find((m) => m.planMealId === picked || m.slotKey === picked);
    if (byPick !== undefined) return byPick.slotKey;
    const now =
      data.date === data.basics.today
        ? localMinutes(new Date(), data.basics.household.timezone)
        : null;
    const upcoming =
      meals.find((m) => now === null || minutesOf(m.time) + 30 > now) ?? meals.at(-1);
    return upcoming?.slotKey ?? null;
  }, [data, picked]);
  if (data === null)
    return loaded.error !== null ? (
      <LoadError message={loaded.error} onRetry={() => void loaded.reload()} />
    ) : (
      <Loading label="Loading the cook sheet" />
    );
  const toggleLarge = () => {
    const next = !large;
    setLarge(next);
    try {
      localStorage.setItem("mise.kitchen.large", next ? "1" : "0");
    } catch {
      // Remembered for this visit only.
    }
  };
  const go = (d: string) => {
    window.location.assign(d === data.basics.today ? "/kitchen" : `/kitchen?date=${d}`);
  };
  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div className="kitchen-controls flex flex-wrap items-center gap-2">
        <h1 className="m-0 mr-auto font-display text-[26px] font-bold lg:text-[30px]">Kitchen</h1>
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => {
            go(addDays(data.date, -1));
          }}
          className="flex size-11 items-center justify-center rounded-md bg-flour text-ink"
        >
          <Icon name="chevronLeft" size={18} strokeWidth={2.5} />
        </button>
        <label className="sr-only" htmlFor="kitchen-date">
          Date
        </label>
        <input
          id="kitchen-date"
          type="date"
          value={data.date}
          onChange={(e) => {
            if (e.target.value !== "") go(e.target.value);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-3 text-ink"
        />
        <button
          type="button"
          aria-label="Next day"
          onClick={() => {
            go(addDays(data.date, 1));
          }}
          className="flex size-11 items-center justify-center rounded-md bg-flour text-ink"
        >
          <Icon name="chevronRight" size={18} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          aria-pressed={large}
          onClick={toggleLarge}
          className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 font-extrabold ${large ? "bg-ink text-paper" : "bg-flour text-ink"}`}
        >
          <ExtraIconSvg name="text" size={18} />
          Large text
        </button>
        <Button
          variant="secondary"
          disabled={data.sheet.meals.length === 0}
          onClick={() => {
            window.print();
          }}
        >
          <ExtraIconSvg name="printer" size={18} />
          Print
        </Button>
      </div>
      {data.sheet.meals.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon="kitchen"
          title={`Nothing to cook on ${mediumDay(data.date)}`}
          description={
            data.basics.role === "admin"
              ? "There is no plan for this day yet. Plan the week first."
              : "There is no plan for this day yet. The admins plan the week."
          }
        />
      ) : (
        <>
          {slotsOf(data.sheet.meals).length > 1 && (
            <div
              role="group"
              aria-label="Meals of the day"
              className="kitchen-controls flex flex-wrap gap-2"
            >
              {slotsOf(data.sheet.meals).map((g) => (
                <button
                  key={g.slotKey}
                  type="button"
                  aria-pressed={g.slotKey === current}
                  onClick={() => {
                    setPicked(g.slotKey);
                  }}
                  className={`min-h-11 rounded-full px-4 text-sm font-extrabold ${g.slotKey === current ? "bg-ink text-paper" : "bg-flour text-ink"}`}
                >
                  {g.label} {hhmm(g.time)}
                  {g.count > 1 ? ` · ${String(g.count)} dishes` : ""}
                </button>
              ))}
            </div>
          )}
          {data.sheet.meals.map((m) => (
            <MealSheetView
              key={m.planMealId}
              data={data}
              meal={m}
              visible={m.slotKey === current}
              onChanged={loaded.reload}
            />
          ))}
        </>
      )}
      {data.basics.role === "admin" && data.flags.length > 0 && (
        <div className="kitchen-controls print:hidden">
          <KitchenCard
            flags={data.flags}
            meals={data.day?.meals ?? []}
            timeZone={data.basics.household.timezone}
            date={data.date}
          />
        </div>
      )}
    </div>
  );
}
