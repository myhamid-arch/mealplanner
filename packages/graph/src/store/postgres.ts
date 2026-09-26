// PostgresGraphStore: 08 §5 GraphStore on `kg_node` / `kg_edge` (KG-1), with the KG-2 household
// filter on every read (leaf-1.3.4 ADR-1, ADR-2).
import type { Json } from "@mealplanner/core/types";
import {
  dishFeatures,
  rankSimilar,
  type DishFeatureInput,
  type VariantFeature,
} from "../similarity/similarity.js";
import {
  LIBRARY_EDGE_TYPES,
  type EdgeScope,
  type GraphSnapshot,
  type GraphSyncStore,
  type KgEdgeInput,
  type KgNeighbour,
  type KgNode,
  type KgNodeInput,
  type KgNodeType,
  type NeighbourOptions,
  type NodeRef,
  type SimilarDish,
  type Substitute,
} from "../types/index.js";
import type { ExclusionReader } from "./exclusions.js";
import { rankSubstitutes } from "./substitutes.js";
import {
  canonicalJson,
  isConnectable,
  rows,
  toNode,
  toNumber,
  toSource,
  visible,
  type NodeRecord,
  type Queryable,
} from "./sql.js";
import { isUuid, newId } from "./uuid.js";

export interface PostgresGraphStoreOptions {
  /** The household's exclusions, applied by `substitutes` (KG-4.3). */
  exclusions: ExclusionReader;
}

const refKey = (r: NodeRef) => `${r.householdId ?? ""}\u0000${r.type}\u0000${r.key}`;
const edgeKey = (e: KgEdgeInput) =>
  `${e.householdId ?? ""}\u0001${refKey(e.src)}\u0001${refKey(e.dst)}\u0001${e.type}`;

function lastWins<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

interface NeighbourRecord extends NodeRecord {
  weight: string;
  edge_household_id: string | null;
  edge_props: Json;
  source: string;
}

interface FeatureRecord {
  dish_key: string;
  depth: number;
  part_key: string;
  parent_key: string | null;
  edge_type: string;
  edge_props: Json;
  weight: string;
  node_key: string;
  node_label: string;
  node_props: Json;
}

const asObject = (value: Json): Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};

export class PostgresGraphStore implements GraphSyncStore {
  readonly #db: Queryable;
  readonly #options: PostgresGraphStoreOptions;

  constructor(db: Queryable, options: PostgresGraphStoreOptions) {
    this.#db = db;
    this.#options = options;
  }

  // -------------------------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------------------------

