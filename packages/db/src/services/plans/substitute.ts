// `plates.substitute` (R2-UX-1, KG-4.3; BLD-8 R-40): the kitchen flags an ingredient unavailable on
// a date. For every stored meal from that date through the next SUBSTITUTE_DAYS − 1 days whose
// plates use a variant containing the ingredient, the household gets a copy of the dish with the
// ingredient replaced by the knowledge graph's best substitute (same raw grams; exclusions already
// applied by the graph, R-34/R-36), and the meal is re-solved with the copy (PLN-13). Adjuster
// sides with the ingredient are left out of every re-solve, so meals that carried one are re-solved
// with their own dish. The copies
// and the swaps are one change set, so an admin sees and can undo the whole result. The graph is
// injected (`db` does not import `graph`, ARC-3). The copy's component names, variant labels and
// steps name the substitute (W-6, BLD-8 R-58/R-60).
import { variantNutritionPer100gCooked } from "@mealplanner/core/nutrition";
import type { ChangeOp } from "@mealplanner/core/changes";
import type { PlanDish } from "@mealplanner/core/planner";
import type { HouseholdContext } from "@mealplanner/core/types";
import { eq } from "drizzle-orm";
import { createRepos, type Executor } from "../../repos/index.js";
import { ingredient } from "../../schema/index.js";
import { copyPayload, dishTree, freeSlug, type TreeComponent } from "./dish-tree.js";
import { newId } from "../../schema/ids.js";
import { addDays, loadPlanInput } from "./load-input.js";
import { resolvePlates, solveMealWith, type MealState, type ResolveReport } from "./meal.js";
import type { ChangeActorInput } from "./store.js";
import { PlanServiceError } from "./errors.js";

/** The flagged date and the six days after it. */
export const SUBSTITUTE_DAYS = 7;

export type SubstitutesPort = (
  ingredientId: string,
) => Promise<ReadonlyArray<{ ingredientId: string; weight: number }>>;

export interface SubstituteReport extends ResolveReport {
  ingredientId: string;
  substituteId: string | null;
  /** The household copies made: original dish → copy. */
  copies: Array<{ fromDishId: string; toDishId: string; name: string }>;
  /** Affected meals no substitute could serve. */
  unresolved: string[];
}

