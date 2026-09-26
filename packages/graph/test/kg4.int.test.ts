// G2 (KG-4): similarDishes ranks a hand-built near-duplicate first; substitutes respect household
// exclusions (SPEC-Q-2, SPEC-Q-3, R-35, R-36). Also KG-4.2 palette and FBK-4 kgSimilarityTerm on
// the real library.
import { appendFileSync, readFileSync } from "node:fs";
import type { ExclusionRow } from "@mealplanner/core/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandPalette } from "../src/palette/index.js";
import { kgSimilarityTerm } from "../src/similarity/index.js";
import { isExcluded, macroDistance } from "../src/store/index.js";
import { rebuildGraph } from "../src/sync/sync.js";
import type { SimilarDish, Substitute } from "../src/types/index.js";
import { createTestDatabase, dropAll, type TestDatabase } from "./support/db.js";
import { graphOn } from "./support/graph.js";
import {
  DATA_DIR,
  insertDish,
  insertExclusion,
  insertHousehold,
  insertMember,
  loadCatalogue,
  seedDish,
  seedDishes,
  variantOf,
  type Catalogue,
  type DishJson,
} from "./support/relational.js";

interface CatalogueEntry {
  slug: string;
  category: string;
  dietary_flags: string[];
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  kcal: number;
}
const CATALOGUE = (
  JSON.parse(readFileSync(`${DATA_DIR}/ingredients.v1.json`, "utf8")) as {
    ingredients: CatalogueEntry[];
  }
).ingredients;
const bySlug = new Map(CATALOGUE.map((i) => [i.slug, i]));
const NON_CORE = new Set(["herb_spice"]);

/**
 * A near-duplicate: the same dish with one core ingredient of its first component replaced by
 * another catalogue ingredient of the same category that the dish does not use.
 */
function nearDuplicate(dish: DishJson): { copy: DishJson; swap: [string, string] } {
  const used = new Set(
    dish.components.flatMap((c) =>
      c.variants.flatMap((v) => v.ingredients.map((i) => i.ingredient_slug)),
    ),
  );
  const first = dish.components[0]?.variants[0]?.ingredients.find(
    (i) =>
      i.ingredient_slug !== "water" && !NON_CORE.has(bySlug.get(i.ingredient_slug)?.category ?? ""),
  );
  if (first === undefined) throw new Error(`${dish.slug} has no core ingredient`);
  const category = bySlug.get(first.ingredient_slug)?.category;
  const other = CATALOGUE.find((i) => i.category === category && !used.has(i.slug));
  if (other === undefined) throw new Error(`no swap for ${first.ingredient_slug}`);
  const swap: [string, string] = [first.ingredient_slug, other.slug];
  return { copy: variantOf(dish, `${dish.slug}-ours`, `${dish.name} (our way)`, swap), swap };
}

const TARGETS = ["chicken-biryani", "shakshuka", "lemon-dill-salmon", "spaghetti-bolognese"];

/** The G2 ranking acceptance: `expected` is first, strictly above the runner-up. */
function rankedFirst(result: readonly SimilarDish[], expected: string): boolean {
  const [first, second] = result;
  return first?.dishId === expected && (second === undefined || first.sim > second.sim);
}

const measure = (record: Record<string, unknown>) => {
  const file = process.env.KG_MEASURE_FILE;
  if (file !== undefined && file !== "") appendFileSync(file, `${JSON.stringify(record)}\n`);
};

let db: TestDatabase;
let cat: Catalogue;
const ids: Record<string, string> = {};
const seedIds = new Map<string, string>();
const nearIds = new Map<string, string>();

beforeAll(async () => {
  db = await createTestDatabase();
  cat = await loadCatalogue(db.pool);
  for (const dish of seedDishes())
    seedIds.set(dish.slug, (await insertDish(db.pool, cat, dish, null)).dishId);
  ids.h1 = await insertHousehold(db.pool, "Household one");
  ids.h2 = await insertHousehold(db.pool, "Household two");
  ids.m1 = await insertMember(db.pool, ids.h1, "Adult A", true);
  ids.m2 = await insertMember(db.pool, ids.h1, "Child", false);
  for (const slug of TARGETS) {
    const { copy } = nearDuplicate(seedDish(slug));
    nearIds.set(slug, (await insertDish(db.pool, cat, copy, ids.h1)).dishId);
  }
  const { store, source } = graphOn(db.pool);
  await rebuildGraph(store, source);
}, 300_000);

afterAll(async () => {
  await dropAll([db]);
});

