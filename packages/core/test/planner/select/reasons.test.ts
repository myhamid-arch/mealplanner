// Leaf 1.4.10 G1 (W-12, PLN-9 reasons, UX-7): the planner's score reasons are plain words. They
// name ingredients by catalogue display name and cuisines by their data/cuisines.json label. No
// reason contains a slug, a snake_case key or a raw id, over the F1 week plans for seeds 1–10.
// After a substitution, no reason names the replaced ingredient. Negative controls: the same
// checks fail on today's labels (slug for ingredients, key for cuisines) and on the pre-fix wording
// that named the previous meal by its dish name.
import { beforeAll, describe, expect, it } from "vitest";
import { planDays, type PlanDish, type PlanResult } from "../../../src/planner/select/index.js";
import { varietyOf } from "../../../src/planner/select/score.js";
import { F1_WEEK, f1PlanConfig } from "./f1.js";
import { ingredientId, type SeedLibrary } from "./library.js";
import { seedLibrary } from "./support.js";

declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { eager: true; import: "default" }): Record<string, T>;
  }
}

const only = <T>(files: Record<string, T>): T => {
  const [value] = Object.values(files);
  if (value === undefined) throw new Error("data file not found");
  return value;
};
const INGREDIENTS = only(
  import.meta.glob<{ ingredients: Array<{ slug: string; name: string }> }>(
    "../../../../../data/ingredients.v1.json",
    { eager: true, import: "default" },
  ),
).ingredients;
const CUISINES = only(
  import.meta.glob<Array<{ key: string; label: string }>>("../../../../../data/cuisines.json", {
    eager: true,
    import: "default",
  }),
);

const NAME_BY_ID = new Map(INGREDIENTS.map((i) => [ingredientId(i.slug), i.name]));
const LABEL_BY_KEY = new Map(CUISINES.map((c) => [c.key, c.label]));
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type Labels = {
  name: (id: string, slug: string) => string;
  cuisine: (key: string) => string;
};
/** The loader's labels (R-68): catalogue display names and cuisine labels. */
const CATALOGUE: Labels = {
  name: (id) => {
    const n = NAME_BY_ID.get(id);
    if (n === undefined) throw new Error(`no catalogue name for ${id}`);
    return n;
  },
  cuisine: (key) => {
    const l = LABEL_BY_KEY.get(key);
    if (l === undefined) throw new Error(`no label for cuisine ${key}`);
    return l;
  },
};
/** Negative control: today's labels, the slug for ingredients and the key for cuisines. */
const TODAY: Labels = { name: (_id, slug) => slug, cuisine: (key) => key };

function labelled(d: PlanDish, labels: Labels): PlanDish {
  return {
    ...d,
    cuisineLabel: labels.cuisine(d.cuisineKey),
    components: d.components.map((c) => ({
      ...c,
      variants: c.variants.map((v) => ({
        ...v,
        ingredients: v.ingredients.map((i) => ({ ...i, name: labels.name(i.id, i.slug) })),
      })),
    })),
  };
}

/** A copy of `d` with ingredient `from` replaced by `to`, as 1.4.8's `replaced()` makes it. */
function substituted(d: PlanDish, from: string, to: string): PlanDish {
  const uses = d.components.some((c) =>
    c.variants.some((v) => v.ingredients.some((i) => i.id === from)),
  );
  if (!uses) return d;
  const toSlug = to.replace(/^ing:/, "");
  return {
    ...d,
    id: `${d.id}~sub`,
    name: `${d.name} (with ${NAME_BY_ID.get(to) ?? toSlug})`,
    components: d.components.map((c) => ({
      ...c,
      variants: c.variants.map((v) => ({
        ...v,
        input: {
          ...v.input,
          ingredients: v.input.ingredients.map((l) =>
            l.ingredientId === from ? { ...l, ingredientId: to } : l,
          ),
        },
        ingredients: v.ingredients.map((i) =>
          i.id === from ? { ...i, id: to, slug: toSlug, name: NAME_BY_ID.get(to) ?? toSlug } : i,
        ),
      })),
    })),
  };
}

async function planWeek(lib: SeedLibrary, dishes: PlanDish[], seed: number): Promise<PlanResult> {
  return planDays(
    { config: f1PlanConfig(), dates: F1_WEEK, dishes, adjusters: lib.adjusters },
    { seed },
  );
}

