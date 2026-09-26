// PLN-14 cook sheet: per day and meal, one batch per distinct variant with raw quantities from
// `rawForCooked` (frying fat separate), adjuster sides, the plating table, handling notes, allergy
// banners (R2-UX-2) and the NUT-6 banner. Also returns every plate's raw equivalents (SPEC-Q-11),
// so plate_item.raw_equivalent and cook_batch come from one call.
import { rawForCooked, type CatalogContext } from "../../nutrition/index.js";
import type {
  PlanDish,
  PlanMember,
  PlannedMeal,
  PlanResult,
  PlanVariant,
} from "../select/index.js";
import type {
  AllergyBanner,
  CookBatch,
  CookIngredient,
  CookMeal,
  CookSheet,
  PlateRaw,
  PlatingRow,
} from "./types.js";

/** NUT-6: the two kitchen rules macro precision depends on. */
export const NUT6_BANNER = [
  "Weigh every fat and oil in grams (or ml with the gram equivalent); nothing is added as a drizzle or to taste.",
  "Portion every plate by weighing the cooked components on a kitchen scale, to the plate's 5 g grid.",
];

type Located = { dish: PlanDish; componentId: string; componentName: string; variant: PlanVariant };

function locate(plan: PlanResult, dishId: string, variantId: string): Located {
  const dish = plan.dishes[dishId];
  if (dish === undefined) throw new Error(`cook sheet: dish ${dishId} is not in the plan`);
  for (const c of dish.components) {
    const variant = c.variants.find((v) => v.id === variantId);
    if (variant !== undefined) return { dish, componentId: c.id, componentName: c.name, variant };
  }
  throw new Error(`cook sheet: variant ${variantId} is not in dish ${dishId}`);
}

/** Raw grams per ingredient id for `cookedG` of the variant (rows of one ingredient summed). */
function rawMap(
  variant: PlanVariant,
  cookedG: number,
  catalog: CatalogContext,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rawForCooked(variant.input, cookedG, catalog))
    out[r.ingredientId] = (out[r.ingredientId] ?? 0) + r.rawG;
  return out;
}

function slugOf(variant: PlanVariant, id: string): string {
  return variant.ingredients.find((i) => i.id === id)?.slug ?? id;
}

function batchOf(
  kind: CookBatch["kind"],
  loc: Located,
  totalCookedG: number,
  servings: number,
  catalog: CatalogContext,
): CookBatch {
  const rows = rawForCooked(loc.variant.input, totalCookedG, catalog);
  const sum = (discarded: boolean): CookIngredient[] => {
    const grams = new Map<string, number>();
    for (const r of rows)
      if ((r.discardedFat === true) === discarded)
        grams.set(r.ingredientId, (grams.get(r.ingredientId) ?? 0) + r.rawG);
    return [...grams].map(([ingredientId, rawG]) => ({
      ingredientId,
      slug: slugOf(loc.variant, ingredientId),
      rawG,
    }));
  };
  return {
    kind,
    dishId: loc.dish.id,
    componentId: loc.componentId,
    componentName: loc.componentName,
    variantId: loc.variant.id,
    variantLabel: loc.variant.label,
    methodKey: loc.variant.methodKey,
    totalCookedG,
    servings,
    raw: sum(false),
    discardedFat: sum(true),
    steps: [...loc.variant.steps],
  };
}

function allergenLabel(kind: string, key: string): string {
  if (kind === "dietary_flag") return key.replace(/^contains_/, "").replaceAll("_", " ");
  return key.replaceAll(/[-_]/g, " ");
}

function allergyBanners(
  meal: PlannedMeal,
  members: readonly PlanMember[],
  batches: readonly { label: string; variant: PlanVariant }[],
): AllergyBanner[] {
  const out: AllergyBanner[] = [];
  for (const memberId of meal.plates.map((p) => p.memberId)) {
    const member = members.find((m) => m.id === memberId);
    if (member === undefined) continue;
    for (const a of member.allergies) {
      const allergen = allergenLabel(a.kind, a.key);
      const presentIn = batches
        .filter(({ variant }) =>
          variant.ingredients.some((i) =>
            a.kind === "dietary_flag"
              ? i.dietaryFlags.includes(a.key)
              : a.kind === "ingredient"
                ? i.slug === a.key
                : i.category === a.key,
          ),
        )
        .map((b) => b.label);
      out.push({
        memberId,
        memberName: member.displayName,
        allergen,
        text: `${member.displayName}: no ${allergen}. Plate ${member.displayName}'s first, separate spoon.`,
        presentIn,
      });
    }
  }
  return out;
}

