"use client";
// Recipe library (UX-4 Recipes; RecipeLibrary.dc.html): a grid of recipe cards with search and
// filters for meal (slot), packable, cuisine, main protein, rating and new. Cards lead with the
// dish (illustration, name), then cuisine and variants, then the rating. Retired dishes are shown
// muted at the end. Filters live in the query string, so a filtered view can be linked.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { EmptyState, StarRatingDisplay } from "../ui";
import { api, c, useLoad, type Dish, type DishSummary, type Ingredient } from "../plan/api";
import { LoadError, Loading, loadBasics, type Basics } from "../plan/common";
import { addDays, titleCase } from "../plan/logic";
import { loadUsage, type Usage } from "./data";
import { DishArt } from "./dish-art";

interface LibraryData {
  basics: Basics;
  dishes: DishSummary[];
  cuisines: Map<string, string>;
}

async function loadLibrary(): Promise<LibraryData> {
  const [basics, dishes, cuisines] = await Promise.all([
    loadBasics(),
    api.call(c.dishesList, { query: {} }),
    api.call(c.cuisinesList, {}),
  ]);
  return {
    basics,
    dishes: (dishes.dishes ?? []).filter((d) => !d.isAdjuster && d.status !== "draft"),
    cuisines: new Map((cuisines.cuisines ?? []).map((x) => [x.key, x.label])),
  };
}

interface Details {
  dishes: Map<string, Dish>;
  categories: Map<string, string>;
  usage: Usage;
}

async function loadDetails(ids: readonly string[], today: string): Promise<Details> {
  const [dishes, ingredients] = await Promise.all([
    Promise.all(ids.map((id) => api.call(c.dishesGet, { params: { id } }))),
    api.call(c.ingredientsList, { query: { limit: 500 } }).then((r) => r.ingredients ?? []),
  ]);
  const map = new Map(dishes.map((d) => [d.id, d]));
  return {
    dishes: map,
    categories: new Map(ingredients.map((i: Ingredient) => [i.id, i.category])),
    usage: await loadUsage(today, map),
  };
}

const PROTEINS: Record<string, string> = {
  poultry: "Chicken & poultry",
  red_meat: "Red meat",
  fish: "Fish",
  seafood: "Seafood",
  egg: "Eggs",
  dairy: "Dairy",
  plant_protein: "Plant protein",
  legume: "Beans & lentils",
};

/** The main protein: the heaviest ingredient of the protein component's default variant. */
export function mainProtein(dish: Dish, categories: ReadonlyMap<string, string>): string | null {
  const comp = dish.components.find((x) => x.role === "protein");
  const variant = comp?.variants.find((v) => v.isDefault) ?? comp?.variants[0];
  if (variant === undefined) return null;
  const heaviest = [...variant.ingredients]
    .filter((i) => (categories.get(i.ingredientId) ?? "") in PROTEINS)
    .sort((a, b) => b.rawGPerBatch - a.rawGPerBatch)[0];
  return heaviest === undefined ? null : (categories.get(heaviest.ingredientId) ?? null);
}

/** "3 fish variants" / "packable" / "served cold" / the first slot. */
function subline(d: DishSummary, dish: Dish | undefined, slotLabel: (k: string) => string): string {
  const multi = dish?.components.find((x) => x.variants.length > 1);
  if (multi !== undefined)
    return `${String(multi.variants.length)} ${multi.name.toLowerCase()} variants`;
  if (d.isPackable) return "packable";
  if (d.servedColdOk) return "served cold";
  return d.slotKeys.map(slotLabel).join(", ").toLowerCase();
}

function isNew(d: DishSummary, today: string): boolean {
  return d.source === "ai" && d.createdAt.slice(0, 10) >= addDays(today, -14);
}

type Filters = {
  q: string;
  slot: string;
  packable: boolean;
  cuisine: string;
  protein: string;
  rated: boolean;
  fresh: boolean;
};

function readFilters(sp: URLSearchParams): Filters {
  return {
    q: sp.get("q") ?? "",
    slot: sp.get("slot") ?? "",
    packable: sp.get("packable") === "1",
    cuisine: sp.get("cuisine") ?? "",
    protein: sp.get("protein") ?? "",
    rated: sp.get("rating") === "4",
    fresh: sp.get("new") === "1",
  };
}

