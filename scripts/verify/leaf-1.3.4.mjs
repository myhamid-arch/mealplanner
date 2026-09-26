// Verify script for leaf 1.3.4 (Knowledge graph).
// Usage: node scripts/verify/leaf-1.3.4.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.3.4 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise.
//
// Each gate builds @mealplanner/core and @mealplanner/graph (under a lock, only when stale, so
// gates can run concurrently without rewriting a build another gate is reading), runs its unit and
// PostgreSQL tests, requires the named tests and their negative controls to be present and passing,
// then re-checks the figures the tests measured (written to a per-gate scratch file) and runs
// gate-specific checks against the built package. Every such check is also run on a known-bad
// input that must fail. Each test file creates and drops its own databases (kg_test_<uuid>).
//
// Database server: DATABASE_URL when set; otherwise postgres://postgres@localhost:5432/postgres when
// it answers; otherwise a throwaway PostgreSQL 16 cluster started from the local binaries and
// stopped on exit. Whichever is used must report server_version 16.x.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH_DIR = join(ROOT, "packages/graph");
const CORE_DIR = join(ROOT, "packages/core");
const DEFAULT_URL = "postgres://postgres@localhost:5432/postgres";

const NODE_TYPES = [
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
];
const EDGE_TYPES = [
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
];

const GATES = {
  G1: {
    title: "full rebuild equals incremental sync (KG-3)",
    files: ["test/derive.test.ts", "test/rebuild.int.test.ts"],
    required: [
      "G1 rebuild equals the incremental sync after creates, edits, deletes and the nightly recompute",
      "G1 every sync request is idempotent: re-running all of them changes nothing",
      "G1 scripts/kg-rebuild.ts rebuilds a copy of the database to the incremental graph",
      "derives Dish/Component/Variant nodes and every dish edge with household scope",
      "PAIRS_WITH: NPMI > 0 with ≥ 2 co-occurrences, both directions; TYPICAL_IN: weighted share",
      "mirrors each member's winning row by 1.3.2 precedence; skips household-level, zero and component_role",
    ],
    negative: [
      "G1 negative control: an incremental graph that skipped one sync differs from the rebuild",
      "G1 negative control: one perturbed edge weight makes the snapshots differ",
    ],
  },
  G2: {
    title:
      "similarDishes ranks a hand-built near-duplicate first; substitutes respect household exclusions (KG-4)",
    files: ["test/similarity.test.ts", "test/kg4.int.test.ts"],
    required: [
      "G2 similarDishes ranks each hand-built near-duplicate first, with shared ingredients in why",
      "G2 substitutes are ranked by weight, then the smallest macro delta, with the catalogue's delta",
      "G2 substitutes respect the household's exclusions (ingredient slug or id, category, dietary flag; household- and member-level)",
      "sim = 0.6·J + 0.2·C + 0.1·M + 0.1·F, matching a hand computation",
      "uses core ingredients only (no herb_spice, no water) and averages variants, then components",
      "drops candidates hit by an ingredient (slug or id), category or dietary-flag exclusion of the household",
    ],
    negative: [
      "G2 negative control: without the near-duplicate (another household) the same acceptance fails",
      "G2 negative control: the same exclusion sweep over a household without them finds violations",
    ],
  },
  G3: {
    title: "no household-scoped edge visible to another household (KG-2)",
    files: ["test/isolation.int.test.ts"],
    required: [
      "G3 no household-scoped node or edge of one household is visible to the other through any GraphStore read",
      "G3 PostgresKgSource household-scoped reads never return another household's rows (R-35)",
    ],
    negative: ["G3 negative control: the leak detectors flag unfiltered reads"],
  },
};

// ---------------------------------------------------------------------------------------------
// Build (locked, only when stale)
// ---------------------------------------------------------------------------------------------

