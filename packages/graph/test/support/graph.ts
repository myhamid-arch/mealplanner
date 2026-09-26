// Store and source over one test database, and the snapshot comparison G1 uses.
import { PostgresGraphStore } from "../../src/store/postgres.js";
import type { Queryable } from "../../src/store/sql.js";
import { PostgresKgSource } from "../../src/sync/postgres-source.js";
import type { GraphSnapshot } from "../../src/types/index.js";
import { SUBSTITUTES_CSV } from "./relational.js";

export function graphOn(db: Queryable) {
  const source = new PostgresKgSource(db, { substitutes: SUBSTITUTES_CSV });
  const store = new PostgresGraphStore(db, { exclusions: (hh) => source.exclusions(hh) });
  return { source, store };
}

export interface SnapshotDiff {
  equal: boolean;
  onlyLeft: string[];
  onlyRight: string[];
}

export function compareSnapshots(left: GraphSnapshot, right: GraphSnapshot): SnapshotDiff {
  const l = new Set([...left.nodes.map((n) => `node ${n}`), ...left.edges.map((e) => `edge ${e}`)]);
  const r = new Set([
    ...right.nodes.map((n) => `node ${n}`),
    ...right.edges.map((e) => `edge ${e}`),
  ]);
  const onlyLeft = [...l].filter((x) => !r.has(x));
  const onlyRight = [...r].filter((x) => !l.has(x));
  return {
    equal:
      onlyLeft.length === 0 &&
      onlyRight.length === 0 &&
      left.nodes.length === right.nodes.length &&
      left.edges.length === right.edges.length,
    onlyLeft,
    onlyRight,
  };
}

/** Node and edge counts by type, from a snapshot. */
export function countsByType(s: GraphSnapshot): {
  nodes: Record<string, number>;
  edges: Record<string, number>;
} {
  const nodes: Record<string, number> = {};
  const edges: Record<string, number> = {};
  for (const n of s.nodes) {
    const type = n.split("|")[1] ?? "";
    nodes[type] = (nodes[type] ?? 0) + 1;
  }
  for (const e of s.edges) {
    const type = e.split("|")[1] ?? "";
    edges[type] = (edges[type] ?? 0) + 1;
  }
  return { nodes, edges };
}
