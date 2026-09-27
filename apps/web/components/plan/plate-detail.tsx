"use client";
// Plate detail (UX-4; PlatePhone.dc.html): one person's plate at one meal. Components with their
// variant and cooked grams, adjuster sides, macro bars against the slot target (target band
// shaded, actual marker; carbs total, R-28; the kcal band is the slot's share of the day's ±50),
// saturated fat and fibre, and "why this dish" for admins. Untargeted members (children) get
// portions only (R-28).
import Link from "next/link";
import { Card, Chip, EmptyState, Icon, LinkButton, MacroBar } from "../ui";
import { DishArt } from "../recipe/dish-art";
import { api, c, useLoad, type CookSheet, type Dish, type PlanMeal, type Plate } from "./api";
import { FitBadge, LoadError, Loading, cuisineLabel, loadBasics, type Basics } from "./common";
import { carbsOn, dayTarget, num, weekdayName } from "./logic";
import { plateLines } from "./plate-summary";

interface PlateData {
  basics: Basics;
  plate: Plate;
  meal: PlanMeal;
  dish: Dish;
  sheet: CookSheet | null;
  /** The member's daily kcal band (R-28), when the viewer may read targets. */
  tolerance: number | null;
  /** The member's day target from the day kind's profile (W-7), when the viewer may read it. */
  day: { kcal: number; label: string | null } | null;
}

