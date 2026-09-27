"use client";
// Recipe page (UX-4 Recipes, R2-UX-3; RecipePage.dc.html): hero illustration with cuisine and
// meal stickers; components, each with its preparation variants as tabs (per 100 g cooked,
// ingredients for 1 kg cooked, method, "Tonight: who gets which"); single-way components as
// compact cards; reviews; "used in N meals". Admins: edit and retire household dishes
// (SPEC-Q-10), ask the assistant to revise (R-53 /chat?prompt=), and, when opened with
// `?date=&slot=`, "Use for <day> <slot>" (R-58, leaf-1.4.8 SPEC-Q-5).
import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, Card, Chip, Dialog, EmptyState, LinkButton, StarRatingDisplay } from "../ui";
import {
  api,
  applyChanges,
  c,
  problemText,
  useLoad,
  type Component,
  type Dish,
  type Variant,
} from "../plan/api";
import { LoadError, Loading, loadBasics, type Basics } from "../plan/common";
import { carbsOn, dayMonth, num, titleCase } from "../plan/logic";
import { loadUsage, type Usage } from "./data";
import { DishArt } from "./dish-art";
import { EditSheet } from "./edit-sheet";
import { UseFor, type UseForTarget } from "./use-for";

interface RecipeData {
  basics: Basics;
  dish: Dish;
  cuisines: Map<string, string>;
  usage: Usage;
}

async function loadRecipe(id: string): Promise<RecipeData> {
  const [basics, dish] = await Promise.all([
    loadBasics(),
    api.call(c.dishesGet, { params: { id } }),
  ]);
  const usage = await loadUsage(basics.today, new Map([[dish.id, dish]]));
  return {
    basics,
    dish,
    cuisines: basics.cuisines,
    usage,
  };
}

