// Deploy entry (ARC-11): apply the committed migrations, then load the catalogue and seed library
// idempotently. Usage: `DATABASE_URL=… [DATA_DIR=…] node packages/db/dist/src/seed/run.js`.
// Prints one JSON line with the counts; exits non-zero on any failure.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { runMigrations } from "../migrations/index.js";
import { loadCatalogue } from "./load.js";

/** The repository's `data/` directory, from src/seed or dist/src/seed. */
export const DEFAULT_DATA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  ...(import.meta.url.includes("/dist/")
    ? ["..", "..", "..", "..", ".."]
    : ["..", "..", "..", ".."]),
  "data",
);

export async function migrateAndSeed(databaseUrl: string, dataDir = DEFAULT_DATA_DIR) {
  await runMigrations(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    return await loadCatalogue(drizzle(pool), { dataDir });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  migrateAndSeed(url, process.env.DATA_DIR ?? DEFAULT_DATA_DIR).then(
    (r) => {
      console.log(JSON.stringify({ seed: "ok", ...r, dishIds: r.dishIds.length }));
    },
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
