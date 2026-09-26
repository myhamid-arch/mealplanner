// G1: migrations apply to an empty PostgreSQL 16 and re-run idempotently; introspection finds every
// table and column of 02-domain-model, 13-revision-r2 and the BLD-8 rulings; the committed
// migrations equal the TypeScript schema, and an edited migration or an unmigrated schema edit is
// detected (BLD-8 R-9).
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrations/index.js";
import { newId } from "../src/schema/ids.js";
import { createEmptyDatabase } from "./support/db.js";
import { schemaFingerprint, specProblems } from "./support/introspect.js";
import { must } from "./support/must.js";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_KIT = join(PACKAGE_DIR, "node_modules", "drizzle-kit", "bin.cjs");
/** Scratch space inside the package, so copied schema files resolve the package's dependencies. */
const SCRATCH = join(PACKAGE_DIR, "node_modules", ".cache", "leaf-1.1.2-drift");

type Empty = Awaited<ReturnType<typeof createEmptyDatabase>>;
const cleanups: (() => Promise<void>)[] = [];

async function database(): Promise<Empty & { pool: pg.Pool }> {
  const empty = await createEmptyDatabase("mp_g1");
  const pool = new pg.Pool({ connectionString: empty.url, max: 2 });
  cleanups.push(async () => {
    await pool.end();
    await empty.drop();
  });
  return { ...empty, pool };
}

async function migrateFrom(url: string, folder: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
  }
}

function drizzleKit(
  args: string[],
  config: Record<string, unknown>,
): { code: number; output: string } {
  mkdirSync(SCRATCH, { recursive: true });
  const configPath = join(SCRATCH, `config-${newId()}.mjs`);
  writeFileSync(configPath, `export default ${JSON.stringify(config)};\n`);
  const result = spawnSync(process.execPath, [DRIZZLE_KIT, ...args, "--config", configPath], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    input: "",
    timeout: 120_000,
  });
  rmSync(configPath, { force: true });
  return { code: result.status ?? -1, output: `${result.stdout}\n${result.stderr}` };
}

const sqlFiles = (folder: string) =>
  readdirSync(folder)
    .filter((f) => f.endsWith(".sql"))
    .sort();

/**
 * Runs `drizzle-kit generate` for `schema` against a copy of the committed migrations and returns
 * the migration files it added (empty = the committed migrations already match the schema).
 */
function generatedMigrations(schema: string): string[] {
  const out = join(SCRATCH, `out-${newId()}`);
  cpSync(MIGRATIONS_FOLDER, out, { recursive: true, filter: (src) => !src.endsWith(".ts") });
  const before = sqlFiles(out);
  // drizzle-kit 0.31 needs `out` relative to the working directory, and exits 0 on some errors;
  // only its explicit success lines count as a result.
  const result = drizzleKit(["generate"], {
    dialect: "postgresql",
    schema,
    out: relative(PACKAGE_DIR, out),
    strict: true,
  });
  const added = sqlFiles(out).filter((f) => !before.includes(f));
  const reported = /No schema changes, nothing to migrate/.test(result.output)
    ? 0
    : /Your SQL migration file/.test(result.output)
      ? 1
      : -1;
  if (result.code !== 0 || reported === -1 || reported !== added.length)
    throw new Error(`drizzle-kit generate did not report a result:\n${result.output}`);
  rmSync(out, { recursive: true, force: true });
  return added;
}

/** A database built from the TypeScript schema directly (drizzle-kit push), for comparison. */
async function pushedFingerprint(): Promise<string[]> {
  const pushed = await database();
  await pushed.pool.query("CREATE EXTENSION IF NOT EXISTS citext");
  const result = drizzleKit(["push", "--force"], {
    dialect: "postgresql",
    schema: "./src/schema/index.ts",
    dbCredentials: { url: pushed.url },
    strict: false,
  });
  if (result.code !== 0 || !/Changes applied/.test(result.output))
    throw new Error(`drizzle-kit push failed:\n${result.output}`);
  return schemaFingerprint(pushed.pool);
}

const journalEntries = () =>
  (
    JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
      entries: unknown[];
    }
  ).entries.length;

let fromSchema: string[];