describe("G2 similarDishes (KG-4.1, KG-4.4)", () => {
  it("G2 similarDishes ranks each hand-built near-duplicate first, with shared ingredients in why", async () => {
    const { store } = graphOn(db.pool);
    for (const slug of TARGETS) {
      const target = seedIds.get(slug) as string;
      const near = nearIds.get(slug) as string;
      const result = await store.similarDishes(target, ids.h1 as string, 10);
      expect(result.length).toBeGreaterThan(1);
      expect(rankedFirst(result, near), `${slug}: ${JSON.stringify(result.slice(0, 2))}`).toBe(
        true,
      );
      expect(result[0]?.why[0]).toMatch(/^shares /);
      expect(result[0]?.why.some((w) => w.startsWith("same cuisine: "))).toBe(true);
      // Symmetric: from the near-duplicate, the original comes first.
      const back = await store.similarDishes(near, ids.h1 as string, 10);
      expect(rankedFirst(back, target), `${slug} back`).toBe(true);
      // Sorted best first, sims in (0, 1], the dish itself never listed.
      expect(result.every((r, i) => i === 0 || (result[i - 1]?.sim ?? 0) >= r.sim)).toBe(true);
      expect(result.every((r) => r.sim > 0 && r.sim <= 1 && r.dishId !== target)).toBe(true);
      measure({
        gate: "G2",
        check: "near-duplicate",
        dish: slug,
        firstIsNearDuplicate: result[0]?.dishId === near,
        firstSim: result[0]?.sim,
        secondSim: result[1]?.sim,
      });
    }
  });

  it("G2 negative control: without the near-duplicate (another household) the same acceptance fails", async () => {
    const { store } = graphOn(db.pool);
    for (const slug of TARGETS) {
      const result = await store.similarDishes(seedIds.get(slug) as string, ids.h2 as string, 10);
      expect(result.some((r) => r.dishId === nearIds.get(slug))).toBe(false);
      expect(rankedFirst(result, nearIds.get(slug) as string)).toBe(false);
    }
    measure({ gate: "G2", check: "negative-near-duplicate", accepted: false });
  });

  it("kgSimilarityTerm on the real library matches the hand computation over the member's scored dishes", async () => {
    const { store } = graphOn(db.pool);
    const similar = await store.similarDishes(
      seedIds.get("chicken-biryani") as string,
      ids.h1 as string,
      50,
    );
    const scores = new Map(
      similar.slice(0, 12).map((s, i) => [s.dishId, i % 2 === 0 ? 0.6 : -0.4]),
    );
    const top = similar.filter((s) => scores.has(s.dishId)).slice(0, 10);
    const expected =
      top.reduce((sum, s) => sum + s.sim * (scores.get(s.dishId) ?? 0), 0) /
      top.reduce((sum, s) => sum + s.sim, 0);
    expect(kgSimilarityTerm(similar, scores)).toBeCloseTo(expected, 12);
  });
});