  async transaction<T>(work: (store: GraphSyncStore) => Promise<T>): Promise<T> {
    const db = this.#db;
    const client = isConnectable(db) ? await db.connect() : null;
    const conn: Queryable = client ?? db;
    try {
      await conn.query("BEGIN");
      const result = await work(new TransactionalGraphStore(conn, this.#options));
      await conn.query("COMMIT");
      return result;
    } catch (error) {
      await conn.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client?.release();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------------------------

  async upsertNodes(nodes: KgNodeInput[]): Promise<void> {
    const list = lastWins(nodes, refKey);
    if (list.length === 0) return;
    await this.#db.query(
      `INSERT INTO kg_node (id, household_id, type, key, label, props)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::jsonb[])
       ON CONFLICT ON CONSTRAINT kg_node_household_type_key_key
       DO UPDATE SET label = EXCLUDED.label, props = EXCLUDED.props`,
      [
        list.map(() => newId()),
        list.map((n) => n.householdId),
        list.map((n) => n.type),
        list.map((n) => n.key),
        list.map((n) => n.label),
        list.map((n) => JSON.stringify(n.props)),
      ],
    );
  }

  async upsertEdges(edges: KgEdgeInput[]): Promise<void> {
    await this.#writeEdges(edges);
  }

  /** Upserts edges by (household, src, dst, type); returns their ids. Throws on a missing endpoint. */
  async #writeEdges(edges: readonly KgEdgeInput[]): Promise<string[]> {
    const list = lastWins(edges, edgeKey);
    if (list.length === 0) return [];
    for (const e of list)
      if (!Number.isFinite(e.weight) || e.weight < 0)
        throw new Error(
          `edge ${e.type} ${e.src.key} → ${e.dst.key}: invalid weight ${String(e.weight)}`,
        );
    const result = await rows<{ id: string }>(
      this.#db,
      `WITH input AS (
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::text[],
                              $7::uuid[], $8::text[], $9::text[], $10::numeric[], $11::jsonb[],
                              $12::kg_edge_source[])
           AS t(id, household_id, type, src_hh, src_type, src_key, dst_hh, dst_type, dst_key,
                weight, props, source)
       )
       INSERT INTO kg_edge (id, household_id, src_id, dst_id, type, weight, props, source, updated_at)
       SELECT i.id, i.household_id, s.id, d.id, i.type, i.weight, i.props, i.source, now()
       FROM input i
       JOIN kg_node s ON s.household_id IS NOT DISTINCT FROM i.src_hh AND s.type = i.src_type AND s.key = i.src_key
       JOIN kg_node d ON d.household_id IS NOT DISTINCT FROM i.dst_hh AND d.type = i.dst_type AND d.key = i.dst_key
       ON CONFLICT ON CONSTRAINT kg_edge_household_src_dst_type_key
       DO UPDATE SET weight = EXCLUDED.weight, props = EXCLUDED.props, source = EXCLUDED.source,
         updated_at = CASE
           WHEN (kg_edge.weight, kg_edge.props, kg_edge.source)
                IS DISTINCT FROM (EXCLUDED.weight, EXCLUDED.props, EXCLUDED.source)
           THEN EXCLUDED.updated_at ELSE kg_edge.updated_at END
       RETURNING id`,
      [
        list.map(() => newId()),
        list.map((e) => e.householdId),
        list.map((e) => e.type),
        list.map((e) => e.src.householdId),
        list.map((e) => e.src.type),
        list.map((e) => e.src.key),
        list.map((e) => e.dst.householdId),
        list.map((e) => e.dst.type),
        list.map((e) => e.dst.key),
        list.map((e) => e.weight),
        list.map((e) => JSON.stringify(e.props)),
        list.map((e) => e.source),
      ],
    );
    if (result.length !== list.length) {
      const missing = await this.#missingRefs(list.flatMap((e) => [e.src, e.dst]));
      throw new Error(
        `${String(list.length - result.length)} edge(s) name a node that does not exist: ${missing
          .slice(0, 5)
          .map((r) => `${r.type}:${r.key}@${r.householdId ?? "global"}`)
          .join(", ")}`,
      );
    }
    return result.map((r) => r.id);
  }

  async #missingRefs(refs: readonly NodeRef[]): Promise<NodeRef[]> {
    const list = lastWins(refs, refKey);
    const found = new Set((await this.#resolve(list)).map((n) => refKey(n)));
    return list.filter((r) => !found.has(refKey(r)));
  }

  /** The stored nodes for these natural keys (missing ones are skipped). */
  async #resolve(refs: readonly NodeRef[]): Promise<KgNode[]> {
    if (refs.length === 0) return [];
    return (
      await rows<NodeRecord>(
        this.#db,
        `SELECT n.id, n.household_id, n.type, n.key, n.label, n.props
         FROM unnest($1::uuid[], $2::text[], $3::text[]) AS r(household_id, type, key)
         JOIN kg_node n ON n.household_id IS NOT DISTINCT FROM r.household_id
                       AND n.type = r.type AND n.key = r.key`,
        [refs.map((r) => r.householdId), refs.map((r) => r.type), refs.map((r) => r.key)],
      )
    ).map(toNode);
  }

  async replaceEdges(scope: EdgeScope, edges: KgEdgeInput[]): Promise<void> {
    for (const e of edges)
      if (!scope.types.includes(e.type))
        throw new Error(`edge type ${e.type} is outside the replaced scope`);
    const kept = await this.#writeEdges(edges);
    if (scope.srcs === undefined) {
      await this.#db.query(
        `DELETE FROM kg_edge
         WHERE type = ANY($1::text[]) AND source <> 'ai' AND NOT (id = ANY($2::uuid[]))`,
        [scope.types, kept],
      );
      return;
    }
    const srcIds = (await this.#resolve(scope.srcs)).map((n) => n.id);
    await this.#db.query(
      `DELETE FROM kg_edge
       WHERE type = ANY($1::text[]) AND source <> 'ai' AND src_id = ANY($3::uuid[])
         AND NOT (id = ANY($2::uuid[]))`,
      [scope.types, kept, srcIds],
    );
  }

  async deleteNodes(refs: readonly NodeRef[]): Promise<void> {
    const ids = (await this.#resolve(refs)).map((n) => n.id);
    if (ids.length === 0) return;
    await this.#db.query(
      `DELETE FROM kg_edge WHERE src_id = ANY($1::uuid[]) OR dst_id = ANY($1::uuid[])`,
      [ids],
    );
    await this.#db.query(`DELETE FROM kg_node WHERE id = ANY($1::uuid[])`, [ids]);
  }

  async deleteOrphans(types: readonly KgNodeType[]): Promise<number> {
    const result = await this.#db.query(
      `DELETE FROM kg_node n
       WHERE n.type = ANY($1::text[])
         AND NOT EXISTS (SELECT 1 FROM kg_edge e WHERE e.src_id = n.id OR e.dst_id = n.id)`,
      [types],
    );
    return result.rowCount ?? 0;
  }