function cookMeal(plan: PlanResult, meal: PlannedMeal, catalog: CatalogContext): CookMeal {
  const dish = plan.dishes[meal.dishId];
  if (dish === undefined) throw new Error(`cook sheet: dish ${meal.dishId} is not in the plan`);
  const name = (id: string) => plan.members.find((m) => m.id === id)?.displayName ?? id;

  // Batches: one per distinct component variant, then one per distinct adjuster variant.
  const componentTotals = new Map<string, { loc: Located; g: number; n: number }>();
  const adjusterTotals = new Map<string, { loc: Located; g: number; n: number }>();
  const plates: PlateRaw[] = [];
  const rows: PlatingRow[] = [];
  for (const p of meal.plates) {
    const items: PlateRaw["items"] = [];
    const adjusters: PlateRaw["adjusters"] = [];
    for (const item of p.solution.items) {
      const loc = locate(plan, meal.dishId, item.variantId);
      const t = componentTotals.get(item.variantId) ?? { loc, g: 0, n: 0 };
      t.g += item.cookedG;
      t.n += 1;
      componentTotals.set(item.variantId, t);
      items.push({ ...item, rawEquivalent: rawMap(loc.variant, item.cookedG, catalog) });
    }
    for (const a of p.solution.adjusters) {
      const loc = locate(plan, a.dishId, a.variantId);
      const t = adjusterTotals.get(a.variantId) ?? { loc, g: 0, n: 0 };
      t.g += a.cookedG;
      t.n += 1;
      adjusterTotals.set(a.variantId, t);
      adjusters.push({ ...a, rawEquivalent: rawMap(loc.variant, a.cookedG, catalog) });
    }
    plates.push({ memberId: p.memberId, items, adjusters });
    rows.push({
      memberId: p.memberId,
      memberName: name(p.memberId),
      cells: dish.components.map((c) => {
        const item = p.solution.items.find((i) => i.componentId === c.id);
        const variant =
          item === undefined ? undefined : c.variants.find((v) => v.id === item.variantId);
        const cookedG = item?.cookedG ?? 0;
        return {
          componentId: c.id,
          variantId: variant?.id ?? null,
          variantLabel: variant?.label ?? null,
          cookedG,
          units:
            c.portioning === "unit" && c.unitWeightG !== null && c.unitWeightG > 0
              ? cookedG / c.unitWeightG
              : null,
        };
      }),
      sides: p.solution.adjusters.map((a) => {
        const side = plan.dishes[a.dishId];
        return {
          dishId: a.dishId,
          dishName: side?.name ?? a.dishId,
          variantId: a.variantId,
          cookedG: a.cookedG,
          label: `+ side for ${name(p.memberId)}`,
        };
      }),
    });
  }
  const order = (loc: Located) => {
    const ci = loc.dish.components.findIndex((c) => c.id === loc.componentId);
    const vi = loc.dish.components[ci]?.variants.findIndex((v) => v.id === loc.variant.id) ?? 0;
    return ci * 100 + vi;
  };
  const batches = [
    ...[...componentTotals.values()]
      .sort((a, b) => order(a.loc) - order(b.loc))
      .map((t) => batchOf("component", t.loc, t.g, t.n, catalog)),
    ...[...adjusterTotals.values()]
      .sort((a, b) => (a.loc.dish.id < b.loc.dish.id ? -1 : a.loc.dish.id > b.loc.dish.id ? 1 : 0))
      .map((t) => batchOf("adjuster", t.loc, t.g, t.n, catalog)),
  ];

  const notes: string[] = [];
  if (meal.isPacked)
    notes.push(
      meal.reheatAvailable
        ? "Packed meal: pack in lunch boxes; can be reheated before eating."
        : "Packed meal, no reheating: cool fully, pack chilled and keep cold until eaten.",
    );
  if (meal.kind === "shared" && meal.splitMembers.length > 0)
    notes.push(
      `${meal.splitMembers.map((m) => `+ ${name(m)}: own dish`).join("; ")} (see their individual meal).`,
    );
  if (meal.split) notes.push(`${name(meal.memberScope)} has their own dish at this meal today.`);
  const flagged = meal.plates.filter((p) => p.flag !== null);
  for (const p of flagged)
    notes.push(`${name(p.memberId)}: plate not in tolerance: ${p.flag ?? ""}`);

  const variantsUsed = [
    ...[...componentTotals.values()].map((t) => ({
      label: `${t.loc.componentName} (${t.loc.variant.label})`,
      variant: t.loc.variant,
    })),
    ...[...adjusterTotals.values()].map((t) => ({
      label: `${t.loc.dish.name} (side)`,
      variant: t.loc.variant,
    })),
  ];
  return {
    date: meal.date,
    slotKey: meal.slotKey,
    slotLabel: meal.slotLabel,
    time: meal.time,
    kind: meal.kind,
    memberScope: meal.memberScope,
    dishId: dish.id,
    dishName: dish.name,
    cuisineKey: dish.cuisineKey,
    batches,
    plating: {
      columns: dish.components.map((c) => ({
        componentId: c.id,
        name: c.name,
        unitLabel: c.unitLabel,
      })),
      rows,
    },
    notes,
    allergyBanners: allergyBanners(meal, plan.members, variantsUsed),
    plates,
  };
}

/** PLN-14 (04 §11). Meals appear in time order within each day. */
export function buildCookSheet(plan: PlanResult, catalog: CatalogContext): CookSheet {
  return {
    banner: [...NUT6_BANNER],
    days: plan.days.map((day) => ({
      date: day.date,
      meals: [...day.meals]
        .sort((a, b) =>
          a.time !== b.time
            ? a.time < b.time
              ? -1
              : 1
            : a.memberScope < b.memberScope
              ? -1
              : a.memberScope > b.memberScope
                ? 1
                : 0,
        )
        .map((m) => cookMeal(plan, m, catalog)),
    })),
  };
}
