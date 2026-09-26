// A dish's stored rows as the `dish.create` / `dish.update` component tree (AGT-6), for changes
// that start from an existing recipe: a household copy (REC-7 copy-on-write; R2-UX-1
// substitution) or a revision of some variants (W-2). Ingredient lines are in id order, the same
// order `toPlanDishes` uses for the engine input.
import { asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../../repos/index.js";
import { component, dish, variant, variantIngredient } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";
import { PlanServiceError } from "./errors.js";

export interface TreeLine {
  ingredientId: string;
  rawGPerBatch: number;
  roleNote: string | null;
  isAbsorbedOil: boolean;
  cookingLiquid: "absorbed" | "retained" | null;
  yieldOverride: number | null;
}

export interface TreeVariant {
  id: string;
  methodId: string;
  label: string;
  isDefault: boolean;
  steps: string[];
  cookTimeMin: number | null;
  notes: string | null;
  referenceBatchCookedG: number;
  ingredients: TreeLine[];
}

export interface TreeComponent {
  id: string;
  name: string;
  role: (typeof component.$inferSelect)["role"];
  portioning: (typeof component.$inferSelect)["portioning"];
  unitLabel: string | null;
  minServingG: number;
  maxServingG: number;
  defaultServingG: number;
  stepG: number;
  required: boolean;
  variants: TreeVariant[];
}

export interface DishTree {
  dish: typeof dish.$inferSelect;
  components: TreeComponent[];
}

/** The dish and its component tree (the caller has checked the dish is visible to it). */
export async function dishTree(db: Executor, dishId: string): Promise<DishTree> {
  const [row] = await db.select().from(dish).where(eq(dish.id, dishId));
  if (row === undefined) throw new PlanServiceError("not_found", `dish ${dishId} not found`);
  const comps = await db
    .select()
    .from(component)
    .where(eq(component.dishId, dishId))
    .orderBy(asc(component.sortOrder));
  const vars =
    comps.length === 0
      ? []
      : await db
          .select()
          .from(variant)
          .where(
            inArray(
              variant.componentId,
              comps.map((c) => c.id),
            ),
          );
  const lines =
    vars.length === 0
      ? []
      : await db
          .select()
          .from(variantIngredient)
          .where(
            inArray(
              variantIngredient.variantId,
              vars.map((v) => v.id),
            ),
          )
          .orderBy(asc(variantIngredient.id));
  return {
    dish: row,
    components: comps.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      portioning: c.portioning,
      unitLabel: c.unitLabel,
      minServingG: c.minServingG,
      maxServingG: c.maxServingG,
      defaultServingG: c.defaultServingG,
      stepG: c.stepG,
      required: c.required,
      variants: vars
        .filter((v) => v.componentId === c.id)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id.localeCompare(b.id))
        .map((v) => ({
          id: v.id,
          methodId: v.methodId,
          label: v.label,
          isDefault: v.isDefault,
          steps: v.steps,
          cookTimeMin: v.cookTimeMin,
          notes: v.notes,
          referenceBatchCookedG: v.referenceBatchCookedG,
          ingredients: lines
            .filter((l) => l.variantId === v.id)
            .map((l) => ({
              ingredientId: l.ingredientId,
              rawGPerBatch: l.rawGPerBatch,
              roleNote: l.roleNote,
              isAbsorbedOil: l.isAbsorbedOil,
              cookingLiquid: l.cookingLiquid,
              yieldOverride: l.yieldOverride,
            })),
        })),
    })),
  };
}

/** The same tree with fresh component and variant ids (a copy); `ids` maps old → new. */
export function withNewIds(components: readonly TreeComponent[]): {
  components: TreeComponent[];
  ids: Map<string, string>;
} {
  const ids = new Map<string, string>();
  const fresh = components.map((c) => {
    const cid = newId();
    ids.set(c.id, cid);
    return {
      ...c,
      id: cid,
      variants: c.variants.map((v) => {
        const vid = newId();
        ids.set(v.id, vid);
        return { ...v, id: vid };
      }),
    };
  });
  return { components: fresh, ids };
}

/** A free household slug based on `base` (`base`, `base-2`, …). */
export async function freeSlug(db: Executor, householdId: string, base: string): Promise<string> {
  const taken = new Set(
    (await db.select({ slug: dish.slug }).from(dish).where(eq(dish.householdId, householdId))).map(
      (d) => d.slug,
    ),
  );
  const stem = base.slice(0, 110);
  let slug = stem;
  for (let i = 2; taken.has(slug); i++) slug = `${stem.slice(0, 105)}-${String(i)}`;
  return slug;
}

/** `dish.create` payload for a household copy of `tree` with `components` (ids included). */
export function copyPayload(
  tree: DishTree,
  args: { id: string; name: string; slug: string; components: TreeComponent[] },
) {
  const d = tree.dish;
  return {
    id: args.id,
    name: args.name.slice(0, 120),
    slug: args.slug,
    description: d.description,
    cuisineId: d.cuisineId,
    secondaryCuisineId: d.secondaryCuisineId,
    slotKeys: d.slotKeys,
    flavourTags: d.flavourTags,
    isPackable: d.isPackable,
    servedColdOk: d.servedColdOk,
    status: "active" as const,
    source: "admin" as const,
    aiGenerationId: null,
    components: args.components,
  };
}