async function loadPlate(id: string): Promise<PlateData> {
  const [basics, plate] = await Promise.all([
    loadBasics(),
    api.call(c.platesGet, { params: { id } }),
  ]);
  const meal = await api.call(c.planMealsGet, { params: { id: plate.planMealId } });
  const targeted = plate.target !== null;
  const [dish, sheet, targets, schedules, dayPlan] = await Promise.all([
    api.call(c.dishesGet, { params: { id: meal.dishId } }),
    api.call(c.cookSheetsGet, { params: { date: meal.date } }).catch(() => null),
    targeted ? api.call(c.targetsList, {}).catch(() => null) : Promise.resolve(null),
    targeted && basics.role === "admin"
      ? api.call(c.schedulesGet, {}).catch(() => null)
      : Promise.resolve(null),
    targeted
      ? api.call(c.plansList, { query: { from: meal.date, to: meal.date } }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const tolerance = targets?.tolerances.find((t) => t.memberId === plate.memberId)?.kcal ?? null;
  const day =
    targets === null
      ? null
      : dayTarget(
          targets.targets,
          plate.memberId,
          meal.date,
          schedules,
          (dayPlan?.days[0]?.meals ?? []).flatMap((m) => m.plates),
        );
  return { basics, plate, meal, dish, sheet, tolerance, day };
}

function Bars({
  plate,
  dayKcalBand,
  day,
  own,
}: {
  readonly plate: Plate;
  readonly dayKcalBand: number | null;
  readonly day: PlateData["day"];
  readonly own: boolean;
}) {
  const t = plate.target;
  const a = plate.actual;
  if (t === null || a === null) return null;
  const carbs = carbsOn(a, t.carbBasis);
  return (
    <Card className="flex flex-col gap-3 p-3.5">
      <h2 className="font-body text-base font-extrabold">
        Against your {plate.fitStatus === "untargeted" ? "plan" : "meal target"}
      </h2>
      <MacroBar
        macro="protein"
        actual={Math.round(a.protein)}
        target={Math.round(t.protein)}
        tolerance={t.tolerance.protein}
      />
      <MacroBar
        macro="carbs"
        label={t.carbBasis === "available" ? "Carbs g (available)" : "Carbs g (total)"}
        actual={Math.round(carbs)}
        target={Math.round(t.carbs)}
        tolerance={t.tolerance.carbs}
      />
      <MacroBar
        macro="fat"
        actual={Math.round(a.fat)}
        target={Math.round(t.fat)}
        tolerance={t.tolerance.fat}
      />
      <MacroBar
        macro="kcal"
        actual={Math.round(a.kcal)}
        target={Math.round(t.kcal)}
        tolerance={t.tolerance.kcal}
      />
      <span className="text-xs text-ink-muted">
        {dayKcalBand === null
          ? "The calorie band is this meal's share of the day's band; protein, carbs and fat are per meal."
          : `The calorie band (±${num(t.tolerance.kcal)}) is this meal's share of ${own ? "your" : "their"} ±${num(dayKcalBand)} ${day === null ? "a day" : `on a ${num(day.kcal)} kcal day${day.label === null ? "" : ` (${day.label})`}`}; protein, carbs and fat are per meal.`}
      </span>
      <span className="tabular font-mono text-[13px] text-ink-soft">
        Sat fat {num(a.satFat)} g · Fibre {num(a.fibre)} g · Soluble fibre{" "}
        {a.solubleFibre === null ? "unknown" : `${num(a.solubleFibre)} g`}
      </span>
      <FitBadge status={plate.fitStatus} />
    </Card>
  );
}

function PlateScreenBody({ data }: { readonly data: PlateData }) {
  const { plate, meal, dish, basics, sheet } = data;
  const member = basics.members.find((m) => m.id === plate.memberId);
  const own = plate.memberId === basics.memberId;
  const whose = own ? "Your plate" : `${member?.displayName ?? "Their"}'s plate`;
  const lines = plateLines(plate, dish);
  const sides =
    sheet?.meals
      .find((m) => m.planMealId === meal.id)
      ?.plating.rows.find((r) => r.memberId === plate.memberId)?.sides ?? [];
  const reasons = meal.scoreBreakdown?.reasons ?? [];
  const untargeted = plate.target === null;
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5">
      <div className="relative -mx-4 -mt-5 lg:mx-0 lg:mt-0">
        <DishArt
          dishId={dish.id}
          cuisineKey={dish.cuisineKey}
          className="h-[190px] w-full lg:rounded-[24px]"
        />
        <Link
          href={`/today${meal.date === basics.today ? "" : `?date=${meal.date}`}`}
          aria-label="Back to the day"
          className="absolute top-3.5 left-3.5 flex size-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <Icon name="chevronLeft" size={20} strokeWidth={2.5} />
        </Link>
        <span className="absolute bottom-3.5 left-4 -rotate-3 rounded-full bg-card px-2.5 py-1 text-xs font-extrabold text-ink">
          {cuisineLabel(basics, dish.cuisineKey)}
        </span>
      </div>
      <div>
        <span className="text-[13px] font-extrabold text-ink-muted">
          {weekdayName(meal.date)} {meal.slotLabel.toLowerCase()} · {whose}
        </span>
        <h1 className="m-0 mt-0.5 font-display text-2xl leading-tight font-bold">
          {meal.dishName}
        </h1>
      </div>
      <Card className="flex flex-col p-0">
        <ul className="m-0 list-none p-0" aria-label="On the plate">
          {lines.map((l) => (
            <li
              key={l.componentId}
              className="flex items-center gap-2.5 border-b border-flour px-3.5 py-3 last:border-b-0"
            >
              <span className="flex grow flex-wrap items-center gap-2 font-extrabold">
                {l.name}
                {l.variant !== null && (
                  <Chip tone="sea" size="sm">
                    {l.variant.toLowerCase()}
                  </Chip>
                )}
              </span>
              <span className="tabular font-mono text-lg">
                {l.units ?? `${String(Math.round(l.cookedG))} g`}
              </span>
            </li>
          ))}
          {sides.map((s) => (
            <li
              key={s.dishName}
              className="flex items-center gap-2.5 border-b border-flour px-3.5 py-3 last:border-b-0"
            >
              <span className="flex grow flex-wrap items-center gap-2 font-extrabold">
                {s.dishName}
                <Chip size="sm">side</Chip>
              </span>
              <span className="tabular font-mono text-lg">{s.label}</span>
            </li>
          ))}
        </ul>
      </Card>
      {untargeted ? (
        <p className="m-0 rounded-[18px] bg-flour p-3.5 text-sm">
          {member?.displayName ?? "This person"} has no macro targets, so this is a{" "}
          {member?.appetite === "large"
            ? "large"
            : member?.appetite === "small"
              ? "small"
              : "regular"}{" "}
          portion sized for appetite.
        </p>
      ) : (
        <Bars plate={plate} dayKcalBand={data.tolerance} day={data.day} own={own} />
      )}
      {reasons.length > 0 && (
        <section
          aria-labelledby="why-title"
          className="flex flex-col gap-1.5 rounded-[18px] bg-flour p-3.5 text-sm"
        >
          <h2 id="why-title" className="font-body text-base font-extrabold">
            Why this {meal.slotLabel.toLowerCase()}
          </h2>
          {reasons.map((r) => (
            <span key={r}>{r}</span>
          ))}
        </section>
      )}
      <div className="flex gap-2.5">
        {basics.role !== "kitchen" && (
          <LinkButton href={`/reviews/new?planMealId=${meal.id}`} size="lg" className="grow">
            Rate this meal
          </LinkButton>
        )}
        <LinkButton href={`/recipes/${dish.id}`} variant="secondary" size="lg" className="grow">
          See recipe
        </LinkButton>
      </div>
    </div>
  );
}

export function PlateScreen({ id }: { readonly id: string }) {
  const loaded = useLoad(() => loadPlate(id), id);
  if (loaded.data !== null) return <PlateScreenBody data={loaded.data} />;
  if (loaded.error !== null)
    return loaded.error.includes("not found") || loaded.error.includes("Not found") ? (
      <EmptyState
        headingLevel={1}
        icon="today"
        title="That plate is not here"
        description="It may have been re-planned, or it is someone else's plate you cannot see."
        action={<LinkButton href="/today">Back to today</LinkButton>}
      />
    ) : (
      <LoadError message={loaded.error} onRetry={() => void loaded.reload()} />
    );
  return <Loading label="Loading the plate" />;
}