/** An ingredient's names as a text may mention it: display name and aliases (W-6). */
export interface IngredientNames {
  name: string;
  aliases: readonly string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * W-6 (BLD-8 R-58, R-60; leaf-1.4.8 SPEC-Q-6): `text` with every mention of `from` (display name or
 * alias, case-insensitive, whole word, longest first) replaced by `to`'s display name, capitalised
 * when the mention is, otherwise lower case. `matched` says whether anything was replaced.
 */
export function substitutedText(
  text: string,
  from: IngredientNames,
  to: { name: string },
): { text: string; matched: boolean } {
  const names = [...new Set([from.name, ...from.aliases].map((n) => n.trim()))]
    .filter((n) => n !== "")
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return { text, matched: false };
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  let matched = false;
  const lower = to.name.charAt(0).toLowerCase() + to.name.slice(1);
  const upper = to.name.charAt(0).toUpperCase() + to.name.slice(1);
  const out = text.replace(pattern, (hit: string) => {
    matched = true;
    const first = hit.charAt(0);
    return first !== first.toLowerCase() ? upper : lower;
  });
  return { text: out, matched };
}

/**
 * W-6: a variant's steps naming the substitute. When no step names the ingredient, a leading step
 * "Use <substitute> wherever <ingredient> is mentioned." is added, so the cook never reads the
 * unavailable ingredient without being told what replaces it.
 */
export function substitutedSteps(
  steps: readonly string[],
  from: IngredientNames,
  to: { name: string },
): string[] {
  const rewritten = steps.map((step) => substitutedText(step, from, to));
  if (rewritten.some((r) => r.matched)) return rewritten.map((r) => r.text);
  const sub = to.name.charAt(0).toLowerCase() + to.name.slice(1);
  const ing = from.name.charAt(0).toLowerCase() + from.name.slice(1);
  return [`Use ${sub} wherever ${ing} is mentioned.`, ...steps];
}

/**
 * The household copy of `dish` with ingredient `from` replaced by `to`: same raw grams, nutrition
 * recomputed, and (W-6) the component names, variant labels and steps of the variants that
 * contain it naming the substitute. The dish description is left as it is (R-60); the copy's
 * name says "(with <substitute>)".
 */
export function replaced(
  dish: PlanDish,
  from: string,
  to: string,
  catalogue: MealState["pool"]["catalog"],
  fromNames: IngredientNames,
): PlanDish {
  const sub = catalogue.ingredients.get(to);
  if (sub === undefined)
    throw new PlanServiceError("invalid", `ingredient ${to} is not in the catalogue`);
  const toNames = { name: sub.name };
  return {
    ...dish,
    id: newId(),
    name: `${dish.name} (with ${sub.name})`,
    status: "active",
    components: dish.components.map((c) => ({
      ...c,
      id: newId(),
      name: c.variants.some((v) => v.input.ingredients.some((l) => l.ingredientId === from))
        ? substitutedText(c.name, fromNames, toNames).text
        : c.name,
      variants: c.variants.map((v) => {
        const has = v.input.ingredients.some((l) => l.ingredientId === from);
        const input = {
          ...v.input,
          ingredients: v.input.ingredients.map((l) =>
            l.ingredientId === from ? { ...l, ingredientId: to } : l,
          ),
        };
        const ids = [...new Set(input.ingredients.map((l) => l.ingredientId))];
        return {
          ...v,
          id: newId(),
          label: has ? substitutedText(v.label, fromNames, toNames).text : v.label,
          steps: has ? substitutedSteps(v.steps, fromNames, toNames) : v.steps,
          input,
          per100g: variantNutritionPer100gCooked(input, catalogue.context).per100g,
          ingredients: ids.map((id) => {
            const row = catalogue.ingredients.get(id);
            if (row === undefined)
              throw new PlanServiceError("invalid", `ingredient ${id} missing`);
            return { id, slug: row.slug, category: row.category, dietaryFlags: row.dietaryFlags };
          }),
        };
      }),
    })),
  };
}

/**
 * The adjusters `keep` rejects, marked retired: the planner no longer offers them, but still knows
 * them (a locked meal of the day that carries one keeps its cook sheet).
 */
export function withoutAdjusters(
  adjusters: readonly PlanDish[],
  keep: (a: PlanDish) => boolean,
): PlanDish[] {
  return adjusters.map((a) => (keep(a) ? a : { ...a, status: "retired" as const }));
}

function contains(dish: PlanDish, ingredientId: string): boolean {
  return dish.components.some((c) =>
    c.variants.some((v) => v.input.ingredients.some((l) => l.ingredientId === ingredientId)),
  );
}

function uses(dish: PlanDish, ingredientId: string, variantIds: ReadonlySet<string>): boolean {
  return dish.components.some((c) =>
    c.variants.some(
      (v) =>
        variantIds.has(v.id) && v.input.ingredients.some((l) => l.ingredientId === ingredientId),
    ),
  );
}

export async function substituteUnavailable(
  db: Executor,
  ctx: HouseholdContext,
  args: { date: string; ingredientId: string; substitutes: SubstitutesPort; by: ChangeActorInput },
): Promise<SubstituteReport> {
  const to = addDays(args.date, SUBSTITUTE_DAYS - 1);
  const dates = (await createRepos(db, ctx).plan_day.list())
    .map((d) => d.date)
    .filter((d) => d >= args.date && d <= to)
    .sort();
  const report: SubstituteReport = {
    changeSetId: null,
    meals: 0,
    flagged: [],
    skipped: [],
    ingredientId: args.ingredientId,
    substituteId: null,
    copies: [],
    unresolved: [],
  };
  if (dates.length === 0) return report;
  const { input, pool, stored } = await loadPlanInput(db, ctx, { dates });
  // Adjuster sides with the ingredient cannot be served either: the re-solve leaves them out.
  const adjusterFilter = (a: PlanDish) => !contains(a, args.ingredientId);
  const state: MealState = {
    config: input.config,
    pool: { ...pool, adjusters: withoutAdjusters(pool.adjusters, adjusterFilter) },
    stored,
  };
  const inWindow = stored.filter((m) => m.date >= args.date && m.date <= to);
  // Variants on the plates: the dish's items and the adjuster sides.
  const servedOf = (m: (typeof stored)[number]) =>
    new Set(
      m.plates.flatMap((p) => [
        ...p.solution.items.map((i) => i.variantId),
        ...p.solution.adjusters.map((a) => a.variantId),
      ]),
    );
  const affected = inWindow.filter((m) => {
    const dish = pool.byId.get(m.dishId);
    return dish !== undefined && uses(dish, args.ingredientId, servedOf(m));
  });
  // Meals whose own dish is fine but whose plates carry an adjuster side with the ingredient.
  const sideOnly = inWindow.filter(
    (m) =>
      !affected.includes(m) &&
      pool.adjusters.some((a) => !adjusterFilter(a) && uses(a, args.ingredientId, servedOf(m))),
  );
  if (affected.length === 0 && sideOnly.length === 0) return report;

  const [fromRow] = await db
    .select({ name: ingredient.name, aliases: ingredient.aliases })
    .from(ingredient)
    .where(eq(ingredient.id, args.ingredientId));
  const fromNames: IngredientNames = {
    name: fromRow?.name ?? pool.catalog.ingredients.get(args.ingredientId)?.name ?? "",
    aliases: fromRow?.aliases ?? [],
  };
  const candidates = (await args.substitutes(args.ingredientId)).filter((c) =>
    pool.catalog.ingredients.has(c.ingredientId),
  );
  const copies = new Map<string, PlanDish>();
  const originals = new Map<string, PlanDish>();
  const chosen = new Map<string, string>();
  for (const candidate of candidates) {
    const pending = affected.filter((m) => !chosen.has(m.id));
    if (pending.length === 0) break;
    for (const meal of pending) {
      const original = pool.byId.get(meal.dishId);
      if (original === undefined) continue;
      const key = `${original.id}|${candidate.ingredientId}`;
      const copy =
        copies.get(key) ??
        replaced(original, args.ingredientId, candidate.ingredientId, pool.catalog, fromNames);
      if ((await solveMealWith(state, meal, copy)) === null) continue;
      copies.set(key, copy);
      originals.set(copy.id, original);
      chosen.set(meal.id, copy.id);
      report.substituteId ??= candidate.ingredientId;
    }
  }
  for (const meal of sideOnly) {
    const own = pool.byId.get(meal.dishId);
    if (own !== undefined && (await solveMealWith(state, meal, own)) !== null)
      chosen.set(meal.id, own.id);
  }
  report.unresolved = [...affected, ...sideOnly].filter((m) => !chosen.has(m.id)).map((m) => m.id);
  if (chosen.size === 0) return report;

  const used = [...copies.values()].filter((c) => [...chosen.values()].includes(c.id));
  const createOps: ChangeOp[] = [];
  for (const copy of used) {
    const original = originals.get(copy.id);
    if (original === undefined) throw new PlanServiceError("not_found", `original of ${copy.name}`);
    createOps.push(await copyOp(db, ctx, copy, original));
  }
  for (const [key, copy] of copies)
    if (used.includes(copy))
      report.copies.push({
        fromDishId: key.split("|")[0] ?? "",
        toDishId: copy.id,
        name: copy.name,
      });
  const resolved = await resolvePlates(db, ctx, {
    fromDate: args.date,
    toDate: to,
    by: args.by,
    summary: `Substitute an unavailable ingredient in ${String(chosen.size)} meal${chosen.size === 1 ? "" : "s"}`,
    onlyMealIds: new Set(chosen.keys()),
    extraDishes: used,
    dishFor: (m) => chosen.get(m.id) ?? m.dishId,
    leadingOps: createOps,
    adjusterFilter,
  });
  return { ...report, ...resolved, copies: report.copies, unresolved: report.unresolved };
}

/** `dish.create` for a household copy of the original with the in-memory copy's ids and lines. */
async function copyOp(
  db: Executor,
  ctx: HouseholdContext,
  copy: PlanDish,
  originalDish: PlanDish,
): Promise<ChangeOp> {
  const tree = await dishTree(db, originalDish.id);
  const components: TreeComponent[] = tree.components.map((c, ci) => {
    const cc = copy.components[ci];
    if (cc === undefined) throw new PlanServiceError("invalid", "copy does not match its dish");
    return {
      ...c,
      id: cc.id,
      name: cc.name,
      variants: c.variants.map((v, vi) => {
        const cv = cc.variants[vi];
        if (cv === undefined) throw new PlanServiceError("invalid", "copy does not match its dish");
        return {
          ...v,
          id: cv.id,
          label: cv.label,
          steps: [...cv.steps],
          ingredients: v.ingredients.map((l, li) => ({
            ...l,
            ingredientId: cv.input.ingredients[li]?.ingredientId ?? l.ingredientId,
          })),
        };
      }),
    };
  });
  const slug = await freeSlug(db, ctx.householdId, `${tree.dish.slug}-sub`);
  return {
    kind: "dish.create",
    payload: copyPayload(tree, { id: copy.id, name: copy.name, slug, components }),
  };
}
