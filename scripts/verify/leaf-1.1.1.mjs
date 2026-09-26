// Verify script for leaf 1.1.1 (Monorepo, tooling, CI).
// Usage: node scripts/verify/leaf-1.1.1.mjs --gate G1|G2
// Prints "VERIFY leaf-1.1.1 <gate> PASSED" only when every assertion, including the
// negative controls, holds; exits non-zero otherwise.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ARC1_DEPENDENCIES,
  ARC2_PACKAGES,
  ARC3_ALLOWED,
  arc1Problems,
  forbiddenInternalEdges,
  installedVersion,
  unpinnedSpecifiers,
} from "./lib/manifests.mjs";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";
import { copyWorkspace, installCopy, listWorkspacePackages } from "./lib/workspace.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD_ENV = { NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1" };

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------------------------
// G1: pnpm install --frozen-lockfile and pnpm -r build succeed on Node 22 (ARC-1, ARC-2)
// ---------------------------------------------------------------------------------------------
function gateG1() {
  const report = new Report("leaf-1.1.1 G1");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  report.check(nodeMajor === 22, `running on Node 22 (found ${process.versions.node})`);

  const rootManifest = readJson(join(ROOT, "package.json"));
  report.check(
    /^>=22\.\d+\.\d+ <23$/.test(rootManifest.engines?.node ?? ""),
    `root engines.node pins Node 22 (found "${String(rootManifest.engines?.node)}")`,
  );
  report.check(
    /^pnpm@\d+\.\d+\.\d+$/.test(rootManifest.packageManager ?? ""),
    `root packageManager is an exact pnpm version (found "${String(rootManifest.packageManager)}")`,
  );

  const pnpmVersion = run("pnpm", ["--version"], { cwd: ROOT }).stdout.trim();
  report.check(
    rootManifest.packageManager === `pnpm@${pnpmVersion}`,
    `the pnpm in use (${pnpmVersion}) is the one packageManager pins`,
  );

  // ARC-2: the workspace is exactly the v1 package set.
  const packages = listWorkspacePackages(ROOT);
  const found = Object.fromEntries(packages.map((p) => [p.dir, p.manifest.name]));
  report.check(
    JSON.stringify(found) === JSON.stringify(ARC2_PACKAGES),
    "workspace packages equal the ARC-2 v1 layout",
    `expected ${JSON.stringify(ARC2_PACKAGES)}\nfound    ${JSON.stringify(found)}`,
  );

  // Install from the lockfile.
  const install = run("pnpm", ["install", "--frozen-lockfile"], { cwd: ROOT, env: { CI: "1" } });
  report.check(install.code === 0, "pnpm install --frozen-lockfile exits 0", tail(install));

  // ARC-1: every named library is declared where ADR-6 says, pinned exactly, and installed at that version.
  const manifests = new Map([[".", rootManifest], ...packages.map((p) => [p.dir, p.manifest])]);
  const installed = (dir, name) => installedVersion(join(ROOT, dir), name);
  const arc1 = arc1Problems(manifests, installed);
  report.check(
    arc1.length === 0,
    `all ${String(ARC1_DEPENDENCIES.length)} ARC-1 libraries are declared, pinned and installed`,
    arc1.join("\n"),
  );
  for (const dep of ARC1_DEPENDENCIES) {
    console.log(
      `       ${dep.concern}: ${dep.name}@${String(installed(dep.dir, dep.name))} (${dep.dir})`,
    );
  }
  for (const [dir, manifest] of manifests) {
    const unpinned = unpinnedSpecifiers(manifest);
    report.check(
      unpinned.length === 0,
      `${dir}/package.json pins every dependency exactly`,
      unpinned.join("\n"),
    );
  }

  // Negative controls for the pin checks: a range and a missing library must be caught.
  const rangeFixture = { dependencies: { zod: "^4.6.5", "@mealplanner/core": "workspace:^" } };
  report.check(
    unpinnedSpecifiers(rangeFixture).length === 2,
    "negative control: a caret range and a non-* workspace range are both reported as unpinned",
  );
  const broken = new Map([...manifests].map(([dir, m]) => [dir, structuredClone(m)]));
  delete broken.get("packages/core").dependencies.zod;
  broken.get("apps/web").dependencies.next = `^${String(broken.get("apps/web").dependencies.next)}`;
  const brokenProblems = arc1Problems(broken, installed);
  report.check(
    brokenProblems.length === 2 &&
      brokenProblems.some((p) => p.includes("zod") && p.includes("not declared")) &&
      brokenProblems.some((p) => p.includes("next") && p.includes("not an exact version")),
    "negative control: removing zod from packages/core and ranging next in apps/web are both reported",
    brokenProblems.join("\n"),
  );

  // Build every package; each must write fresh output during this run (stale output does not count).
  const buildStarted = Date.now() - 1000;
  const build = run("pnpm", ["-r", "build"], { cwd: ROOT, env: BUILD_ENV });
  report.check(build.code === 0, "pnpm -r build exits 0", tail(build, 40));
  for (const dir of Object.keys(ARC2_PACKAGES)) {
    const output =
      dir === "apps/web"
        ? join(ROOT, dir, ".next", "BUILD_ID")
        : join(ROOT, dir, "dist", "src", dir === "apps/worker" ? "main.js" : "index.js");
    report.check(
      existsSync(output) && statSync(output).mtimeMs >= buildStarted,
      `${dir} wrote ${relative(ROOT, output)} during this build`,
    );
  }

  // BLD-8 amendment 8: every declared workspace:* edge resolves to the built dist entry and imports.
  for (const { dir, manifest } of packages) {
    const internal = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
      (name) => name.startsWith("@mealplanner/"),
    );
    for (const name of internal) {
      const result = resolveAndImport(join(ROOT, dir), name);
      const targetDir = Object.entries(ARC2_PACKAGES).find(([, n]) => n === name)?.[0] ?? "?";
      const expected = join(realpathSync(join(ROOT, targetDir)), "dist", "src", "index.js");
      report.check(
        result.code === 0 && result.stdout.trim() === expected,
        `${dir} resolves and imports ${name} → ${targetDir}/dist/src/index.js`,
        tail(result),
      );
    }
  }
  // Negative control: an undeclared internal edge must not resolve (pnpm isolation), so the check above is not vacuous.
  const undeclared = resolveAndImport(join(ROOT, "packages/core"), "@mealplanner/db");
  report.check(
    undeclared.code !== 0 && /ERR_MODULE_NOT_FOUND|Cannot find package/.test(undeclared.stderr),
    "negative control: packages/core cannot resolve undeclared @mealplanner/db",
    tail(undeclared),
  );

  // Negative controls in a disposable copy: lockfile drift and a type error must both fail.
  const copy = copyWorkspace(ROOT);
  try {
    const install = installCopy(copy.dir);
    report.check(install.code === 0, "workspace copy installs from the lockfile", tail(install));

    const errorFile = join(copy.dir, "packages/core/src/index.ts");
    writeFileSync(errorFile, 'export const broken: number = "not a number";\n');
    const brokenBuild = run("pnpm", ["--filter", "@mealplanner/core", "build"], {
      cwd: copy.dir,
      env: BUILD_ENV,
    });
    report.check(
      brokenBuild.code !== 0 && /TS2322/.test(brokenBuild.stdout + brokenBuild.stderr),
      "negative control: a type error in packages/core fails its build (TS2322)",
      tail(brokenBuild),
    );

    const coreManifestPath = join(copy.dir, "packages/core/package.json");
    const coreManifest = readJson(coreManifestPath);
    coreManifest.dependencies.zod = bumpPatch(coreManifest.dependencies.zod);
    writeFileSync(coreManifestPath, JSON.stringify(coreManifest, null, 2) + "\n");
    const drift = run("pnpm", ["install", "--frozen-lockfile", "--offline"], {
      cwd: copy.dir,
      env: { CI: "1" },
    });
    report.check(
      drift.code !== 0 && /ERR_PNPM_OUTDATED_LOCKFILE/.test(drift.stdout + drift.stderr),
      "negative control: a manifest that drifts from pnpm-lock.yaml fails --frozen-lockfile",
      tail(drift),
    );
  } finally {
    copy.dispose();
  }
  return report.finish();
}