function chip(on: boolean, tone: "ink" | "agent" = "ink") {
  return `inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-extrabold ${
    on
      ? tone === "agent"
        ? "bg-agent text-on-agent"
        : "bg-ink text-paper"
      : tone === "agent"
        ? "bg-aubergine-tint text-aubergine-text"
        : "bg-flour text-ink"
  }`;
}

export function RecipeLibraryScreen() {
  const router = useRouter();
  const sp = useSearchParams();
  const filters = readFilters(new URLSearchParams(sp.toString()));
  const loaded = useLoad(loadLibrary);
  const ids = loaded.data?.dishes.map((d) => d.id).join(",") ?? "";
  const details = useLoad(
    () =>
      loaded.data === null
        ? Promise.resolve(null)
        : loadDetails(
            loaded.data.dishes.map((d) => d.id),
            loaded.data.basics.today,
          ),
    ids,
  );
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    router.replace(q === "" ? "/recipes" : `/recipes?${q}`, { scroll: false });
  };
  const data = loaded.data;
  const det = details.data;
  const shown = useMemo(() => {
    if (data === null) return [];
    const q = filters.q.trim().toLowerCase();
    return data.dishes
      .filter((d) => {
        if (q !== "") {
          const dish = det?.dishes.get(d.id);
          const hay = [
            d.name,
            d.description,
            ...d.flavourTags,
            ...(dish?.components.flatMap((x) => [
              x.name,
              ...x.variants.flatMap((v) => v.ingredients.map((i) => i.name)),
            ]) ?? []),
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filters.slot !== "" && !d.slotKeys.includes(filters.slot)) return false;
        if (filters.packable && !d.isPackable) return false;
        if (
          filters.cuisine !== "" &&
          d.cuisineKey !== filters.cuisine &&
          d.secondaryCuisineKey !== filters.cuisine
        )
          return false;
        if (filters.protein !== "") {
          const dish = det?.dishes.get(d.id);
          if (
            dish === undefined ||
            mainProtein(dish, det?.categories ?? new Map()) !== filters.protein
          )
            return false;
        }
        if (filters.rated && (det?.usage.ratings.get(d.id)?.mean ?? 0) < 4) return false;
        if (filters.fresh && !isNew(d, data.basics.today)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          Number(a.status === "retired") - Number(b.status === "retired") ||
          a.name.localeCompare(b.name),
      );
  }, [
    data,
    det,
    filters.q,
    filters.slot,
    filters.packable,
    filters.cuisine,
    filters.protein,
    filters.rated,
    filters.fresh,
  ]);
  if (data === null)
    return loaded.error !== null ? (
      <LoadError message={loaded.error} onRetry={() => void loaded.reload()} />
    ) : (
      <Loading label="Loading recipes" />
    );
  const active = data.dishes.filter((d) => d.status === "active");
  const ai = active.filter((d) => d.source === "ai").length;
  const slotLabel = (k: string) =>
    data.basics.slots.find((s) => s.key === k)?.label ?? titleCase(k);
  const cuisineKeys = [...new Set(data.dishes.map((d) => d.cuisineKey))].sort();
  const proteins =
    det === null
      ? []
      : [
          ...new Set(
            [...det.dishes.values()]
              .map((d) => mainProtein(d, det.categories))
              .filter((p): p is string => p !== null),
          ),
        ];
  const selectCls =
    "min-h-11 rounded-full border-0 bg-flour px-3.5 text-sm font-extrabold text-ink";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-[28px] font-bold lg:text-[32px]">Recipes</h1>
        <span className="text-ink-muted">
          {active.length} in your library{ai > 0 ? ` · ${String(ai)} written by the assistant` : ""}
        </span>
        {data.basics.role === "admin" && (
          <Link
            href={`/chat?prompt=${encodeURIComponent("Write me a new recipe")}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-agent px-4 font-extrabold text-on-agent no-underline hover:bg-agent-raised hover:text-on-agent lg:ml-auto"
          >
            Ask for a new recipe
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter recipes">
        <label className="flex min-h-11 w-full items-center gap-2 rounded-md border-[1.5px] border-line-strong bg-card px-3 sm:w-[260px]">
          <span className="sr-only">Search recipes</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
            className="text-ink-faint"
          >
            <path d="M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14zM21 21l-5-5" />
          </svg>
          <input
            type="search"
            placeholder="Dish, ingredient…"
            defaultValue={filters.q}
            onChange={(e) => {
              set({ q: e.target.value });
            }}
            className="min-w-0 grow border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
        </label>
        <label className="sr-only" htmlFor="filter-slot">
          Meal
        </label>
        <select
          id="filter-slot"
          value={filters.slot}
          onChange={(e) => {
            set({ slot: e.target.value });
          }}
          className={filters.slot === "" ? selectCls : `${selectCls} bg-ink text-paper`}
        >
          <option value="">All meals</option>
          {data.basics.slots.map((s) => (
            <option key={s.id} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={filters.packable}
          className={chip(filters.packable)}
          onClick={() => {
            set({ packable: filters.packable ? null : "1" });
          }}
        >
          Packable
        </button>
        <label className="sr-only" htmlFor="filter-cuisine">
          Cuisine
        </label>
        <select
          id="filter-cuisine"
          value={filters.cuisine}
          onChange={(e) => {
            set({ cuisine: e.target.value });
          }}
          className={filters.cuisine === "" ? selectCls : `${selectCls} bg-ink text-paper`}
        >
          <option value="">Any cuisine</option>
          {cuisineKeys.map((k) => (
            <option key={k} value={k}>
              {data.cuisines.get(k) ?? titleCase(k)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-protein">
          Main protein
        </label>
        <select
          id="filter-protein"
          value={filters.protein}
          disabled={det === null}
          onChange={(e) => {
            set({ protein: e.target.value });
          }}
          className={filters.protein === "" ? selectCls : `${selectCls} bg-ink text-paper`}
        >
          <option value="">Main protein</option>
          {proteins.map((p) => (
            <option key={p} value={p}>
              {PROTEINS[p] ?? titleCase(p)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={filters.rated}
          className={chip(filters.rated)}
          onClick={() => {
            set({ rating: filters.rated ? null : "4" });
          }}
        >
          4 stars and up
        </button>
        <button
          type="button"
          aria-pressed={filters.fresh}
          className={chip(filters.fresh, "agent")}
          onClick={() => {
            set({ new: filters.fresh ? null : "1" });
          }}
        >
          New
        </button>
      </div>
      <p className="sr-only" role="status">
        {shown.length} recipe{shown.length === 1 ? "" : "s"} shown
      </p>
      {shown.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon="recipes"
          title="No recipe matches"
          description="Clear a filter, or ask the assistant for a new recipe."
          action={
            <Link href="/recipes" className="font-extrabold">
              Clear filters
            </Link>
          }
        />
      ) : (
        <ul
          className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-label="Recipes"
        >
          {shown.map((d) => {
            const dish = det?.dishes.get(d.id);
            const rating = det?.usage.ratings.get(d.id);
            const retired = d.status === "retired";
            return (
              <li key={d.id} className={retired ? "opacity-70" : ""}>
                <Link
                  href={`/recipes/${d.id}`}
                  className="relative flex h-full flex-col overflow-hidden rounded-[18px] bg-card text-ink no-underline shadow-card hover:text-ink"
                  data-testid="recipe-card"
                >
                  {isNew(d, data.basics.today) && (
                    <span className="absolute top-2.5 right-2.5 rounded-full bg-agent px-2.5 py-1 text-xs font-extrabold text-on-agent">
                      NEW · AI
                    </span>
                  )}
                  <DishArt
                    dishId={d.id}
                    cuisineKey={d.cuisineKey}
                    className="h-[120px]"
                    muted={retired}
                  />
                  <span className="flex flex-col gap-1 p-3">
                    <span className="font-extrabold">{d.name}</span>
                    <span className="text-[13px] text-ink-muted">
                      {data.cuisines.get(d.cuisineKey) ?? titleCase(d.cuisineKey)} ·{" "}
                      {retired ? "Retired" : subline(d, dish, slotLabel)}
                    </span>
                    {rating === undefined ? (
                      <span className="text-[13px] font-extrabold text-ink-muted">
                        {det === null ? " " : "No reviews yet"}
                      </span>
                    ) : (
                      <span
                        className={`flex items-center gap-1.5 text-[13px] font-extrabold ${rating.mean < 3 ? "text-pomegranate-text" : "text-saffron-text"}`}
                      >
                        <StarRatingDisplay value={rating.mean} size={14} />
                        {rating.mean.toFixed(1)} · {rating.count} review
                        {rating.count === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