const reasonsOf = (plan: PlanResult) =>
  plan.days.flatMap((d) =>
    d.meals.flatMap((m) =>
      m.scoreBreakdown.reasons.map((r) => ({ at: `${m.date} ${m.slotKey}`, reason: r })),
    ),
  );

// ------------------------------------------------------------------------------------------------
// The check (also run by scripts/verify/leaf-1.4.10.mjs through these tests)
// ------------------------------------------------------------------------------------------------

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const SNAKE = /\b[a-z0-9]+_[a-z0-9_]+\b/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every problem with one reason: an ingredient slug or dish id (hyphenated), an `ing:` id, a uuid, a snake_case
 * key, a lower-case cuisine key used as a word, an ingredient list that is not made of catalogue
 * display names, or a cuisine sentence without a cuisines.json label.
 */
function problemsOf(reason: string, lib: SeedLibrary): string[] {
  const out: string[] = [];
  if (reason.includes("ing:")) out.push("raw ingredient id");
  if (UUID.test(reason)) out.push("uuid");
  if (SNAKE.test(reason)) out.push(`snake_case key "${SNAKE.exec(reason)?.[0] ?? ""}"`);
  const tokens = reason.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) ?? [];
  const slugs = new Set([
    ...lib.rows.keys(),
    ...lib.dishes.map((d) => d.id),
    ...lib.adjusters.map((d) => d.id),
  ]);
  for (const t of tokens) if (slugs.has(t)) out.push(`slug "${t}"`);
  for (const key of LABEL_BY_KEY.keys())
    if (new RegExp(`(^|[^A-Za-z_])${escape(key)}([^A-Za-z_]|$)`).test(reason))
      out.push(`cuisine key "${key}"`);
  const list =
    /^(?:Reuses (.+) from other meals (?:this week|in these \d+ days)|New (?:this week|in these \d+ days): (.+))$/.exec(
      reason,
    );
  if (list !== null && !tiledByNames(list[1] ?? list[2] ?? ""))
    out.push("ingredient list is not made of catalogue display names");
  const cuisine =
    /^(.+) food is already on \d+ other days? /.exec(reason) ??
    /^Also (.+), like the [a-z -]+ before it$/.exec(reason);
  if (cuisine !== null && ![...LABEL_BY_KEY.values()].includes(cuisine[1] ?? ""))
    out.push(`cuisine "${cuisine[1] ?? ""}" is not a cuisines.json label`);
  return out;
}

const NAMES = new Set(NAME_BY_ID.values());
/** True when `text` is catalogue display names joined with ", " (names may contain ", "). */
function tiledByNames(text: string): boolean {
  const parts = text.split(", ");
  const ok: boolean[] = [true];
  for (let end = 1; end <= parts.length; end++) {
    ok[end] = false;
    for (let start = 0; start < end && !ok[end]; start++)
      ok[end] = ok[start] === true && NAMES.has(parts.slice(start, end).join(", "));
  }
  return ok[parts.length] === true;
}

function problems(plan: PlanResult, lib: SeedLibrary): string[] {
  return reasonsOf(plan).flatMap(({ at, reason }) =>
    problemsOf(reason, lib).map((p) => `${at}: ${p} in "${reason}"`),
  );
}

// ------------------------------------------------------------------------------------------------

let lib: SeedLibrary;
const plans = new Map<number, PlanResult>();

beforeAll(async () => {
  lib = seedLibrary();
  const dishes = lib.dishes.map((d) => labelled(d, CATALOGUE));
  for (const seed of SEEDS) plans.set(seed, await planWeek(lib, dishes, seed));
}, 600_000);