  async clearDerived(): Promise<void> {
    await this.#db.query(`DELETE FROM kg_edge WHERE source <> 'ai'`);
    await this.#db.query(
      `DELETE FROM kg_node n
       WHERE NOT EXISTS (SELECT 1 FROM kg_edge e WHERE e.src_id = n.id OR e.dst_id = n.id)`,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Sync lookups (unfiltered: sync maintains every household's graph)
  // -------------------------------------------------------------------------------------------

  async nodesByKey(type: KgNodeType, keys: readonly string[]): Promise<KgNode[]> {
    if (keys.length === 0) return [];
    return (
      await rows<NodeRecord>(
        this.#db,
        `SELECT id, household_id, type, key, label, props FROM kg_node
         WHERE type = $1 AND key = ANY($2::text[]) ORDER BY key, id`,
        [type, keys],
      )
    ).map(toNode);
  }

  async nodesOfType(type: KgNodeType, householdId: string | null): Promise<KgNode[]> {
    return (
      await rows<NodeRecord>(
        this.#db,
        `SELECT id, household_id, type, key, label, props FROM kg_node
         WHERE type = $1 AND household_id IS NOT DISTINCT FROM $2::uuid ORDER BY key`,
        [type, householdId],
      )
    ).map(toNode);
  }

  async partsOf(ref: NodeRef): Promise<KgNode[]> {
    return (
      await rows<NodeRecord>(
        this.#db,
        `WITH RECURSIVE parts(id, depth) AS (
           SELECT id, 0 FROM kg_node
           WHERE household_id IS NOT DISTINCT FROM $1::uuid AND type = $2 AND key = $3
           UNION ALL
           SELECT e.src_id, p.depth + 1
           FROM parts p JOIN kg_edge e ON e.dst_id = p.id AND e.type = 'PART_OF'
           WHERE p.depth < 2
         )
         SELECT n.id, n.household_id, n.type, n.key, n.label, n.props
         FROM parts p JOIN kg_node n ON n.id = p.id WHERE p.depth > 0 ORDER BY n.type, n.key`,
        [ref.householdId, ref.type, ref.key],
      )
    ).map(toNode);
  }

  async snapshot(): Promise<GraphSnapshot> {
    const nodes = await rows<NodeRecord>(
      this.#db,
      `SELECT id, household_id, type, key, label, props FROM kg_node`,
    );
    const edges = await rows<{
      household_id: string | null;
      type: string;
      weight: string;
      props: Json;
      source: string;
      sh: string | null;
      st: string;
      sk: string;
      dh: string | null;
      dt: string;
      dk: string;
    }>(
      this.#db,
      `SELECT e.household_id, e.type, e.weight, e.props, e.source,
              s.household_id AS sh, s.type AS st, s.key AS sk,
              d.household_id AS dh, d.type AS dt, d.key AS dk
       FROM kg_edge e JOIN kg_node s ON s.id = e.src_id JOIN kg_node d ON d.id = e.dst_id`,
    );
    const hh = (h: string | null) => h ?? "global";
    return {
      nodes: nodes
        .map((n) => `${hh(n.household_id)}|${n.type}|${n.key}|${n.label}|${canonicalJson(n.props)}`)
        .sort(),
      edges: edges
        .map(
          (e) =>
            `${hh(e.household_id)}|${e.type}|${hh(e.sh)}:${e.st}:${e.sk}|${hh(e.dh)}:${e.dt}:${e.dk}|${String(toNumber(e.weight))}|${canonicalJson(e.props)}|${e.source}`,
        )
        .sort(),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Reads (KG-2: household_id IS NULL OR household_id = :hh on every node and edge touched)
  // -------------------------------------------------------------------------------------------

  /** The node of this type and key visible to the household (global only when omitted). */
  async findNode(type: KgNodeType, key: string, householdId?: string): Promise<KgNode | null> {
    const hh = householdId !== undefined && isUuid(householdId) ? householdId : null;
    const [row] = await rows<NodeRecord>(
      this.#db,
      `SELECT n.id, n.household_id, n.type, n.key, n.label, n.props FROM kg_node n
       WHERE n.type = $1 AND n.key = $2 AND ${visible("n", "$3")}
       ORDER BY n.household_id NULLS LAST LIMIT 1`,
      [type, key, hh],
    );
    return row === undefined ? null : toNode(row);
  }

  async neighbours(
    nodeId: string,
    edgeType: string,
    opts: NeighbourOptions = {},
  ): Promise<KgNeighbour[]> {
    return this.#adjacent("out", nodeId, edgeType, opts);
  }

  /** Like `neighbours`, following edges backwards (the nodes whose `edgeType` edge reaches `nodeId`). */
  async incoming(
    nodeId: string,
    edgeType: string,
    opts: NeighbourOptions = {},
  ): Promise<KgNeighbour[]> {
    return this.#adjacent("in", nodeId, edgeType, opts);
  }

  async #adjacent(
    direction: "out" | "in",
    nodeId: string,
    edgeType: string,
    opts: NeighbourOptions,
  ): Promise<KgNeighbour[]> {
    if (!isUuid(nodeId)) return [];
    if (opts.householdId !== undefined && !isUuid(opts.householdId)) return [];
    const [near, far] = direction === "out" ? ["src_id", "dst_id"] : ["dst_id", "src_id"];
    const found = await rows<NeighbourRecord>(
      this.#db,
      `SELECT * FROM (
         SELECT DISTINCT ON (n.id) n.id, n.household_id, n.type, n.key, n.label, n.props,
                e.weight, e.household_id AS edge_household_id, e.props AS edge_props, e.source
         FROM kg_node s
         JOIN kg_edge e ON e.${near} = s.id AND e.type = $2
         JOIN kg_node n ON n.id = e.${far}
         WHERE s.id = $1::uuid AND ${visible("s", "$3")} AND ${visible("e", "$3")} AND ${visible("n", "$3")}
           AND e.weight >= $4
           AND (NOT ($2 = ANY($5::text[])) OR e.household_id IS NOT NULL
                OR NOT EXISTS (SELECT 1 FROM kg_edge x WHERE x.type = $2 AND x.household_id = $3::uuid))
         ORDER BY n.id, e.household_id NULLS LAST
       ) t
       ORDER BY t.weight DESC, t.key, t.id
       LIMIT $6`,
      [
        nodeId,
        edgeType,
        opts.householdId ?? null,
        opts.minWeight ?? 0,
        LIBRARY_EDGE_TYPES,
        opts.limit ?? null,
      ],
    );
    return found.map((r) => ({
      ...toNode(r),
      nodeId: r.id,
      weight: toNumber(r.weight),
      edgeHouseholdId: r.edge_household_id,
      edgeProps: r.edge_props,
      source: toSource(r.source),
    }));
  }

  async similarDishes(dishId: string, householdId: string, limit: number): Promise<SimilarDish[]> {
    if (!isUuid(householdId)) return [];
    const target = await this.findNode("Dish", dishId, householdId);
    if (target === null) return [];
    const features = await this.#dishFeatures(householdId);
    const own = features.get(dishId);
    if (own === undefined) return [];
    return rankSimilar(own, [...features.values()], limit);
  }

  /** The KG-4.1 features of every dish visible to the household, walked by a recursive CTE. */
  async #dishFeatures(householdId: string) {
    const found = await rows<FeatureRecord>(
      this.#db,
      `WITH RECURSIVE parts(dish_key, node_id, parent_key, depth) AS (
         SELECT d.key, d.id, NULL::text, 0 FROM kg_node d
         WHERE d.type = 'Dish' AND ${visible("d", "$1")}
         UNION ALL
         SELECT p.dish_key, e.src_id, pn.key, p.depth + 1
         FROM parts p
         JOIN kg_node pn ON pn.id = p.node_id
         JOIN kg_edge e ON e.dst_id = p.node_id AND e.type = 'PART_OF' AND ${visible("e", "$1")}
         WHERE p.depth < 2
       )
       SELECT p.dish_key, p.depth, pn.key AS part_key, p.parent_key, e.type AS edge_type,
              e.props AS edge_props, e.weight, n.key AS node_key, n.label AS node_label,
              n.props AS node_props
       FROM parts p
       JOIN kg_node pn ON pn.id = p.node_id AND ${visible("pn", "$1")}
       JOIN kg_edge e ON e.src_id = p.node_id AND ${visible("e", "$1")}
         AND e.type IN ('CONTAINS', 'PREPARED_BY', 'OF_CUISINE', 'HAS_FLAVOUR')
       JOIN kg_node n ON n.id = e.dst_id AND ${visible("n", "$1")}
       ORDER BY p.dish_key, pn.key, n.key`,
      [householdId],
    );
    const inputs = new Map<string, DishFeatureInput & { byVariant: Map<string, VariantFeature> }>();
    for (const r of found) {
      let dish = inputs.get(r.dish_key);
      if (dish === undefined) {
        dish = {
          dishId: r.dish_key,
          variants: [],
          cuisines: [],
          flavourTags: [],
          byVariant: new Map(),
        };
        inputs.set(r.dish_key, dish);
      }
      if (r.depth === 0 && r.edge_type === "OF_CUISINE")
        dish.cuisines.push({ key: r.node_key, label: r.node_label, weight: toNumber(r.weight) });
      else if (r.depth === 0 && r.edge_type === "HAS_FLAVOUR") dish.flavourTags.push(r.node_key);
      else if (r.depth === 2 && r.parent_key !== null) {
        let variant = dish.byVariant.get(r.part_key);
        if (variant === undefined) {
          variant = {
            variantId: r.part_key,
            componentId: r.parent_key,
            method: { key: "", label: "" },
            items: [],
          };
          dish.byVariant.set(r.part_key, variant);
          dish.variants.push(variant);
        }
        if (r.edge_type === "PREPARED_BY")
          variant.method = { key: r.node_key, label: r.node_label };
        else if (r.edge_type === "CONTAINS") {
          const props = asObject(r.node_props);
          variant.items.push({
            ingredientId: r.node_key,
            label: r.node_label,
            slug: typeof props.slug === "string" ? props.slug : "",
            category: (typeof props.category === "string"
              ? props.category
              : "other") as VariantFeature["items"][number]["category"],
            rawG: toNumber(asObject(r.edge_props).rawG ?? r.weight),
          });
        }
      }
    }
    return new Map([...inputs].map(([key, input]) => [key, dishFeatures(input)]));
  }

  async substitutes(
    ingredientId: string,
    householdId: string,
    limit: number,
  ): Promise<Substitute[]> {
    if (!isUuid(householdId)) return [];
    const node = await this.findNode("Ingredient", ingredientId, householdId);
    if (node === null) return [];
    const [candidates, exclusions] = await Promise.all([
      this.neighbours(node.id, "SUBSTITUTES_FOR", { householdId }),
      this.#options.exclusions(householdId),
    ]);
    return rankSubstitutes(candidates, exclusions, householdId, limit);
  }
}

/** The store bound to one transaction's client: nested `transaction` calls reuse it. */
class TransactionalGraphStore extends PostgresGraphStore {
  override async transaction<T>(work: (store: GraphSyncStore) => Promise<T>): Promise<T> {
    return work(this);
  }
}