/** Resolves `name` from `packageDir` as ESM, imports it, and prints the resolved real path. */
function resolveAndImport(packageDir, name) {
  const source = [
    `const url = import.meta.resolve(${JSON.stringify(name)});`,
    "await import(url);",
    'const { realpathSync } = await import("node:fs");',
    'const { fileURLToPath } = await import("node:url");',
    "console.log(realpathSync(fileURLToPath(url)));",
  ].join("\n");
  return run(process.execPath, ["--input-type=module", "--eval", source], { cwd: packageDir });
}

/** @param {string} version */
function bumpPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${String(major)}.${String(minor)}.${String((patch ?? 0) + 1)}`;
}

// ---------------------------------------------------------------------------------------------
// G2: pnpm lint and pnpm typecheck pass; the ARC-3 boundary rule rejects illegal imports
// ---------------------------------------------------------------------------------------------

/** Illegal edges: each probe must produce the named rule's error. */
const ILLEGAL_PROBES = [
  {
    file: "packages/core/src/__probe__.ts",
    code: 'import "@mealplanner/db";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/core/src/__probe__.ts",
    code: 'import "../../db/src/index.js";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/core/src/__probe__.ts",
    code: 'import "@mealplanner/core/../../ai";',
    rule: "no-restricted-imports",
  },
  {
    file: "packages/core/src/__probe__.ts",
    code: 'import "node:fs";',
    rule: "no-restricted-imports",
  },
  {
    file: "packages/core/src/__probe__.ts",
    code: 'import "fs/promises";',
    rule: "no-restricted-imports",
  },
  { file: "packages/core/src/__probe__.ts", code: 'import "pg";', rule: "no-restricted-imports" },
  {
    file: "packages/core/src/__probe__.ts",
    code: 'import "drizzle-orm/pg-core";',
    rule: "no-restricted-imports",
  },
  {
    file: "packages/core/src/__probe__.ts",
    code: 'import "@anthropic-ai/sdk";',
    rule: "no-restricted-imports",
  },
  {
    file: "packages/db/src/__probe__.ts",
    code: 'import "@mealplanner/ai";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/db/src/__probe__.ts",
    code: 'import "@mealplanner/core/../ai";',
    rule: "no-restricted-imports",
  },
  {
    file: "packages/db/src/__probe__.ts",
    code: 'import "@mealplanner/web";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/db/src/__probe__.ts",
    code: 'import "../../../apps/web/app/page.js";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/ai/src/__probe__.ts",
    code: 'import "@mealplanner/db";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/ai/src/__probe__.ts",
    code: 'import "@mealplanner/graph";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/graph/src/__probe__.ts",
    code: 'import "@mealplanner/db/repos";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/graph/src/__probe__.ts",
    code: 'import "../../db/src/index.js";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/api-contract/src/__probe__.ts",
    code: 'import "@mealplanner/db";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/ui-tokens/src/__probe__.ts",
    code: 'import "@mealplanner/core";',
    rule: "boundaries/dependencies",
  },
  {
    file: "packages/ui-tokens/src/__probe__.ts",
    code: 'import "@mealplanner/worker";',
    rule: "boundaries/dependencies",
  },
];

/** Legal edges: each probe must lint with zero messages, so the rule is not rejecting everything. */
const LEGAL_PROBES = [
  { file: "packages/core/src/__probe__.ts", code: 'import "zod";' },
  { file: "packages/db/src/__probe__.ts", code: 'import "@mealplanner/core";' },
  { file: "packages/db/src/__probe__.ts", code: 'import "../../core/src/index.js";' },
  { file: "packages/db/src/__probe__.ts", code: 'import "node:fs";' },
  { file: "packages/ai/src/__probe__.ts", code: 'import "@mealplanner/core/nutrition";' },
  { file: "packages/graph/src/__probe__.ts", code: 'import "@mealplanner/core";' },
  { file: "packages/api-contract/src/__probe__.ts", code: 'import "@mealplanner/core";' },
  { file: "apps/web/app/__probe__.ts", code: 'import "@mealplanner/db";' },
  { file: "apps/worker/src/__probe__.ts", code: 'import "@mealplanner/ai";' },
];

async function gateG2() {
  const report = new Report("leaf-1.1.1 G2");

  // The lint config encodes exactly the spec's ARC-3 matrix.
  const config = await import(pathToFileURL(join(ROOT, "eslint.config.mjs")).href);
  report.check(
    JSON.stringify(sortMatrix(config.ALLOWED_INTERNAL_IMPORTS)) ===
      JSON.stringify(sortMatrix(ARC3_ALLOWED)),
    "eslint.config.mjs ARC-3 matrix equals the spec allow-list",
    `config ${JSON.stringify(config.ALLOWED_INTERNAL_IMPORTS)}`,
  );

  const lint = run("pnpm", ["lint"], { cwd: ROOT });
  report.check(lint.code === 0, "pnpm lint exits 0", tail(lint));
  const typecheck = run("pnpm", ["typecheck"], { cwd: ROOT, env: BUILD_ENV });
  report.check(typecheck.code === 0, "pnpm typecheck exits 0", tail(typecheck));

  // Declared manifest edges respect ARC-3, and the checker catches a forbidden one.
  for (const { dir, manifest } of listWorkspacePackages(ROOT)) {
    const bad = forbiddenInternalEdges(dir, manifest, ARC3_ALLOWED);
    report.check(
      bad.length === 0,
      `${dir}/package.json declares only ARC-3-allowed internal edges`,
      bad.join("\n"),
    );
  }
  const badManifest = { dependencies: { "@mealplanner/db": "workspace:*" } };
  report.check(
    forbiddenInternalEdges("packages/core", badManifest, ARC3_ALLOWED).length === 1,
    "negative control: packages/core declaring @mealplanner/db is reported",
  );

  // Probe files are linted on disk in a disposable copy, under the real config.
  const copy = copyWorkspace(ROOT);
  try {
    const install = installCopy(copy.dir);
    report.check(install.code === 0, "workspace copy installs from the lockfile", tail(install));

    const probes = [
      ...ILLEGAL_PROBES.map((probe) => ({ ...probe, legal: false })),
      ...LEGAL_PROBES.map((probe) => ({ ...probe, legal: true })),
    ].map((probe, index) => ({
      ...probe,
      file: probe.file.replace("__probe__", `__probe_${String(index)}__`),
    }));
    const results = lintProbes(copy.dir, probes);
    for (const probe of probes) {
      const messages = results.get(join(copy.dir, probe.file)) ?? null;
      const where = `${probe.file.split("/").slice(0, 2).join("/")} \`${probe.code}\``;
      if (probe.legal) {
        report.check(
          messages !== null && messages.length === 0,
          `positive control: ${where} lints clean`,
          JSON.stringify(messages),
        );
      } else {
        report.check(
          messages !== null && messages.some((m) => m.ruleId === probe.rule && m.severity === 2),
          `negative control: ${where} is rejected by ${probe.rule}`,
          JSON.stringify(messages),
        );
      }
    }

    // The repository-level command passes on the clean copy and fails once one illegal import is added.
    for (const probe of probes) rmSync(join(copy.dir, probe.file));
    const cleanLint = run("pnpm", ["lint"], { cwd: copy.dir });
    report.check(
      cleanLint.code === 0,
      "pnpm lint exits 0 on the copy with the probes removed",
      tail(cleanLint),
    );
    const illegal = ILLEGAL_PROBES[0];
    writeProbe(copy.dir, illegal);
    const failingLint = run("pnpm", ["lint"], { cwd: copy.dir });
    report.check(
      failingLint.code !== 0 && failingLint.stdout.includes("boundaries/dependencies"),
      "negative control: pnpm lint exits non-zero with an illegal core → db import in the tree",
      tail(failingLint),
    );
  } finally {
    copy.dispose();
  }
  return report.finish();
}

