// KG-3: the `kg.sync` requests, the nightly library recompute and the full rebuild. Each runs in one
// transaction and is idempotent (upsert by natural keys; each request replaces the edge set it owns).
import { INGREDIENT_CATEGORIES } from "@mealplanner/core/types";
import { deriveGlobalCatalogue, deriveHouseholdCatalogue } from "../derive/catalogue.js";
import { DISH_EDGE_TYPES, deriveDish, flavourNode, isSyncedDish } from "../derive/dish.js";
import { deriveLibrary } from "../derive/library.js";
import { PREFERENCE_EDGE_TYPES, derivePreferenceDrafts, memberNode } from "../derive/members.js";
import { ref } from "../derive/refs.js";
import {
  LIBRARY_EDGE_TYPES,
  type GraphSnapshot,
  type GraphSyncStore,
  type KgEdgeInput,
  type KgNodeType,
  type NodeRef,
} from "../types/index.js";
import type { KgSource } from "./source.js";

export type KgSyncRequest =
  /** Global catalogue, or one household's private ingredients. */
  | { kind: "catalogue"; householdId?: string }
  /** Recipe writes: dishes created, edited, retired or deleted in this scope (null = global). */
  | { kind: "dish"; householdId: string | null; dishIds: string[] }
  /** Member writes: created, edited, archived or deleted. */
  | { kind: "member"; householdId: string; memberIds: string[] }
  /** Preference writes for these members. */
  | { kind: "preferences"; householdId: string; memberIds: string[] };

/** Nodes created on reference and removed when nothing references them (SPEC-Q-9). */
const ON_DEMAND: readonly KgNodeType[] = ["FlavourTag", "SlotType"];

export async function syncGraph(
  store: GraphSyncStore,
  source: KgSource,
  request: KgSyncRequest,
): Promise<void> {
  await store.transaction((tx) => applyRequest(tx, source, request));
}

async function applyRequest(tx: GraphSyncStore, source: KgSource, request: KgSyncRequest) {
  switch (request.kind) {
    case "catalogue":
      return request.householdId === undefined
        ? syncGlobalCatalogue(tx, source)
        : syncHouseholdCatalogue(tx, source, request.householdId);
    case "dish":
      return syncDishes(tx, source, request.householdId, request.dishIds);
    case "member":
      return syncMembers(tx, source, request.householdId, request.memberIds);
    case "preferences":
      return syncPreferences(tx, source, request.householdId, request.memberIds);
  }
}

async function deleteMissing(
  tx: GraphSyncStore,
  type: KgNodeType,
  householdId: string | null,
  keep: ReadonlySet<string>,
) {
  const stale = (await tx.nodesOfType(type, householdId)).filter((n) => !keep.has(n.key));
  await tx.deleteNodes(stale);
}

async function syncGlobalCatalogue(tx: GraphSyncStore, source: KgSource) {
  const input = await source.catalogue();
  const derived = deriveGlobalCatalogue(input);
  await tx.upsertNodes(derived.nodes);
  const ingredients = await tx.nodesOfType("Ingredient", null);
  await tx.replaceEdges(
    { types: ["IN_CATEGORY", "SUBSTITUTES_FOR"], srcs: ingredients },
    derived.edges,
  );
  const keys = (type: KgNodeType) =>
    new Set(derived.nodes.filter((n) => n.type === type).map((n) => n.key));
  for (const type of ["Ingredient", "Cuisine", "Method"] as const)
    await deleteMissing(tx, type, null, keys(type));
  await deleteMissing(tx, "IngredientCategory", null, new Set(INGREDIENT_CATEGORIES));
}

async function syncHouseholdCatalogue(tx: GraphSyncStore, source: KgSource, householdId: string) {
  const derived = deriveHouseholdCatalogue(
    householdId,
    await source.householdIngredients(householdId),
  );
  await tx.upsertNodes(derived.nodes);
  const ingredients = await tx.nodesOfType("Ingredient", householdId);
  await tx.replaceEdges({ types: ["IN_CATEGORY"], srcs: ingredients }, derived.edges);
  await deleteMissing(tx, "Ingredient", householdId, new Set(derived.nodes.map((n) => n.key)));
}

async function syncDishes(
  tx: GraphSyncStore,
  source: KgSource,
  householdId: string | null,
  dishIds: readonly string[],
) {
  const bundles = new Map(
    (await source.dishes(householdId, dishIds)).map((b) => [b.dish.id, b] as const),
  );
  for (const dishId of new Set(dishIds)) {
    const dishRef = ref("Dish", dishId, householdId);
    const before = await tx.partsOf(dishRef);
    const bundle = bundles.get(dishId);
    if (!isSyncedDish(bundle)) {
      await tx.deleteNodes([...before, dishRef]);
      continue;
    }
    const derived = deriveDish(bundle);
    await tx.upsertNodes(derived.nodes);
    await tx.replaceEdges({ types: DISH_EDGE_TYPES, srcs: derived.owned }, derived.edges);
    const owned = new Set(derived.owned.map((r) => `${r.type}\u0000${r.key}`));
    await tx.deleteNodes(before.filter((n) => !owned.has(`${n.type}\u0000${n.key}`)));
  }
  await tx.deleteOrphans(ON_DEMAND);
}