describe("W-12 plain reasons over the F1 week, seeds 1–10", () => {
  it("no reason names a slug, a snake_case key or a raw id; ingredient lists are display names", () => {
    const found = SEEDS.flatMap((seed) => {
      const plan = plans.get(seed);
      if (plan === undefined) throw new Error(`no plan for seed ${String(seed)}`);
      return problems(plan, lib).map((p) => `seed ${String(seed)} ${p}`);
    });
    const checked = SEEDS.reduce((n, s) => n + reasonsOf(plans.get(s) as PlanResult).length, 0);
    process.stdout.write(`W-12 reasons checked: ${String(checked)} over seeds 1–10\n`);
    expect(checked).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });

  it("the plans exercise the labelled reasons: ingredient lists and cuisine repeats occur", () => {
    const all = SEEDS.flatMap((s) => reasonsOf(plans.get(s) as PlanResult).map((r) => r.reason));
    expect(all.filter((r) => r.startsWith("Reuses ")).length).toBeGreaterThan(0);
    expect(all.filter((r) => r.startsWith("New this week: ")).length).toBeGreaterThan(0);
    expect(
      all.filter((r) => / food is already on \d+ other days? this week$/.test(r)).length,
    ).toBeGreaterThan(0);
  });

  it('cuisine repeats read "<Label> food is already on N other days this week"', () => {
    const all = SEEDS.flatMap((s) => reasonsOf(plans.get(s) as PlanResult).map((r) => r.reason));
    const repeat = all.find((r) => r.includes(" food is already on "));
    expect(repeat).toMatch(/^[A-Z][^_]* food is already on \d+ other days? this week$/);
  });

  it("negative control: today's labels (slug for ingredients, key for cuisines) fail the check", async () => {
    const plan = await planWeek(
      lib,
      lib.dishes.map((d) => labelled(d, TODAY)),
      1,
    );
    const found = problems(plan, lib);
    expect(found.some((p) => p.includes("slug"))).toBe(true);
    expect(found.some((p) => p.includes("cuisine key") || p.includes("snake_case"))).toBe(true);
  }, 120_000);
});

describe("W-12 after a substitution, no reason names the replaced ingredient", () => {
  // The ingredient is unavailable: every dish with it is replaced by its substituted copy, as
  // `plates.substitute` does for the affected meals (1.4.8). Olive oil → canola oil is 1.4.8's
  // case; tahini → peanut butter has seed dishes named after it ("… bulgur and tahini").
  const CASES = [
    { from: "olive-oil", to: "canola-oil" },
    { from: "tahini", to: "peanut-butter" },
  ] as const;

  for (const { from, to } of CASES)
    it(`${from} → ${to}: the week's reasons never name it`, async () => {
      const fromId = ingredientId(from);
      const replacedName = NAME_BY_ID.get(fromId) ?? "";
      expect(replacedName).not.toBe("");
      const dishes = lib.dishes
        .map((d) => substituted(d, fromId, ingredientId(to)))
        .map((d) => labelled(d, CATALOGUE));
      expect(
        dishes.some((d) => d.name.includes(` (with ${NAME_BY_ID.get(ingredientId(to)) ?? ""})`)),
      ).toBe(true);
      for (const seed of [1, 2, 3]) {
        const plan = await planWeek(lib, dishes, seed);
        const named = reasonsOf(plan).filter(({ reason }) =>
          new RegExp(`\\b${escape(replacedName)}\\b|\\b${escape(from)}\\b`, "i").test(reason),
        );
        expect(named).toEqual([]);
        expect(problems(plan, lib)).toEqual([]);
      }
    }, 300_000);

  it("negative control: naming the previous meal by its dish name (pre-fix) names the replaced ingredient", () => {
    const copy = lib.dishes
      .map((d) => substituted(d, ingredientId("tahini"), ingredientId("peanut-butter")))
      .find((d) => d.name.toLowerCase().includes("tahini"));
    if (copy === undefined) throw new Error("no seed dish is named after tahini");
    const base = {
      dish: copy,
      mainProtein: "p",
      window: { ingredients: new Set<string>(), cuisineMealDays: 0 },
      label: { cuisine: CATALOGUE.cuisine },
    };
    const previous = { cuisineKey: copy.cuisineKey, mainProtein: "p", dishName: copy.name };
    const preFix = varietyOf({ ...base, previous });
    expect(preFix.penalties.some((p) => /tahini/i.test(p))).toBe(true);
    const fixed = varietyOf({ ...base, previous: { ...previous, mealLabel: "lunch" } });
    expect(fixed.penalties.length).toBe(preFix.penalties.length);
    expect(fixed.penalties.some((p) => /tahini/i.test(p))).toBe(false);
  });
});
