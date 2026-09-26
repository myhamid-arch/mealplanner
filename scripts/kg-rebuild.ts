// `pnpm kg:rebuild` (08 KG-3): rebuilds the knowledge graph from the relational tables, in one
// transaction. Keeps `source = ai` edges (leaf-1.3.4 SPEC-Q-8).
//   DATABASE_URL=postgres://… node scripts/kg-rebuild.ts [--substitutes data/substitutes.csv]
// Needs the built graph package (`pnpm build`).
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PostgresGraphStore, type Connectable } from "../packages/graph/dist/src/store/index.js";
import { PostgresKgSource, rebuildGraph } from "../packages/graph/dist/src/sync/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PoolLike extends Connectable {
  end(): Promise<void>;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { substitutes: { type: "string", default: join(ROOT, "data/substitutes.csv") } },
  });
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    console.error("kg:rebuild: DATABASE_URL is not set");
    return 2;
  }
  // `pg` is a dependency of the graph package, resolved from there.
  const pg = createRequire(join(ROOT, "packages/graph/package.json"))("pg") as {
    Pool: new (config: { connectionString: string; max: number }) => PoolLike;
  };
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const source = new PostgresKgSource(pool, { substitutes: values.substitutes });
    const store = new PostgresGraphStore(pool, { exclusions: (hh) => source.exclusions(hh) });
    const started = Date.now();
    const snapshot = await rebuildGraph(store, source);
    console.log(
      `kg:rebuild: ${String(snapshot.nodes.length)} nodes, ${String(snapshot.edges.length)} edges in ${String(Date.now() - started)} ms`,
    );
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error("kg:rebuild failed:", error);
    process.exitCode = 1;
  },
);