async function syncMembers(
  tx: GraphSyncStore,
  source: KgSource,
  householdId: string,
  memberIds: readonly string[],
) {
  const found = await source.members(householdId, memberIds);
  await tx.upsertNodes(found.map(memberNode));
  const present = new Set(found.map((m) => m.id));
  await tx.deleteNodes(
    memberIds.filter((id) => !present.has(id)).map((id) => ref("Member", id, householdId)),
  );
  await tx.deleteOrphans(ON_DEMAND);
}

async function syncPreferences(
  tx: GraphSyncStore,
  source: KgSource,
  householdId: string,
  memberIds: readonly string[],
) {
  // Only members already in the graph carry preference edges (member sync creates them).
  const members = (await tx.nodesByKey("Member", memberIds)).filter(
    (n) => n.householdId === householdId,
  );
  const memberRefs: NodeRef[] = members.map((m) => ref("Member", m.key, householdId));
  const drafts = derivePreferenceDrafts(
    members.map((m) => m.key),
    await source.preferences(
      householdId,
      members.map((m) => m.key),
    ),
  );

  const flavours = [
    ...new Set(drafts.filter((d) => d.target.type === "FlavourTag").map((d) => d.target.key)),
  ];
  await tx.upsertNodes(flavours.map(flavourNode));

  // Resolve each target to the node visible to this household (KG-2); skip targets not in the graph.
  const targets = new Map<string, NodeRef>();
  const byType = new Map<KgNodeType, Set<string>>();
  for (const d of drafts)
    byType.set(d.target.type, (byType.get(d.target.type) ?? new Set()).add(d.target.key));
  for (const [type, keys] of byType)
    for (const node of await tx.nodesByKey(type, [...keys]))
      if (node.householdId === null || node.householdId === householdId) {
        const id = `${type}\u0000${node.key}`;
        const seen = targets.get(id);
        if (seen === undefined || seen.householdId === null)
          targets.set(id, ref(type, node.key, node.householdId));
      }

  const edges: KgEdgeInput[] = [];
  for (const d of drafts) {
    const dst = targets.get(`${d.target.type}\u0000${d.target.key}`);
    if (dst === undefined) continue;
    edges.push({
      householdId,
      type: d.type,
      src: ref("Member", d.memberId, householdId),
      dst,
      weight: d.weight,
      props: d.props,
      source: "derived",
    });
  }
  await tx.replaceEdges({ types: PREFERENCE_EDGE_TYPES, srcs: memberRefs }, edges);
  await tx.deleteOrphans(ON_DEMAND);
}

/** `kg.nightly`: PAIRS_WITH and TYPICAL_IN, global and for every household with its own active dishes. */
export async function recomputeLibrary(store: GraphSyncStore, source: KgSource): Promise<void> {
  await store.transaction((tx) => recompute(tx, source));
}

async function recompute(tx: GraphSyncStore, source: KgSource) {
  const edges = deriveLibrary(await source.library(null), null);
  for (const householdId of await source.households()) {
    const library = await source.library(householdId);
    if (library.some((d) => d.householdId === householdId))
      edges.push(...deriveLibrary(library, householdId));
  }
  await tx.replaceEdges({ types: LIBRARY_EDGE_TYPES }, edges);
}

/**
 * `pnpm kg:rebuild`: deletes every node and edge except `ai` edges and the nodes they touch
 * (SPEC-Q-8), then derives the whole graph from the relational tables, in one transaction.
 */
export async function rebuildGraph(
  store: GraphSyncStore,
  source: KgSource,
): Promise<GraphSnapshot> {
  return store.transaction(async (tx) => {
    await tx.clearDerived();
    const households = await source.households();
    await syncGlobalCatalogue(tx, source);
    for (const hh of households) await syncHouseholdCatalogue(tx, source, hh);
    await syncDishes(tx, source, null, await source.dishIds(null));
    for (const hh of households) {
      await syncDishes(tx, source, hh, await source.dishIds(hh));
      const members = (await source.members(hh)).map((m) => m.id);
      await syncMembers(tx, source, hh, members);
      await syncPreferences(tx, source, hh, members);
    }
    await recompute(tx, source);
    return tx.snapshot();
  });
}