function newestMtime(dir, skip = () => false) {
  let newest = 0;
  if (!existsSync(dir)) return newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skip(entry.name)) continue;
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(path, skip));
    else newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

function oldestMtime(dir) {
  let oldest = Infinity;
  if (!existsSync(dir)) return 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) oldest = Math.min(oldest, oldestMtime(path));
    else oldest = Math.min(oldest, statSync(path).mtimeMs);
  }
  return oldest === Infinity ? 0 : oldest;
}

function stale(pkgDir) {
  const inputs = Math.max(
    newestMtime(join(pkgDir, "src")),
    newestMtime(join(pkgDir, "test")),
    statSync(join(pkgDir, "package.json")).mtimeMs,
    statSync(join(pkgDir, "tsconfig.json")).mtimeMs,
  );
  const built = oldestMtime(join(pkgDir, "dist"));
  return built === 0 || inputs > built;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildLocked() {
  const lock = join(tmpdir(), "mealplanner-leaf-1.3.4-build.lock");
  const deadline = Date.now() + 600_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (Date.now() > deadline)
        return { code: 1, stdout: "", stderr: `build lock ${lock} held for 10 minutes` };
      await sleep(250);
    }
  }
  try {
    const packages = [CORE_DIR, GRAPH_DIR].filter(stale);
    if (packages.length === 0) return { code: 0, stdout: "build up to date", stderr: "" };
    return run(
      "pnpm",
      ["--filter", "@mealplanner/core", "--filter", "@mealplanner/graph", "build"],
      { cwd: ROOT },
    );
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

async function query(url, text) {
  const pg = (await import(pathToFileURL(join(GRAPH_DIR, "node_modules/pg/lib/index.js")).href))
    .default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
}

async function reachable(url) {
  try {
    await query(url, "SELECT 1");
    return true;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function pgBinDir() {
  const fromConfig = run("pg_config", ["--bindir"], { cwd: ROOT });
  const candidates = [
    fromConfig.code === 0 ? fromConfig.stdout.trim() : "",
    "/usr/lib/postgresql/16/bin",
  ];
  return candidates.find(
    (dir) => dir !== "" && existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl")),
  );
}

/** Starts a throwaway cluster; returns { url, stop }. Runs as the `postgres` user when root. */
async function startCluster() {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error(
      "no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries (initdb) found",
    );
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.3.4-pg-"));
  const port = await freePort();
  const as = (args) =>
    asRoot ? ["runuser", ["-u", "postgres", "--", ...args]] : [args[0], args.slice(1)];
  if (asRoot) run("chown", ["postgres", dir], { cwd: ROOT });
  const init = run(
    ...as([
      join(bin, "initdb"),
      "-D",
      join(dir, "data"),
      "-U",
      "postgres",
      "--auth=trust",
      "--no-sync",
    ]),
    { cwd: tmpdir() },
  );
  if (init.code !== 0) throw new Error(`initdb failed:\n${tail(init)}`);
  const start = run(
    ...as([
      join(bin, "pg_ctl"),
      "-D",
      join(dir, "data"),
      "-l",
      join(dir, "log"),
      "-w",
      "-o",
      `-p ${String(port)} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
      "start",
    ]),
    { cwd: tmpdir() },
  );
  if (start.code !== 0) throw new Error(`pg_ctl start failed:\n${tail(start)}`);
  return {
    url: `postgres://postgres@127.0.0.1:${String(port)}/postgres`,
    stop: () => {
      run(...as([join(bin, "pg_ctl"), "-D", join(dir, "data"), "-m", "immediate", "stop"]), {
        cwd: tmpdir(),
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function acquireDatabase() {
  if (process.env.DATABASE_URL)
    return { url: process.env.DATABASE_URL, source: "DATABASE_URL", stop: () => undefined };
  if (await reachable(DEFAULT_URL))
    return { url: DEFAULT_URL, source: "localhost:5432", stop: () => undefined };
  const cluster = await startCluster();
  return { ...cluster, source: "throwaway cluster" };
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

function vitest(files, env) {
  const outputFile = join(mkdtempSync(join(tmpdir(), "leaf-1.3.4-vitest-")), "report.json");
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--dir",
        "test",
        "--reporter=json",
        "--reporter=default",
        `--outputFile.json=${outputFile}`,
        ...files,
      ],
      { cwd: GRAPH_DIR, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const report = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, "utf8")) : null;
      rmSync(dirname(outputFile), { recursive: true, force: true });
      resolveRun({ code: code ?? -1, output, report });
    });
  });
}

function assertions(report) {
  return (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
}

const importBuilt = (sub) =>
  import(pathToFileURL(join(GRAPH_DIR, "dist/src", sub, "index.js")).href);

function measurements(file, gate) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((m) => m.gate === gate);
}

// ---------------------------------------------------------------------------------------------
// Gate-specific re-checks
// ---------------------------------------------------------------------------------------------

/** 08 §1/§2 coverage of a measured rebuild: every node and edge type present. */
function coverageGaps(m) {
  return [
    ...NODE_TYPES.filter((t) => !((m.nodeTypes ?? {})[t] > 0)).map((t) => `node ${t}`),
    ...EDGE_TYPES.filter((t) => !((m.edgeTypes ?? {})[t] > 0)).map((t) => `edge ${t}`),
  ];
}

function checkG1(report, measured) {
  const by = (check) => measured.filter((m) => m.check === check);
  const [rebuild] = by("rebuild");
  report.check(rebuild !== undefined, "the database test recorded the rebuild comparison");
  if (rebuild === undefined) return;
  console.log(
    `       measured: rebuild ${String(rebuild.nodes)} nodes, ${String(rebuild.edges)} edges; ` +
      `nodes by type ${JSON.stringify(rebuild.nodeTypes)}; edges by type ${JSON.stringify(rebuild.edgeTypes)}`,
  );
  report.check(rebuild.equal === true, "the rebuilt snapshot equals the incremental snapshot");
  report.check(
    rebuild.replacedAllNodeIds === true,
    "the rebuild replaced every node (no id survived)",
  );
  const gaps = coverageGaps(rebuild);
  report.check(
    gaps.length === 0,
    "the compared graph holds every 08 §1 node type and §2 edge type",
    gaps.join(", "),
  );
  const withoutLikes = { ...rebuild, edgeTypes: { ...rebuild.edgeTypes, LIKES: 0 } };
  report.check(
    coverageGaps(withoutLikes).length === 1,
    "negative control: the same coverage check rejects a graph without LIKES edges",
  );
  report.check(
    by("idempotent")[0]?.equal === true,
    "re-running every sync request left the graph unchanged",
  );
  report.check(
    by("kg-rebuild-script")[0]?.equal === true,
    "scripts/kg-rebuild.ts produced the same graph",
  );
  const negatives = [...by("negative-skipped-sync"), ...by("negative-perturbed-weight")];
  report.check(
    negatives.length === 2 && negatives.every((m) => m.equal === false),
    "negative controls: a skipped sync and a perturbed weight both compared unequal",
  );
}

async function checkG2(report, measured) {
  const near = measured.filter((m) => m.check === "near-duplicate");
  for (const m of near)
    console.log(
      `       measured: ${m.dish}: near-duplicate sim ${String(m.firstSim)}, runner-up ${String(m.secondSim)}`,
    );
  const accept = (m) => m.firstIsNearDuplicate === true && m.firstSim > (m.secondSim ?? 0);
  report.check(
    near.length === 4 && near.every(accept),
    "each of 4 near-duplicates ranked first, strictly above the runner-up",
  );
  report.check(
    !accept({ ...near[0], firstIsNearDuplicate: false }) &&
      !accept({ ...near[0], secondSim: near[0]?.firstSim }),
    "negative control: the same acceptance rejects a non-first or tied near-duplicate",
  );
  const [excl] = measured.filter((m) => m.check === "exclusions");
  const [negExcl] = measured.filter((m) => m.check === "negative-exclusions");
  console.log(
    `       measured: ${String(excl?.returned)} substitutes returned under exclusions, ${String(excl?.violations)} violations; ` +
      `${String(negExcl?.violations)} violations for a household without them`,
  );
  report.check(
    excl?.returned > 0 && excl?.violations === 0,
    "substitutes returned under the household's exclusions violate none",
  );
  report.check(
    negExcl?.violations > 0,
    "negative control: the same sweep finds violations where the exclusions do not apply",
  );

  // Built package: the KG-4.1 formula, written out independently.
  const sim = await importBuilt("similarity");
  const store = await importBuilt("store");
  const item = (id, rawG, category = "vegetable") => ({
    ingredientId: id,
    label: id,
    slug: id,
    category,
    rawG,
  });
  const features = (dishId, items, cuisine, method, tags) =>
    sim.dishFeatures({
      dishId,
      cuisines: [{ key: cuisine, label: cuisine, weight: 1 }],
      flavourTags: tags,
      variants: [
        {
          variantId: `${dishId}v`,
          componentId: `${dishId}c`,
          method: { key: method, label: method },
          items,
        },
      ],
    });
  const a = features(
    "a",
    [item("x", 70), item("y", 30), item("s", 5, "herb_spice")],
    "levantine",
    "grilled",
    ["smoky"],
  );
  const b = features("b", [item("x", 40), item("z", 60)], "levantine", "roasted", [
    "smoky",
    "fresh",
  ]);
  const independent = (w) => {
    const J = 0.4 / (0.7 + 0.3 + 0.6); // min x .4; max x .7, y .3, z .6
    return Math.round((w[0] * J + w[1] * 1 + w[2] * 0 + w[3] * 0.5) * 10000) / 10000;
  };
  report.check(
    sim.dishSimilarity(a, b) === independent([0.6, 0.2, 0.1, 0.1]),
    `the built dishSimilarity equals the independent KG-4.1 computation (${String(sim.dishSimilarity(a, b))})`,
  );
  report.check(
    sim.dishSimilarity(a, b) !== independent([0.2, 0.6, 0.1, 0.1]),
    "negative control: the same comparison with swapped weights disagrees",
  );
  const neighbour = (key, weight, props) => ({
    nodeId: key,
    householdId: null,
    type: "Ingredient",
    key,
    label: key,
    weight,
    edgeHouseholdId: null,
    source: "seed",
    props: { slug: key, category: "poultry", dietaryFlags: [], ...props },
    edgeProps: {
      macroDelta: {
        kcal: 0,
        protein: 1,
        carbs: 0,
        fat: 0,
        satFat: 0,
        fibre: 0,
        solubleFibre: null,
        sugar: null,
        sodiumMg: null,
      },
    },
  });
  const candidates = [
    neighbour("turkey", 0.9, {}),
    neighbour("tahini", 0.8, { category: "nut_seed", dietaryFlags: ["contains_sesame"] }),
  ];
  const excluded = [
    {
      id: "e",
      householdId: "h",
      memberId: "m",
      kind: "dietary_flag",
      key: "contains_sesame",
      reason: "allergy",
      hard: true,
    },
  ];
  const ids = (list) => list.map((s) => s.ingredientId).join(",");
  report.check(
    ids(store.rankSubstitutes(candidates, excluded, "h", 10)) === "turkey",
    "the built rankSubstitutes drops an allergy-excluded candidate",
  );
  report.check(
    ids(store.rankSubstitutes(candidates, [], "h", 10)) === "turkey,tahini",
    "negative control: without the exclusion the same candidate is returned",
  );
}

function checkG3(report, measured) {
  const stores = measured.filter((m) => m.check === "store");
  const sources = measured.filter((m) => m.check === "source");
  for (const m of stores)
    console.log(
      `       measured: viewer ${m.viewer} over ${m.owner}'s data: ${String(m.reads)} reads, ${String(m.returned)} results, ${String(m.leaks)} leaks (the owner itself sees ${String(m.ownerSees)} scoped results)`,
    );
  const clean = (m) => m.leaks === 0 && m.reads > 0 && m.ownerSees > 0;
  report.check(
    stores.length === 4 && stores.every(clean),
    "4 store sweeps (2 households × viewer and global) found no leak",
  );
  report.check(
    sources.length === 2 && sources.every((m) => m.leaks === 0 && m.rows > 0),
    "2 source sweeps found no leak",
  );
  report.check(
    !clean({ ...stores[0], leaks: 1 }) && !clean({ ...stores[0], ownerSees: 0 }),
    "negative control: the same acceptance rejects a sweep with one leak, or one whose reads cannot see scoped data at all",
  );
  const [negative] = measured.filter((m) => m.check === "negative");
  report.check(
    negative?.flaggedEdges > 0,
    `negative control: the detector flagged ${String(negative?.flaggedEdges)} unfiltered edges`,
  );
}

// ---------------------------------------------------------------------------------------------

async function gate(id) {
  const spec = GATES[id];
  const report = new Report(`leaf-1.3.4 ${id}`);
  console.log(`# ${id}: ${spec.title}`);

  const build = await buildLocked();
  if (!report.check(build.code === 0, "packages core and graph are built", tail(build)))
    return report.finish();

  const database = await acquireDatabase();
  const scratch = mkdtempSync(join(tmpdir(), `leaf-1.3.4-${id}-`));
  const measureFile = join(scratch, "measure.jsonl");
  try {
    const rows = await query(database.url, "SHOW server_version");
    const version = String(rows[0]?.server_version ?? "");
    report.check(
      /^16\./.test(version),
      `database (${database.source}) is PostgreSQL 16 (server_version ${version})`,
    );

    const result = await vitest(spec.files, {
      DATABASE_URL: database.url,
      KG_MEASURE_FILE: measureFile,
    });
    report.check(
      result.code === 0,
      `vitest exits 0 (${spec.files.join(", ")})`,
      tail({ stdout: result.output, stderr: "" }, 60),
    );
    report.check(result.report !== null, "vitest wrote a JSON report");
    const results = assertions(result.report);
    const byStatus = (status) => results.filter((r) => r.status === status);
    console.log(
      `       tests: ${String(results.length)} (passed ${String(byStatus("passed").length)}, failed ${String(byStatus("failed").length)})`,
    );
    report.check(results.length > 0, "the gate ran tests");
    report.check(
      results.every((r) => r.status === "passed"),
      "every test passed; none failed, skipped, pending or todo",
      results
        .filter((r) => r.status !== "passed")
        .map((r) => `${r.status}: ${r.fullName}`)
        .join("\n"),
    );
    for (const name of [...spec.required, ...spec.negative]) {
      const matches = results.filter((r) => r.fullName.includes(name));
      report.check(
        matches.length > 0 && matches.every((r) => r.status === "passed"),
        `ran and passed: ${name}`,
      );
    }
    report.check(
      spec.negative.length > 0,
      `the gate has ${String(spec.negative.length)} negative control test(s)`,
    );

    const measured = measurements(measureFile, id);
    if (id === "G1") checkG1(report, measured);
    if (id === "G2") await checkG2(report, measured);
    if (id === "G3") checkG3(report, measured);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    database.stop();
  }
  return report.finish();
}

const flag = process.argv.indexOf("--gate");
const id = flag === -1 ? undefined : process.argv[flag + 1];
if (id === undefined || !(id in GATES)) {
  console.error(`usage: node scripts/verify/leaf-1.3.4.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
process.exit(await gate(id));