/** @param {Record<string, string[]>} matrix */
function sortMatrix(matrix) {
  return Object.fromEntries(
    Object.keys(matrix)
      .sort()
      .map((key) => [key, [...(matrix[key] ?? [])].sort()]),
  );
}

function writeProbe(dir, probe) {
  const path = join(dir, probe.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${probe.code}\n`);
  return path;
}

/**
 * Writes every probe into the copy and lints them in one ESLint run under the real config.
 * @returns {Map<string, { ruleId: string | null, severity: number }[]>} absolute path → messages
 */
function lintProbes(dir, probes) {
  const paths = probes.map((probe) => writeProbe(dir, probe));
  const result = run("pnpm", ["exec", "eslint", "--format", "json", ...paths], { cwd: dir });
  const results = new Map();
  try {
    for (const entry of JSON.parse(result.stdout.slice(result.stdout.indexOf("[")))) {
      results.set(entry.filePath, entry.messages);
    }
  } catch {
    console.log(`ESLint output was not JSON:\n${tail(result)}`);
  }
  return results;
}

// ---------------------------------------------------------------------------------------------

const gateIndex = process.argv.indexOf("--gate");
const gate = gateIndex === -1 ? undefined : process.argv[gateIndex + 1];
const gates = { G1: gateG1, G2: gateG2 };
if (gate === undefined || !(gate in gates)) {
  console.error(`usage: node scripts/verify/leaf-1.1.1.mjs --gate ${Object.keys(gates).join("|")}`);
  process.exit(2);
}
process.exitCode = await gates[gate]();
