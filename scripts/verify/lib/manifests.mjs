// Spec encodings for leaf 1.1.1 and the manifest assertions built on them.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** ARC-2: the v1 workspace (apps/mobile is phase B, BLD-8 R-6). Directory → package name. */
export const ARC2_PACKAGES = {
  "apps/web": "@mealplanner/web",
  "apps/worker": "@mealplanner/worker",
  "packages/ai": "@mealplanner/ai",
  "packages/api-contract": "@mealplanner/api-contract",
  "packages/core": "@mealplanner/core",
  "packages/db": "@mealplanner/db",
  "packages/graph": "@mealplanner/graph",
  "packages/ui-tokens": "@mealplanner/ui-tokens",
};

/**
 * ARC-1: every named library, the manifest that declares it (leaf-1.1.1 ADR-6),
 * and the major version ARC-1 fixes where it fixes one.
 * @type {{ concern: string, name: string, dir: string, major?: number }[]}
 */
export const ARC1_DEPENDENCIES = [
  { concern: "Language", name: "typescript", dir: ".", major: 5 },
  { concern: "Monorepo", name: "turbo", dir: "." },
  { concern: "Web", name: "next", dir: "apps/web" },
  { concern: "Web", name: "react", dir: "apps/web", major: 19 },
  { concern: "Web", name: "react-dom", dir: "apps/web", major: 19 },
  { concern: "Styling", name: "tailwindcss", dir: "apps/web", major: 4 },
  { concern: "Styling", name: "@tailwindcss/postcss", dir: "apps/web", major: 4 },
  { concern: "Styling", name: "radix-ui", dir: "apps/web" },
  { concern: "Motion", name: "motion", dir: "apps/web" },
  { concern: "Database", name: "pg", dir: "packages/db" },
  { concern: "ORM", name: "drizzle-orm", dir: "packages/db" },
  { concern: "Migrations", name: "drizzle-kit", dir: "packages/db" },
  { concern: "Background jobs", name: "pg-boss", dir: "apps/worker" },
  { concern: "Optimisation", name: "highs", dir: "packages/core" },
  { concern: "Validation", name: "zod", dir: "packages/core" },
  { concern: "LLM", name: "@anthropic-ai/sdk", dir: "packages/ai" },
  { concern: "Auth", name: "better-auth", dir: "apps/web" },
  { concern: "Tests", name: "vitest", dir: "." },
  { concern: "Tests", name: "@playwright/test", dir: "apps/web" },
  { concern: "Lint", name: "eslint", dir: "." },
  { concern: "Lint", name: "typescript-eslint", dir: "." },
  { concern: "Lint (ARC-3)", name: "eslint-plugin-boundaries", dir: "." },
  { concern: "Format", name: "prettier", dir: "." },
];

/**
 * ARC-3 as an exhaustive allow-list (BLD-8 R-2): element → internal elements it may import.
 * Written from the spec text, independently of eslint.config.mjs, which must match it.
 */
export const ARC3_ALLOWED = {
  core: [],
  db: ["core"],
  graph: ["core"],
  ai: ["core"],
  "api-contract": ["core"],
  "ui-tokens": [],
  app: ["core", "db", "graph", "ai", "api-contract", "ui-tokens"],
};

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * Every dependency specifier that is neither an exact version nor `workspace:*`.
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
export function unpinnedSpecifiers(manifest) {
  const problems = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      const internal = name.startsWith("@mealplanner/");
      const ok = internal ? spec === "workspace:*" : EXACT_SEMVER.test(String(spec));
      if (!ok) problems.push(`${field}.${name}: "${String(spec)}"`);
    }
  }
  return problems;
}

/**
 * The declared specifier for `name` in dependencies or devDependencies, or undefined.
 * @param {Record<string, any>} manifest
 * @param {string} name
 */
export function declaredVersion(manifest, name) {
  return manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
}

/**
 * The version installed for `name` as resolved from `packageDir` (follows pnpm symlinks).
 * @param {string} packageDir absolute
 * @param {string} name
 */
export function installedVersion(packageDir, name) {
  const path = join(packageDir, "node_modules", name, "package.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(realpathSync(path), "utf8")).version;
}

/**
 * ARC-1 declaration problems: a library missing from its manifest, not pinned exactly,
 * installed at a different version, or outside the major version ARC-1 fixes.
 * @param {Map<string, Record<string, any>>} manifests workspace dir (root is ".") → manifest
 * @param {(dir: string, name: string) => string | undefined} installed
 * @returns {string[]}
 */
export function arc1Problems(manifests, installed) {
  const problems = [];
  for (const dep of ARC1_DEPENDENCIES) {
    const declared = declaredVersion(manifests.get(dep.dir) ?? {}, dep.name);
    const actual = installed(dep.dir, dep.name);
    const where = `${dep.concern}: ${dep.name} in ${dep.dir}`;
    if (declared === undefined) problems.push(`${where} is not declared`);
    else if (!/^\d+\.\d+\.\d+$/.test(declared))
      problems.push(`${where} is "${declared}", not an exact version`);
    else if (actual !== declared)
      problems.push(`${where} declares ${declared} but ${String(actual)} is installed`);
    else if (dep.major !== undefined && Number(declared.split(".")[0]) !== dep.major)
      problems.push(`${where} is ${declared}; ARC-1 requires major ${String(dep.major)}`);
  }
  return problems;
}

/** Element type of a workspace directory: its package folder name, or "app". */
export function elementOf(dir) {
  return dir.startsWith("apps/") ? "app" : dir.slice("packages/".length);
}

/**
 * Internal `workspace:*` dependencies a manifest declares that ARC-3 forbids.
 * @param {string} dir workspace directory, e.g. "packages/db"
 * @param {Record<string, any>} manifest
 * @param {Record<string, string[]>} allowed
 */
export function forbiddenInternalEdges(dir, manifest, allowed) {
  const from = elementOf(dir);
  const permitted = new Set(allowed[from] ?? []);
  const problems = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!name.startsWith("@mealplanner/")) continue;
      const target = name.slice("@mealplanner/".length);
      const targetElement = target === "web" || target === "worker" ? "app" : target;
      if (!permitted.has(targetElement)) problems.push(`${dir} → ${name}`);
    }
  }
  return problems;
}