/** Raw grams for 1 kg cooked of a variant (R2-UX-3). */
function perKg(v: Variant, rawG: number): string {
  const g = (rawG * 1000) / Math.max(v.referenceBatchCookedG, 1);
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${num(g)} g`;
}

/** "Omar 195 g, Sara 150 g" from today's plates using this variant. */
function tonight(data: RecipeData, comp: Component, v: Variant): string {
  const today = data.usage.days.find((d) => d.date === data.basics.today);
  const names = new Map(data.basics.members.map((m) => [m.id, m.displayName]));
  const who: string[] = [];
  for (const m of today?.meals ?? [])
    if (m.dishId === data.dish.id)
      for (const p of m.plates)
        for (const i of p.items)
          if (i.componentId === comp.id && i.variantId === v.id && i.cookedG > 0)
            who.push(`${names.get(p.memberId) ?? "someone"} ${String(Math.round(i.cookedG))} g`);
  return who.length === 0 ? "nobody tonight" : who.join(", ");
}

function Per100({ v }: { readonly v: Variant }) {
  const n = v.per100gCooked;
  if (n === null)
    return <span className="text-sm text-ink-muted">Nutrition is being worked out.</span>;
  const tile = "flex flex-col rounded-xl p-3";
  const label = "font-body text-xs font-extrabold";
  return (
    <div className="grid grid-cols-2 gap-2 font-mono">
      <span className={`${tile} bg-tomato-tint`}>
        <span className={`${label} text-tomato-text`}>kcal</span>
        <span className="text-[22px]">{Math.round(n.kcal)}</span>
      </span>
      <span className={`${tile} bg-sea-tint`}>
        <span className={`${label} text-sea-text`}>Protein</span>
        <span className="text-[22px]">{num(n.protein)} g</span>
      </span>
      <span className={`${tile} bg-saffron-tint`}>
        <span className={`${label} text-saffron-text`}>Carbs g (total)</span>
        <span className="text-[22px]">{num(carbsOn(n))} g</span>
      </span>
      <span className={`${tile} bg-olive-tint`}>
        <span className={`${label} text-olive-text`}>Fat</span>
        <span className="text-[22px]">{num(n.fat)} g</span>
      </span>
    </div>
  );
}

function VariantPanel({
  data,
  comp,
  v,
}: {
  readonly data: RecipeData;
  readonly comp: Component;
  readonly v: Variant;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="flex flex-col gap-2.5 lg:w-[300px] lg:shrink-0">
        <h4 className="font-body text-xs font-extrabold tracking-[0.08em] text-ink-faint uppercase">
          Per 100 g cooked
        </h4>
        <Per100 v={v} />
        {v.notes !== null && <span className="text-[13px] text-ink-soft">{v.notes}</span>}
        <span className="text-[13px] font-extrabold">Tonight: {tonight(data, comp, v)}</span>
      </div>
      <div className="flex min-w-0 grow flex-col gap-2">
        <h4 className="font-body text-xs font-extrabold tracking-[0.08em] text-ink-faint uppercase">
          Ingredients · for 1 kg cooked
        </h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {v.ingredients.map((i) => (
            <li
              key={`${i.ingredientId}-${String(i.rawGPerBatch)}`}
              className="flex justify-between gap-3 rounded-[10px] bg-paper px-2.5 py-2 text-sm"
            >
              <span className="font-bold">
                {i.name}
                {i.roleNote !== null ? ` (${i.roleNote})` : ""}
              </span>
              <span className="tabular shrink-0 font-mono">{perKg(v, i.rawGPerBatch)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 lg:w-[330px] lg:shrink-0">
        <h4 className="font-body text-xs font-extrabold tracking-[0.08em] text-ink-faint uppercase">
          Method
        </h4>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {v.steps.map((s, i) => (
            <li key={s} className="flex gap-2.5 text-sm">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-extrabold text-paper"
              >
                {i + 1}
              </span>
              <span>
                <span className="sr-only">Step {i + 1}: </span>
                {s}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** WAI-ARIA tabs: arrow keys move between variants (ADR-2). */
function VariantTabs({
  data,
  comp,
  index,
}: {
  readonly data: RecipeData;
  readonly comp: Component;
  readonly index: number;
}) {
  const [sel, setSel] = useState(
    Math.max(
      0,
      comp.variants.findIndex((v) => v.isDefault),
    ),
  );
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = comp.variants.length;
    const to =
      e.key === "ArrowRight"
        ? (sel + 1) % n
        : e.key === "ArrowLeft"
          ? (sel - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    setSel(to);
    refs.current[to]?.focus();
  };
  const v = comp.variants[sel] ?? comp.variants[0];
  if (v === undefined) return null;
  return (
    <Card as="section" aria-labelledby={`${base}-h`} className="flex flex-col gap-4 p-[22px]">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`${base}-h`} className="font-display text-2xl">
          {index} · {comp.name}
        </h2>
        <span className="text-sm text-ink-muted">
          {comp.variants.length} ways. Each person gets the way that suits their macros and taste.
        </span>
      </div>
      <div role="tablist" aria-label={`${comp.name} preparation`} className="flex flex-wrap gap-2">
        {comp.variants.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${String(i)}`}
            aria-selected={i === sel}
            aria-controls={`${base}-panel`}
            tabIndex={i === sel ? 0 : -1}
            onClick={() => {
              setSel(i);
            }}
            onKeyDown={onKey}
            className={`min-h-11 rounded-xl px-[18px] text-[15px] font-extrabold ${i === sel ? "bg-ink text-paper" : "border-[1.5px] border-line-strong bg-card text-ink"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${String(sel)}`}
        tabIndex={0}
      >
        <VariantPanel data={data} comp={comp} v={v} />
      </div>
    </Card>
  );
}

