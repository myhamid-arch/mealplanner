// Workspace discovery and disposable workspace copies for negative controls.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run, tail } from "./run.mjs";

/** Path segments that are build output or installed dependencies, never copied. */
const GENERATED_SEGMENTS = new Set(["node_modules", "dist", ".next", ".turbo"]);
const GENERATED_FILES = new Set(["next-env.d.ts"]);

/**
 * Lists workspace packages by reading the `packages:` globs of pnpm-workspace.yaml.
 * Only single-level `dir/*` globs are supported, which is all this repository uses.
 * @param {string} root
 * @returns {{ dir: string, manifest: Record<string, any> }[]}
 */
export function listWorkspacePackages(root) {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/.exec(line);
      if (item?.[1]) globs.push(item[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  const packages = [];
  for (const glob of globs) {
    const match = /^([^*]+)\/\*$/.exec(glob);
    if (!match?.[1]) throw new Error(`unsupported workspace glob: ${glob}`);
    const parent = join(root, match[1]);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const manifestPath = join(parent, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(manifestPath)) {
        packages.push({
          dir: `${match[1]}/${entry.name}`,
          manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
        });
      }
    }
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Source files of the working tree: tracked plus untracked-but-not-ignored, minus build output.
 * @param {string} root
 */
export function listSourceFiles(root) {
  const result = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
  });
  if (result.code !== 0) throw new Error(`git ls-files failed:\n${tail(result)}`);
  return result.stdout
    .split("\0")
    .filter((path) => path !== "")
    .filter((path) => {
      const segments = path.split("/");
      return (
        !segments.some((segment) => GENERATED_SEGMENTS.has(segment)) &&
        !GENERATED_FILES.has(segments.at(-1) ?? "")
      );
    })
    .filter((path) => existsSync(join(root, path)));
}

/**
 * Copies the workspace sources into a fresh temporary directory.
 * @param {string} root
 * @returns {{ dir: string, dispose: () => void }}
 */
export function copyWorkspace(root) {
  const dir = mkdtempSync(join(tmpdir(), "mealplanner-verify-"));
  for (const path of listSourceFiles(root)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(join(root, path), join(dir, path));
  }
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Installs dependencies in a workspace copy from the lockfile, preferring the local store.
 * @param {string} dir
 */
export function installCopy(dir) {
  return run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"], {
    cwd: dir,
    env: { CI: "1" },
  });
}
