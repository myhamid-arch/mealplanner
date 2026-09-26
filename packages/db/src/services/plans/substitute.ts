// `plates.substitute` (R2-UX-1, KG-4.3; BLD-8 R-40): the kitchen flags an ingredient unavailable on
// a date. For every stored meal from that date through the next SUBSTITUTE_DAYS − 1 days whose
// plates use a variant containing the ingredient, the household gets a copy of the dish with the
// ingredient replaced by the knowledge graph's best substitute (same raw grams; exclusions already
// applied by the graph, R-34/R-36), and the meal is re-solved with the copy (PLN-13). The copies
// and the swaps are one change set, so an admin sees and can undo the whole result. The graph is
// injected (`db` does not import `graph`, ARC-3).
import { variantNutritionPer100gCooked } from "@mealplanner/core/nutrition";
import type { ChangeOp } from "@mealplanner/core/changes";
import type { PlanDish } from "@mealplanner/core/planner";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
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

function replaced(
  dish: PlanDish,
  from: string,
  to: string,
  catalogue: MealState["pool"]["catalog"],
): PlanDish {
  const sub = catalogue.ingredients.get(to);
  if (sub === undefined)
    throw new PlanServiceError("invalid", `ingredient ${to} is not in the catalogue`);
  return {
    ...dish,
    id: newId(),
    name: `${dish.name} (with ${sub.name})`,
    status: "active",
    components: dish.components.map((c) => ({
      ...c,
      id: newId(),
      variants: c.variants.map((v) => {
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
  const state: MealState = { config: input.config, pool, stored };
  const affected = stored.filter((m) => {
    if (m.date < args.date || m.date > to) return false;
    const dish = pool.byId.get(m.dishId);
    const served = new Set(m.plates.flatMap((p) => p.solution.items.map((i) => i.variantId)));
    return dish !== undefined && uses(dish, args.ingredientId, served);
  });
  if (affected.length === 0) return report;

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
        replaced(original, args.ingredientId, candidate.ingredientId, pool.catalog);
      if ((await solveMealWith(state, meal, copy)) === null) continue;
      copies.set(key, copy);
      originals.set(copy.id, original);
      chosen.set(meal.id, copy.id);
      report.substituteId ??= candidate.ingredientId;
    }
  }
  report.unresolved = affected.filter((m) => !chosen.has(m.id)).map((m) => m.id);
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
  });
  return { ...report, ...resolved, copies: report.copies, unresolved: report.unresolved };
}

/** `dish.create` for a household copy, from the original dish row and the in-memory copy. */
async function copyOp(
  db: Executor,
  ctx: HouseholdContext,
  copy: PlanDish,
  originalDish: PlanDish,
): Promise<ChangeOp> {
  const r = createRepos(db, ctx);
  const row = await r.dish.get({ id: originalDish.id });
  if (row === null) throw new PlanServiceError("not_found", `dish ${originalDish.id} not found`);
  const taken = new Set(
    (await r.dish.list()).filter((d) => d.householdId === ctx.householdId).map((d) => d.slug),
  );
  let slug = `${row.slug}-sub`.slice(0, 110);
  for (let i = 2; taken.has(slug); i++) slug = `${row.slug.slice(0, 100)}-sub-${String(i)}`;
  const components = [];
  for (const [ci, c] of copy.components.entries()) {
    const oc = originalDish.components[ci];
    const componentRow = oc === undefined ? null : await r.component.get({ id: oc.id });
    if (componentRow === null || oc === undefined)
      throw new PlanServiceError("not_found", "component missing");
    const variants = [];
    for (const [vi, v] of c.variants.entries()) {
      const ov = oc.variants[vi];
      const variantRow = ov === undefined ? null : await r.variant.get({ id: ov.id });
      if (variantRow === null || ov === undefined)
        throw new PlanServiceError("not_found", "variant missing");
      const lines = await r.variant_ingredient.list({ variantId: ov.id });
      variants.push({
        id: v.id,
        methodId: variantRow.methodId,
        label: variantRow.label,
        isDefault: variantRow.isDefault,
        steps: variantRow.steps,
        cookTimeMin: variantRow.cookTimeMin,
        notes: variantRow.notes,
        referenceBatchCookedG: variantRow.referenceBatchCookedG,
        ingredients: lines
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((l, li) => ({
            ingredientId: v.input.ingredients[li]?.ingredientId ?? l.ingredientId,
            rawGPerBatch: l.rawGPerBatch,
            roleNote: l.roleNote,
            isAbsorbedOil: l.isAbsorbedOil,
            cookingLiquid: l.cookingLiquid,
            yieldOverride: l.yieldOverride,
          })),
      });
    }
    components.push({
      id: c.id,
      name: componentRow.name,
      role: componentRow.role,
      portioning: componentRow.portioning,
      unitLabel: componentRow.unitLabel,
      minServingG: componentRow.minServingG,
      maxServingG: componentRow.maxServingG,
      defaultServingG: componentRow.defaultServingG,
      stepG: componentRow.stepG,
      required: componentRow.required,
      variants,
    });
  }
  return {
    kind: "dish.create",
    payload: {
      id: copy.id,
      name: copy.name.slice(0, 120),
      slug,
      description: row.description,
      cuisineId: row.cuisineId,
      secondaryCuisineId: row.secondaryCuisineId,
      slotKeys: row.slotKeys,
      flavourTags: row.flavourTags,
      isPackable: row.isPackable,
      servedColdOk: row.servedColdOk,
      status: "active",
      source: "admin",
      aiGenerationId: null,
      components,
    },
  };
}
