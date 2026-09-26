// Knowledge-graph types and the GraphStore interface (08 §1, §2, §5; leaf-1.3.4 ADR-2).
import type { Nutrients } from "@mealplanner/core/nutrition";
import type { Json, KgEdgeSource } from "@mealplanner/core/types";

/** 08 §1 node types. */
export const KG_NODE_TYPES = [
  "Ingredient",
  "IngredientCategory",
  "Cuisine",
  "Method",
  "FlavourTag",
  "SlotType",
  "Dish",
  "Component",
  "Variant",
  "Member",
] as const;
export type KgNodeType = (typeof KG_NODE_TYPES)[number];

/** 08 §2 edge types. */
export const KG_EDGE_TYPES = [
  "CONTAINS",
  "PREPARED_BY",
  "PART_OF",
  "OF_CUISINE",
  "IN_CATEGORY",
  "TYPICAL_IN",
  "PAIRS_WITH",
  "SUBSTITUTES_FOR",
  "HAS_FLAVOUR",
  "SUITS_SLOT",
  "LIKES",
  "DISLIKES",
] as const;
export type KgEdgeType = (typeof KG_EDGE_TYPES)[number];

/**
 * Edge types recomputed as a whole library (nightly, SPEC-Q-5/6). A household that has its own
 * edges of one of these types reads only those; otherwise it reads the global ones.
 */
export const LIBRARY_EDGE_TYPES: readonly KgEdgeType[] = ["PAIRS_WITH", "TYPICAL_IN"];

/** A node by its natural key: unique (household_id, type, key) in `kg_node`. */
export interface NodeRef {
  householdId: string | null;
  type: KgNodeType;
  key: string;
}

export interface KgNodeInput extends NodeRef {
  label: string;
  props: Json;
}

export interface KgEdgeInput {
  /** null = global; set for every edge derived from household-scoped rows (KG-2). */
  householdId: string | null;
  type: KgEdgeType;
  src: NodeRef;
  dst: NodeRef;
  weight: number;
  props: Json;
  source: KgEdgeSource;
}

/** One outgoing edge and the node it reaches. */
export interface KgNeighbour {
  nodeId: string;
  householdId: string | null;
  type: KgNodeType;
  key: string;
  label: string;
  props: Json;
  weight: number;
  edgeHouseholdId: string | null;
  edgeProps: Json;
  source: KgEdgeSource;
}

export interface SimilarDish {
  dishId: string;
  sim: number;
  why: string[];
}

export interface Substitute {
  ingredientId: string;
  weight: number;
  /** Substitute − original, per 100 g raw; a field is null when either side is unknown. */
  macroDelta: Nutrients;
}

export interface NeighbourOptions {
  minWeight?: number;
  limit?: number;
  householdId?: string;
}

/** 08 §5. */
export interface GraphStore {
  upsertNodes(nodes: KgNodeInput[]): Promise<void>;
  upsertEdges(edges: KgEdgeInput[]): Promise<void>;
  neighbours(nodeId: string, edgeType: string, opts?: NeighbourOptions): Promise<KgNeighbour[]>;
  similarDishes(dishId: string, householdId: string, limit: number): Promise<SimilarDish[]>;
  substitutes(ingredientId: string, householdId: string, limit: number): Promise<Substitute[]>;
}

/** A node as stored. */
export interface KgNode extends KgNodeInput {
  id: string;
}

/** The canonical content of a graph, without ids or timestamps (G1). */
export interface GraphSnapshot {
  nodes: string[];
  edges: string[];
}

/** The set of edges one sync request owns and replaces. */
export interface EdgeScope {
  types: readonly KgEdgeType[];
  /** Limit to edges leaving these nodes; omitted = every edge of the types. */
  srcs?: readonly NodeRef[];
}

/** The store operations sync and rebuild need, beyond 08 §5. */
export interface GraphSyncStore extends GraphStore {
  /** Runs `work` in one transaction (reuses the current one when already inside). */
  transaction<T>(work: (store: GraphSyncStore) => Promise<T>): Promise<T>;
  /**
   * Upserts `edges`, then deletes every other non-`ai` edge in `scope`, so the scope holds exactly
   * `edges` plus any `ai` edges (SPEC-Q-8).
   */
  replaceEdges(scope: EdgeScope, edges: KgEdgeInput[]): Promise<void>;
  /** Deletes the nodes and every edge that touches them. */
  deleteNodes(refs: readonly NodeRef[]): Promise<void>;
  /** Every stored node of these types with one of these keys, in any household. */
  nodesByKey(type: KgNodeType, keys: readonly string[]): Promise<KgNode[]>;
  /** Every stored node of a type in exactly this household (null = global). */
  nodesOfType(type: KgNodeType, householdId: string | null): Promise<KgNode[]>;
  /** Nodes reached from `ref` by following PART_OF edges backwards (components, then variants). */
  partsOf(ref: NodeRef): Promise<KgNode[]>;
  /** Deletes nodes of these types that no edge touches; returns how many. */
  deleteOrphans(types: readonly KgNodeType[]): Promise<number>;
  /** Deletes every edge except `ai` ones, and every node no `ai` edge touches (rebuild). */
  clearDerived(): Promise<void>;
  snapshot(): Promise<GraphSnapshot>;
}