function SmallComponent({
  data,
  comp,
  index,
}: {
  readonly data: RecipeData;
  readonly comp: Component;
  readonly index: number;
}) {
  const v = comp.variants[0];
  if (v === undefined) return null;
  const n = v.per100gCooked;
  return (
    <Card as="section" className="flex flex-col gap-1.5 p-[18px]" aria-label={comp.name}>
      <h3 className="font-display text-xl">
        {index} · {comp.name}
      </h3>
      <span className="text-sm text-ink-muted">{v.label} · 1 way</span>
      {n !== null && (
        <span className="tabular font-mono text-[13px]">
          per 100 g: {Math.round(n.kcal)} kcal · P{num(n.protein)} C{num(carbsOn(n))} F{num(n.fat)}
        </span>
      )}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2.5 font-extrabold">
          Ingredients and method
        </summary>
        <VariantPanel data={data} comp={comp} v={v} />
      </details>
    </Card>
  );
}

function Reviews({ data }: { readonly data: RecipeData }) {
  const parts = new Set(
    data.dish.components.flatMap((x) => [x.id, ...x.variants.map((v) => v.id)]),
  );
  const variantLabel = new Map(
    data.dish.components.flatMap((x) => x.variants.map((v) => [v.id, v.label])),
  );
  const mine = data.usage.reviews.filter(
    (r) =>
      r.parentReviewId === null &&
      ((r.targetType === "dish" && r.targetId === data.dish.id) ||
        ((r.targetType === "component" || r.targetType === "variant") && parts.has(r.targetId)) ||
        (r.targetType === "plan_meal" && data.usage.mealDish.get(r.targetId) === data.dish.id)),
  );
  return (
    <Card as="section" aria-labelledby="reviews-title" className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="reviews-title" className="font-display text-[22px]">
          Reviews
        </h2>
        {mine.length > 0 && (
          <Link href="/reviews" className="font-extrabold">
            All {mine.length}
          </Link>
        )}
      </div>
      {mine.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">
          No reviews yet. They appear here after meals with this dish are rated.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {mine.slice(0, 4).map((r) => (
            <li key={r.id} className="flex flex-col gap-1.5 rounded-[14px] bg-paper p-3.5">
              <span className="flex flex-wrap items-center gap-2 font-extrabold">
                {r.authorName}
                {r.rating !== null && <StarRatingDisplay value={r.rating} size={14} />}
                {r.targetType === "variant" && (
                  <span className="font-bold text-ink-muted">
                    · {variantLabel.get(r.targetId)?.toLowerCase()}
                  </span>
                )}
              </span>
              {r.comment !== null && <span className="text-sm">“{r.comment}”</span>}
              {r.tags.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {r.tags.map((t) => (
                    <Chip key={t} size="sm" tone="saffron">
                      {t.replaceAll("_", " ")}
                    </Chip>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RetireButton({ dish, onDone }: { readonly dish: Dish; readonly onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retire = async () => {
    setBusy(true);
    setError(null);
    try {
      await applyChanges(`Retire ${dish.name}`, [
        { kind: "dish.retire", payload: { dishId: dish.id } },
      ]);
      setOpen(false);
      onDone();
    } catch (e) {
      setError(
        `${problemText(e)} Recipes with reviews are retired through the assistant, which asks you to confirm.`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        Retire
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Retire ${dish.name}?`}
        description="It stays in the library, marked retired, and the planner stops choosing it. Meals already planned keep it."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void retire()}>
              Retire
            </Button>
          </>
        }
      >
        {error !== null && (
          <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}

function RecipeBody({
  data,
  reload,
  useFor,
}: {
  readonly data: RecipeData;
  readonly reload: () => void;
  readonly useFor: UseForTarget | null;
}) {
  const { dish, basics, usage } = data;
  const admin = basics.role === "admin";
  const own = dish.householdId !== null;
  const rating = usage.ratings.get(dish.id);
  const used = usage.meals.get(dish.id) ?? 0;
  const slotLabel = (k: string) => basics.slots.find((s) => s.key === k)?.label ?? titleCase(k);
  const author =
    dish.source === "ai"
      ? `Written by the assistant on ${dayMonth(dish.createdAt.slice(0, 10))}${dish.version > 1 ? " and edited since" : ""}.`
      : dish.source === "admin"
        ? `Added by the household on ${dayMonth(dish.createdAt.slice(0, 10))}.`
        : "From the starter library.";
  const big = dish.components.filter((x) => x.variants.length > 1);
  const small = dish.components.filter((x) => x.variants.length <= 1);
  const numberOf = (x: Component) => dish.components.indexOf(x) + 1;
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="relative">
        <DishArt
          dishId={dish.id}
          cuisineKey={dish.cuisineKey}
          className="h-[180px] rounded-[24px] lg:h-[220px]"
          muted={dish.status === "retired"}
        />
        <span className="absolute bottom-[18px] left-[22px] flex flex-wrap gap-2">
          <span className="-rotate-3 rounded-full bg-card px-3 py-1.5 text-[13px] font-extrabold text-ink">
            {data.cuisines.get(dish.cuisineKey) ?? titleCase(dish.cuisineKey)}
          </span>
          <span className="rotate-2 rounded-full bg-card px-3 py-1.5 text-[13px] font-extrabold text-ink">
            {dish.slotKeys.map(slotLabel).join(" · ")}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 grow basis-[420px]">
          <h1 className="m-0 font-display text-[28px] leading-tight font-bold lg:text-[34px]">
            {dish.name}
          </h1>
          <p className="m-0 mt-1.5 text-ink-muted">
            {dish.components.length} component{dish.components.length === 1 ? "" : "s"}, each cooked
            and portioned separately. {author} Used in {used} meal{used === 1 ? "" : "s"} in the
            last month.
            {rating === undefined
              ? " No ratings yet."
              : ` Rated ${rating.mean.toFixed(1)} from ${String(rating.count)} review${rating.count === 1 ? "" : "s"}.`}
            {dish.status === "retired" ? " Retired: the planner no longer chooses it." : ""}
          </p>
          {dish.description !== "" && <p className="m-0 mt-1.5">{dish.description}</p>}
        </div>
        {admin && (
          <div className="flex flex-wrap items-start gap-2">
            {useFor !== null && (
              <UseFor
                dishId={dish.id}
                dishName={dish.name}
                retired={dish.status === "retired"}
                basics={basics}
                target={useFor}
              />
            )}
            {own && dish.status !== "retired" && (
              <EditSheet dish={dish} slots={basics.slots} onSaved={reload} />
            )}
            {own && dish.status !== "retired" && <RetireButton dish={dish} onDone={reload} />}
            {dish.status !== "retired" && (
              <LinkButton
                href={`/chat?prompt=${encodeURIComponent(`Revise the recipe "${dish.name}": `)}`}
                className="bg-agent text-on-agent hover:bg-agent-raised hover:text-on-agent"
              >
                Ask assistant to revise
              </LinkButton>
            )}
          </div>
        )}
      </div>
      {big.map((x) => (
        <VariantTabs key={x.id} data={data} comp={x} index={numberOf(x)} />
      ))}
      {small.length > 0 && (
        <div className="grid gap-3.5 lg:grid-cols-3">
          {small.map((x) => (
            <SmallComponent key={x.id} data={data} comp={x} index={numberOf(x)} />
          ))}
        </div>
      )}
      <Reviews data={data} />
    </div>
  );
}

export function RecipeScreen({
  id,
  useFor = null,
}: {
  readonly id: string;
  /** From `?date=&slot=[&member=]` (SPEC-Q-5); null without them. */
  readonly useFor?: UseForTarget | null;
}) {
  const loaded = useLoad(() => loadRecipe(id), id);
  if (loaded.data !== null)
    return <RecipeBody data={loaded.data} reload={() => void loaded.reload()} useFor={useFor} />;
  if (loaded.error !== null)
    return /not found/i.test(loaded.error) ? (
      <EmptyState
        headingLevel={1}
        icon="recipes"
        title="That recipe is not here"
        description="It may belong to another household, or the link is wrong."
        action={<LinkButton href="/recipes">All recipes</LinkButton>}
      />
    ) : (
      <LoadError message={loaded.error} onRetry={() => void loaded.reload()} />
    );
  return <Loading label="Loading the recipe" />;
}
