// Dish, Component and Variant nodes with CONTAINS, PREPARED_BY, PART_OF, OF_CUISINE, HAS_FLAVOUR and
// SUITS_SLOT (08 §1, §2; leaf-1.3.4 ADR-2).
import { DEFAULT_SLOTS } from "@mealplanner/core/types";
import type { KgEdgeInput, KgEdgeType, KgNodeInput, NodeRef } from "../types/index.js";
import type { Derived } from "./catalogue.js";
import type { DishBundle } from "./inputs.js";
import { PRIMARY_CUISINE_WEIGHT, SECONDARY_CUISINE_WEIGHT, ref, round3 } from "./refs.js";

/** Edge types a dish sync owns (replaced as one set for the dish's nodes). */
export const DISH_EDGE_TYPES: readonly KgEdgeType[] = [
  "CONTAINS",
  "PREPARED_BY",
  "PART_OF",
  "OF_CUISINE",
  "HAS_FLAVOUR",
  "SUITS_SLOT",
];

const SLOT_LABELS = new Map(DEFAULT_SLOTS.map((s) => [s.key, s.label]));

export function flavourNode(tag: string): KgNodeInput {
  return { ...ref("FlavourTag", tag), label: tag, props: {} };
}

export function slotNode(key: string): KgNodeInput {
  return { ...ref("SlotType", key), label: SLOT_LABELS.get(key) ?? key, props: {} };
}

export interface DerivedDish extends Derived {
  /** The dish, its components and its variants: the nodes whose owned edges this sync replaces. */
  owned: NodeRef[];
}

/** Draft dishes are not in the library and are not synced (SPEC-Q-10). */
export function isSyncedDish(bundle: DishBundle | undefined): bundle is DishBundle {
  return bundle !== undefined && bundle.dish.status !== "draft";
}

export function deriveDish(bundle: DishBundle): DerivedDish {
  const { dish } = bundle;
  const hh = dish.householdId;
  const dishRef = ref("Dish", dish.id, hh);
  const nodes: KgNodeInput[] = [
    {
      ...dishRef,
      label: dish.name,
      props: { slug: dish.slug, status: dish.status, source: dish.source },
    },
  ];
  const edges: KgEdgeInput[] = [];
  const edge = (
    type: KgEdgeType,
    src: NodeRef,
    dst: NodeRef,
    weight: number,
    props: KgEdgeInput["props"] = {},
    source: KgEdgeInput["source"] = "derived",
  ) => edges.push({ householdId: hh, type, src, dst, weight, props, source });
  const owned: NodeRef[] = [dishRef];

  edge("OF_CUISINE", dishRef, ref("Cuisine", bundle.cuisineKey), PRIMARY_CUISINE_WEIGHT);
  if (bundle.secondaryCuisineKey !== null && bundle.secondaryCuisineKey !== bundle.cuisineKey)
    edge(
      "OF_CUISINE",
      dishRef,
      ref("Cuisine", bundle.secondaryCuisineKey),
      SECONDARY_CUISINE_WEIGHT,
    );

  const flavourSource = dish.source === "seed" ? "seed" : "derived";
  for (const tag of new Set(dish.flavourTags)) {
    nodes.push(flavourNode(tag));
    edge("HAS_FLAVOUR", dishRef, ref("FlavourTag", tag), 1, {}, flavourSource);
  }
  for (const slot of new Set(dish.slotKeys)) {
    nodes.push(slotNode(slot));
    edge("SUITS_SLOT", dishRef, ref("SlotType", slot), 1);
  }

  const components = new Set(bundle.components.map((c) => c.id));
  for (const c of bundle.components) {
    const cRef = ref("Component", c.id, hh);
    owned.push(cRef);
    nodes.push({ ...cRef, label: c.name, props: { role: c.role, required: c.required } });
    edge("PART_OF", cRef, dishRef, 1);
  }
  for (const v of bundle.variants) {
    if (!components.has(v.componentId))
      throw new Error(`variant ${v.id} belongs to no component of dish ${dish.id}`);
    const vRef = ref("Variant", v.id, hh);
    owned.push(vRef);
    nodes.push({ ...vRef, label: v.label, props: { isDefault: v.isDefault } });
    edge("PART_OF", vRef, ref("Component", v.componentId, hh), 1);
    edge("PREPARED_BY", vRef, ref("Method", v.methodKey), 1);

    // CONTAINS weight: share of the variant's raw batch weight (an ingredient listed twice is summed).
    const items = bundle.ingredients.filter((i) => i.variantId === v.id);
    const total = items.reduce((sum, i) => sum + i.rawGPerBatch, 0);
    const byIngredient = new Map<string, { rawG: number; householdId: string | null }>();
    for (const i of items) {
      const seen = byIngredient.get(i.ingredientId);
      byIngredient.set(i.ingredientId, {
        rawG: (seen?.rawG ?? 0) + i.rawGPerBatch,
        householdId: i.ingredientHouseholdId,
      });
    }
    for (const [ingredientId, { rawG, householdId }] of byIngredient)
      edge("CONTAINS", vRef, ref("Ingredient", ingredientId, householdId), round3(rawG / total), {
        rawG: round3(rawG),
      });
  }
  return { nodes, edges, owned };
}