describe("G2 substitutes (KG-4.3)", () => {
  const exclusionRows = async (hh: string) => graphOn(db.pool).source.exclusions(hh);
  const allSources = [
    ...new Set(
      readFileSync(`${DATA_DIR}/substitutes.csv`, "utf8")
        .trim()
        .split("\n")
        .slice(1)
        .map((l) => l.split(",")[0] as string),
    ),
  ];

  /** Every candidate `substitutes` returns for `hh` over the whole curated list, with violations of `rows`. */
  async function sweep(hh: string, rows: readonly ExclusionRow[]) {
    const { store } = graphOn(db.pool);
    let returned = 0;
    const violations: string[] = [];
    for (const slug of allSources) {
      const result = await store.substitutes(cat.ingredientId.get(slug) as string, hh, 100);
      returned += result.length;
      for (const s of result) {
        const entry = CATALOGUE.find((c) => cat.ingredientId.get(c.slug) === s.ingredientId);
        if (entry === undefined) throw new Error(`unknown substitute ${s.ingredientId}`);
        if (
          isExcluded(
            {
              id: s.ingredientId,
              slug: entry.slug,
              category: entry.category,
              dietaryFlags: entry.dietary_flags,
            },
            rows,
          )
        )
          violations.push(`${slug} → ${entry.slug}`);
      }
    }
    return { returned, violations };
  }

  const orderedByWeightThenDelta = (list: readonly Substitute[]) =>
    list.every((s, i) => {
      const prev = list[i - 1];
      return (
        prev === undefined ||
        prev.weight > s.weight ||
        (prev.weight === s.weight && macroDistance(prev.macroDelta) <= macroDistance(s.macroDelta))
      );
    });

  it("G2 substitutes are ranked by weight, then the smallest macro delta, with the catalogue's delta", async () => {
    const { store } = graphOn(db.pool);
    const chicken = cat.ingredientId.get("chicken-breast") as string;
    const result = await store.substitutes(chicken, ids.h1 as string, 10);
    expect(result.length).toBeGreaterThan(1);
    expect(orderedByWeightThenDelta(result)).toBe(true);
    const turkey = result.find((s) => s.ingredientId === cat.ingredientId.get("turkey-breast"));
    const a = bySlug.get("chicken-breast") as CatalogueEntry;
    const b = bySlug.get("turkey-breast") as CatalogueEntry;
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    expect(turkey?.macroDelta).toMatchObject({
      kcal: r3(b.kcal - a.kcal),
      protein: r3(b.protein_g - a.protein_g),
      carbs: r3(b.carbs_g - a.carbs_g),
      fat: r3(b.fat_g - a.fat_g),
    });
    // Every curated source ranks the same way.
    for (const slug of allSources)
      expect(
        orderedByWeightThenDelta(
          await store.substitutes(cat.ingredientId.get(slug) as string, ids.h1 as string, 100),
        ),
        slug,
      ).toBe(true);
  });

  it("G2 substitutes respect the household's exclusions (ingredient slug or id, category, dietary flag; household- and member-level)", async () => {
    const h1 = ids.h1 as string;
    const h2 = ids.h2 as string;
    const { store } = graphOn(db.pool);
    const sub = async (slug: string, hh: string) =>
      (await store.substitutes(cat.ingredientId.get(slug) as string, hh, 100)).map(
        (s) => CATALOGUE.find((c) => cat.ingredientId.get(c.slug) === s.ingredientId)?.slug,
      );
    expect(await sub("chicken-breast", h1)).toContain("turkey-breast");
    expect(await sub("chicken-breast", h1)).toContain("chicken-thigh");
    expect(await sub("hammour", h1)).toContain("sea-bass");
    const beefMinceSubs = await sub("beef-mince", h1);
    expect(beefMinceSubs.some((s) => bySlug.get(s ?? "")?.category === "red_meat")).toBe(true);

    await insertExclusion(db.pool, h1, {
      memberId: ids.m1 as string,
      kind: "ingredient",
      key: "turkey-breast",
      reason: "dislike",
      hard: false,
    });
    await insertExclusion(db.pool, h1, {
      memberId: null,
      kind: "ingredient",
      key: cat.ingredientId.get("chicken-thigh") as string,
      reason: "other",
      hard: true,
    });
    await insertExclusion(db.pool, h1, {
      memberId: ids.m2 as string,
      kind: "dietary_flag",
      key: "contains_fish",
      reason: "allergy",
      hard: true,
    });
    await insertExclusion(db.pool, h1, {
      memberId: null,
      kind: "category",
      key: "red_meat",
      reason: "religious",
      hard: true,
    });

    expect(await sub("chicken-breast", h1)).not.toContain("turkey-breast");
    expect(await sub("chicken-breast", h1)).not.toContain("chicken-thigh");
    expect(await sub("hammour", h1)).toEqual([]);
    expect(
      (await sub("beef-mince", h1)).some((s) => bySlug.get(s ?? "")?.category === "red_meat"),
    ).toBe(false);
    // Another household's exclusions do not apply.
    expect(await sub("chicken-breast", h2)).toContain("turkey-breast");

    const rows = await exclusionRows(h1);
    expect(rows).toHaveLength(4);
    const own = await sweep(h1, rows);
    expect(own.returned).toBeGreaterThan(0);
    expect(own.violations).toEqual([]);
    measure({
      gate: "G2",
      check: "exclusions",
      returned: own.returned,
      violations: own.violations.length,
    });
  });

  it("G2 negative control: the same exclusion sweep over a household without them finds violations", async () => {
    const rows = await exclusionRows(ids.h1 as string);
    const other = await sweep(ids.h2 as string, rows);
    expect(other.violations.length).toBeGreaterThan(0);
    measure({ gate: "G2", check: "negative-exclusions", violations: other.violations.length });
  });
});

describe("palette (KG-4.2)", () => {
  it("expands the window through PAIRS_WITH and TYPICAL_IN, excluding the window itself", async () => {
    const { store } = graphOn(db.pool);
    const window = ["chicken-thigh", "basmati-rice"].map((s) => cat.ingredientId.get(s) as string);
    const palette = await expandPalette(store, {
      householdId: ids.h1 as string,
      ingredientIds: window,
      cuisineKeys: ["indian"],
      limit: 15,
    });
    expect(palette.length).toBe(15);
    expect(palette.some((p) => window.includes(p.ingredientId))).toBe(false);
    expect(palette.every((p, i) => i === 0 || (palette[i - 1]?.score ?? 0) >= p.score)).toBe(true);
    expect(palette.some((p) => p.why.some((w) => w.startsWith("pairs with ")))).toBe(true);
    expect(palette.some((p) => p.why.some((w) => w === "typical in Indian"))).toBe(true);
    // The top candidate's score is the sum of its contributing edge weights.
    const top = palette[0];
    if (top === undefined) throw new Error("empty palette");
    const node = await store.findNode("Ingredient", top.ingredientId, ids.h1);
    let sum = 0;
    for (const w of window) {
      const src = await store.findNode("Ingredient", w, ids.h1);
      for (const n of await store.neighbours(src?.id ?? "", "PAIRS_WITH", {
        householdId: ids.h1 as string,
      }))
        if (n.nodeId === node?.id) sum += n.weight;
    }
    const indian = await store.findNode("Cuisine", "indian");
    for (const n of await store.incoming(indian?.id ?? "", "TYPICAL_IN", {
      householdId: ids.h1 as string,
    }))
      if (n.nodeId === node?.id) sum += n.weight;
    expect(top.score).toBeCloseTo(sum, 3);
  });
});
