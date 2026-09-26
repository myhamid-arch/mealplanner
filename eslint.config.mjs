// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

/**
 * ARC-3 dependency rule, as an exhaustive allow-list (leaf-1.1.1 ADR-3, BLD-8 R-2).
 * Keys are element types; values are the other internal elements each may import.
 */
export const ALLOWED_INTERNAL_IMPORTS = {
  core: [],
  db: ["core"],
  graph: ["core"],
  ai: ["core"],
  "api-contract": ["core"],
  "ui-tokens": [],
  app: ["core", "db", "graph", "ai", "api-contract", "ui-tokens"],
};

const ELEMENT_TYPES = Object.keys(ALLOWED_INTERNAL_IMPORTS);
const PACKAGE_TYPES = ELEMENT_TYPES.filter((type) => type !== "app");

/** Node builtins that perform I/O; forbidden in packages/core ("core does no I/O"). */
const CORE_FORBIDDEN_BUILTINS = [
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "dns/promises",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "net",
  "readline",
  "tls",
  "worker_threads",
];

/** Database, queue and network clients; also forbidden in packages/core. */
const CORE_FORBIDDEN_PACKAGES = [
  "pg",
  "pg-boss",
  "drizzle-orm",
  "@anthropic-ai/sdk",
  "better-auth",
];

const CORE_IO_MESSAGE = "ARC-3: packages/core does no I/O";

/** A package specifier that walks out of the package ("@mealplanner/core/../db") would dodge ARC-3. */
const NO_PACKAGE_TRAVERSAL = {
  regex: "^@mealplanner/(.*/)?\\.\\.(/|$)",
  message: "ARC-3: package specifiers must not contain '..' segments",
};

const dependencyPolicies = ELEMENT_TYPES.map((from) => {
  const allowed = new Set([from, ...ALLOWED_INTERNAL_IMPORTS[from]]);
  const forbiddenElements = ELEMENT_TYPES.filter((type) => !allowed.has(type));
  const forbiddenModules = forbiddenElements
    .filter((type) => type !== "app")
    .flatMap((type) => [`@mealplanner/${type}`, `@mealplanner/${type}/**`]);
  if (from !== "app")
    forbiddenModules.push(
      "@mealplanner/web",
      "@mealplanner/web/**",
      "@mealplanner/worker",
      "@mealplanner/worker/**",
    );
  return {
    from: { element: { type: from } },
    disallow: {
      to: [
        { element: { types: { anyOf: forbiddenElements } } },
        { module: { source: forbiddenModules } },
      ],
    },
    message: `ARC-3: ${from} may import only ${[...allowed].join(", ")}`,
  };
});

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
      ".claude/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        structuredClone: "readonly",
      },
    },
  },
  {
    files: ["apps/**/*.{ts,tsx,mts,cts}", "packages/**/*.{ts,tsx,mts,cts}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        ...PACKAGE_TYPES.map((type) => ({ type, pattern: `packages/${type}` })),
        { type: "app", pattern: "apps/*" },
      ],
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ["packages/*/tsconfig.json", "apps/*/tsconfig.json"],
        },
      },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        { default: "allow", checkAllOrigins: true, policies: dependencyPolicies },
      ],
      "no-restricted-imports": ["error", { patterns: [NO_PACKAGE_TRAVERSAL] }],
    },
  },
  {
    files: ["packages/core/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...CORE_FORBIDDEN_BUILTINS.flatMap((name) => [name, `node:${name}`]),
            ...CORE_FORBIDDEN_PACKAGES,
          ].map((name) => ({ name, message: CORE_IO_MESSAGE })),
          patterns: [
            NO_PACKAGE_TRAVERSAL,
            {
              group: CORE_FORBIDDEN_PACKAGES.map((name) => `${name}/*`),
              message: CORE_IO_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  prettier,
);