beforeAll(async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  fromSchema = await pushedFingerprint();
}, 180_000);

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("G1 migrations and schema", { timeout: 120_000 }, () => {
  it("apply to an empty PostgreSQL 16 database and re-run idempotently", async () => {
    const db = await database();
    const version = must(
      (await db.pool.query<{ server_version: string }>("SHOW server_version")).rows[0],
    ).server_version;
    expect(version).toMatch(/^16\./);
    expect(
      (
        await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
        )
      ).rows[0]?.n,
    ).toBe(0);
    await runMigrations(db.url);
    const first = await schemaFingerprint(db.pool);
    await runMigrations(db.url);
    await runMigrations(db.url);
    expect(await schemaFingerprint(db.pool)).toEqual(first);
    const applied = must(
      (
        await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
        )
      ).rows[0],
    ).n;
    expect(applied).toBe(journalEntries());
    expect(sqlFiles(MIGRATIONS_FOLDER).length).toBe(journalEntries());
  });

  it("introspection finds every table and column of 02, 13 and the BLD-8 rulings", async () => {
    const db = await database();
    await runMigrations(db.url);
    expect(await specProblems(db.pool)).toEqual([]);
  });

  it("the database enforces the spec's value rules (R-12 bias range, DM-5 allergy is hard, citext email)", async () => {
    const db = await database();
    await runMigrations(db.url);
    const q = (text: string) => db.pool.query(text);
    const expectCheck = async (text: string) =>
      expect(q(text)).rejects.toMatchObject({ code: "23514" });
    await q(
      `INSERT INTO "user" (id, email, name, created_at, updated_at) VALUES ('${newId()}', 'Case@Example.com', 'x', now(), now())`,
    );
    await expect(
      q(
        `INSERT INTO "user" (id, email, name, created_at, updated_at) VALUES ('${newId()}', 'case@example.COM', 'y', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    const household = newId();
    const member = newId();
    await q(`INSERT INTO household (id, name, created_at) VALUES ('${household}', 'h', now())`);
    await q(
      `INSERT INTO member (id, household_id, display_name, color, is_targeted) VALUES ('${member}', '${household}', 'm', 'sea', false)`,
    );
    await expectCheck(
      `INSERT INTO portion_bias (household_id, member_id, component_role, bias) VALUES ('${household}', '${member}', 'carb', 1.7)`,
    );
    await expectCheck(
      `INSERT INTO portion_bias (household_id, member_id, component_role, bias) VALUES ('${household}', '${member}', 'carb', 0.5)`,
    );
    await q(
      `INSERT INTO portion_bias (household_id, member_id, component_role, bias) VALUES ('${household}', '${member}', 'carb', 1.6)`,
    );
    await expectCheck(
      `INSERT INTO exclusion (id, household_id, member_id, kind, key, reason, hard) VALUES ('${newId()}', '${household}', '${member}', 'dietary_flag', 'contains_sesame', 'allergy', false)`,
    );
    // A member of another household cannot be referenced (composite FK, BLD-8 R-8).
    const other = newId();
    await q(`INSERT INTO household (id, name, created_at) VALUES ('${other}', 'o', now())`);
    await expect(
      q(`INSERT INTO tolerance (member_id, household_id) VALUES ('${member}', '${other}')`),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("the committed migrations equal the TypeScript schema (drizzle-kit generate adds nothing)", () => {
    expect(generatedMigrations("./src/schema/index.ts")).toEqual([]);
  });

  it("a database built from the migrations equals one built from the schema", async () => {
    const db = await database();
    await runMigrations(db.url);
    expect(await schemaFingerprint(db.pool)).toEqual(fromSchema);
  });

  it("negative control: a missing column or table is reported by the introspection check", async () => {
    const db = await database();
    await runMigrations(db.url);
    await db.pool.query("ALTER TABLE household_user DROP COLUMN blocked_reason");
    await db.pool.query("DROP TABLE support_grant");
    const problems = await specProblems(db.pool);
    expect(problems).toContain("missing column household_user.blocked_reason");
    expect(problems).toContain("missing table support_grant");
  });

  it("negative control: an edited committed migration is detected", async () => {
    const edited = join(SCRATCH, `edited-${newId()}`);
    cpSync(MIGRATIONS_FOLDER, edited, { recursive: true, filter: (src) => !src.endsWith(".ts") });
    // Tamper with the migration that creates household_user (0001), not simply the newest one:
    // later migrations (0002 onwards, R-9) do not contain this column.
    const file = join(
      edited,
      must(
        sqlFiles(edited).find((f) =>
          readFileSync(join(edited, f), "utf8").includes('\t"blocked_reason" text,\n'),
        ),
      ),
    );
    const original = readFileSync(file, "utf8");
    const tampered = original.replace(/\t"blocked_reason" text,\n/, "");
    expect(tampered).not.toBe(original);
    writeFileSync(file, tampered);
    const db = await database();
    await migrateFrom(db.url, edited);
    expect(await schemaFingerprint(db.pool)).not.toEqual(fromSchema);
    expect(await specProblems(db.pool)).toContain("missing column household_user.blocked_reason");
    rmSync(edited, { recursive: true, force: true });
  });

  it("negative control: a schema change without a migration is detected", () => {
    const copy = join(SCRATCH, `schema-${newId()}`);
    cpSync(join(PACKAGE_DIR, "src", "schema"), copy, { recursive: true });
    const members = join(copy, "members.ts");
    const source = readFileSync(members, "utf8");
    const changed = source.replace(
      'notes: text("notes"),',
      'notes: text("notes"),\n    nickname: text("nickname"),',
    );
    expect(changed).not.toBe(source);
    writeFileSync(members, changed);
    expect(existsSync(join(copy, "index.ts"))).toBe(true);
    const added = generatedMigrations(join(copy, "index.ts"));
    expect(added.length).toBe(1);
    rmSync(copy, { recursive: true, force: true });
  });
});
