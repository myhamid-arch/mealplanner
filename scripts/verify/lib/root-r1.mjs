// Root R1 (R-79): every node ledger reverified through gate-check, one node at a time, with each
// node's pass cached under the git tree it ran on so a rerun after a reboot resumes.
//
// - A node runs `node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve
//   --reverify --jobs 1 --timeout 14400 docs/build/gates/node-1.<n>.md`.
// - Its pass is cached (node, tree = `git rev-parse HEAD^{tree}`, the exact command) only when it
//   exited 0 with ALL MET, the tree did not change during the run, and the worktree was clean
//   before and after it (SPEC-Q-3): no untracked file, and tracked changes only in the gate
//   ledgers' EVIDENCE lines and `[ ]`/`[x]` boxes, which gate-check itself writes.
// - A rerun skips a node only when its entry has the current tree and the same command.
// - PASSED only when all four nodes have a pass on the current tree.
// Negative controls (the same functions, a temporary cache, a throwaway git worktree): passes
// cached under another tree are not reused; the same passes under the current tree are; an
// EVIDENCE-only edit is clean while a code edit or an untracked file is dirty.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHILD_ENV, ROOT, withLock } from "./node.mjs";
import { run } from "./run.mjs";

export const NODES = ["node-1.1", "node-1.2", "node-1.3", "node-1.4"];
export const CACHE_FILE = join(ROOT, "node_modules/.cache/mealplanner-root-verify/r1.json");
const GATE_CHECK = ".claude/skills/unlazy/scripts/gate-check.mjs";

/** The argv R-79 prescribes for one node. */
export function gateCheckArgs(node) {
  return [
    GATE_CHECK,
    "--root",
    ".",
    "--cwd",
    ".",
    "--approve",
    "--reverify",
    "--jobs",
    "1",
    "--timeout",
    "14400",
    `docs/build/gates/${node}.md`,
  ];
}

export const commandOf = (node) => ["node", ...gateCheckArgs(node)].join(" ");

function git(args, cwd) {
  const r = run("git", args, { cwd, timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

export function currentTree(cwd = ROOT) {
  return git(["rev-parse", "HEAD^{tree}"], cwd).trim();
}

/** Gate ledgers, whose EVIDENCE lines and boxes gate-check rewrites. */
const LEDGER = /^docs\/build\/(GATES\.md|gates\/[^/]+\.md)$/;

/** A ledger with what gate-check writes blanked out: EVIDENCE values and gate boxes. */
export function normalizeLedger(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s+)EVIDENCE:.*$/, "$1EVIDENCE: *")
        .replace(/^(\s*)- \[[ xX]\] /, "$1- [?] "),
    )
    .join("\n");
}

/** Why the worktree at `cwd` is not clean for R1's cache (SPEC-Q-3); empty when it is. */
export function dirtyReasons(cwd = ROOT) {
  const reasons = [];
  for (const f of git(["ls-files", "--others", "--exclude-standard", "-z"], cwd).split("\0"))
    if (f !== "") reasons.push(`untracked: ${f}`);
  for (const f of git(["diff", "HEAD", "--name-only", "--no-renames", "-z"], cwd).split("\0")) {
    if (f === "") continue;
    if (!LEDGER.test(f)) {
      reasons.push(`changed: ${f}`);
      continue;
    }
    const path = join(cwd, f);
    if (!existsSync(path)) {
      reasons.push(`deleted: ${f}`);
      continue;
    }
    const head = git(["show", `HEAD:${f}`], cwd);
    if (normalizeLedger(head) !== normalizeLedger(readFileSync(path, "utf8")))
      reasons.push(`changed beyond EVIDENCE lines and boxes: ${f}`);
  }
  return reasons;
}

export function readCache(file = CACHE_FILE) {
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(c.entries) ? c : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

function writeCache(file, cache) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`);
  renameSync(tmp, file);
}

/** The cached pass of `node` that a run on `tree` may reuse, if any. */
export function reusable(cache, node, tree) {
  return cache.entries.find(
    (e) => e.node === node && e.tree === tree && e.command === commandOf(node) && e.exit === 0,
  );
}

/** The nodes a run on `tree` must still run, in order. */
export const nodesToRun = (cache, tree) => NODES.filter((n) => reusable(cache, n, tree) === undefined);

export function recordPass(file, entry) {
  const cache = readCache(file);
  cache.entries = [...cache.entries.filter((e) => !(e.node === entry.node && e.tree === entry.tree)), entry];
  writeCache(file, cache);
}

/** gate-check on one node; its full output goes to `logFile`, the last lines to the console. */
function runNode(node, logFile) {
  return new Promise((resolve) => {
    writeFileSync(logFile, `${commandOf(node)}\n`);
    const child = spawn(process.execPath, gateCheckArgs(node), {
      cwd: ROOT,
      env: { ...process.env, ...CHILD_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let last = "";
    const keep = (chunk) => {
      const text = chunk.toString();
      appendFileSync(logFile, text);
      last = (last + text).slice(-20_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("close", (code, signal) => resolve({ code: code ?? -1, signal, last }));
    child.on("error", (error) => resolve({ code: -1, signal: null, last: String(error) }));
  });
}

const lastLines = (text, n) => text.trimEnd().split("\n").slice(-n).join("\n");

/** Controls (a)–(c). */
function controls(report) {
  const tree = currentTree();
  const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"], ROOT).trim().split(" ");
  const otherTree =
    parents.length > 1 ? git(["rev-parse", `${parents[1]}^{tree}`], ROOT).trim() : "0".repeat(40);
  const dir = mkdtempSync(join(tmpdir(), "root-r1-control-"));
  try {
    const file = join(dir, "r1.json");
    for (const node of NODES)
      recordPass(file, { node, tree: otherTree, command: commandOf(node), exit: 0 });
    const a = nodesToRun(readCache(file), tree);
    report.check(
      otherTree !== tree && a.length === NODES.length,
      `negative control (a): four passes cached under another tree (${otherTree.slice(0, 12)}, HEAD's parent) are not reused on ${tree.slice(0, 12)}: ${String(a.length)} of 4 nodes still to run`,
    );
    for (const node of NODES)
      recordPass(file, { node, tree, command: commandOf(node), exit: 0 });
    const b = nodesToRun(readCache(file), tree);
    report.check(b.length === 0, `control (b): the same passes under the current tree are reused: ${String(b.length)} of 4 nodes to run`);
    const otherCommand = {
      entries: [{ node: NODES[0], tree, command: `${commandOf(NODES[0])} --timeout 120`, exit: 0 }],
    };
    report.check(
      nodesToRun(otherCommand, tree)[0] === NODES[0],
      "negative control (a'): a pass recorded under another gate-check command is not reused",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // (c) The clean rule in a throwaway worktree of HEAD.
  const wt = mkdtempSync(join(tmpdir(), "root-r1-worktree-"));
  const path = join(wt, "tree");
  try {
    git(["worktree", "add", "--detach", path, "HEAD"], ROOT);
    const clean = dirtyReasons(path);
    const ledger = join(path, "docs/build/gates/node-1.1.md");
    const text = readFileSync(ledger, "utf8");
    writeFileSync(
      ledger,
      text
        .replace(/^(\s+EVIDENCE:).*$/m, "$1 pending")
        .replace(/^- \[[ x]\] /m, (m) => (m.includes("[x]") ? "- [ ] " : "- [x] ")),
    );
    const evidenceOnly = dirtyReasons(path);
    writeFileSync(ledger, text.replace(/^(\s+CHECK:.*)$/m, "$1 "));
    const checkEdit = dirtyReasons(path);
    writeFileSync(ledger, text);
    const code = join(path, "scripts/verify/lib/lock.mjs");
    const codeText = readFileSync(code, "utf8");
    writeFileSync(code, codeText.replace("5_000", "5_001"));
    const codeEdit = dirtyReasons(path);
    writeFileSync(code, codeText);
    writeFileSync(join(path, "stray.txt"), "x");
    const untracked = dirtyReasons(path);
    report.check(
      clean.length === 0 && evidenceOnly.length === 0,
      `control (c): a fresh worktree is clean, and so is one whose only change is an EVIDENCE line and a gate box (${String(evidenceOnly.length)} reasons)`,
      [...clean, ...evidenceOnly].join("\n"),
    );
    report.check(
      codeEdit.some((r) => r === "changed: scripts/verify/lib/lock.mjs") &&
        checkEdit.some((r) => r.startsWith("changed beyond EVIDENCE lines")) &&
        untracked.some((r) => r === "untracked: stray.txt"),
      `negative control (c): a one-character code edit, a CHECK edit in a ledger and an untracked file each make it dirty (${[codeEdit, checkEdit, untracked].map((x) => x.join("; ")).join(" | ")})`,
    );
  } finally {
    run("git", ["worktree", "remove", "--force", path], { cwd: ROOT });
    run("git", ["worktree", "prune"], { cwd: ROOT });
    rmSync(wt, { recursive: true, force: true });
  }
}

export async function gateR1(report, cacheFile = CACHE_FILE) {
  controls(report);
  if (report.failures.length > 0) return;
  await withLock("root-r1", async () => {
    for (const node of NODES) {
      const tree = currentTree();
      const hit = reusable(readCache(cacheFile), node, tree);
      if (hit !== undefined) {
        report.check(
          true,
          `${node}: reused its pass on tree ${tree.slice(0, 12)} (recorded ${String(hit.finishedAt)}, ${String(hit.seconds)} s)`,
        );
        continue;
      }
      const before = dirtyReasons();
      const logFile = join(tmpdir(), `root-r1-${node}-${String(process.pid)}.log`);
      console.log(
        `       ${node}: ${commandOf(node)}\n       worktree ${before.length === 0 ? "clean" : `dirty (${before.join("; ")})`}; full output: ${logFile}`,
      );
      const started = Date.now();
      const r = await runNode(node, logFile);
      const seconds = Math.round((Date.now() - started) / 1000);
      const after = dirtyReasons();
      const treeAfter = currentTree();
      const met = r.code === 0 && /^ALL MET \(/m.test(r.last);
      console.log(`       ${node} gate-check, last lines:\n${lastLines(r.last, 30).replace(/^/gm, "         ")}`);
      if (!report.check(met, `${node}: gate-check --reverify exits 0 with ALL MET (${String(seconds)} s, exit ${String(r.code)})`))
        continue;
      const clean = before.length === 0 && after.length === 0 && tree === treeAfter;
      report.check(
        clean,
        `${node}: the pass is tied to tree ${tree.slice(0, 12)} (clean worktree before and after, tree unchanged) and cached`,
        [...before, ...after, tree === treeAfter ? "" : `tree changed to ${treeAfter}`].join("\n"),
      );
      if (clean)
        recordPass(cacheFile, {
          node,
          tree,
          command: commandOf(node),
          exit: 0,
          seconds,
          finishedAt: new Date().toISOString(),
        });
    }
  });
  const tree = currentTree();
  const missing = nodesToRun(readCache(cacheFile), tree);
  report.check(
    missing.length === 0,
    `all four nodes passed on the current tree ${tree}`,
    `no pass on this tree: ${missing.join(", ")}`,
  );
}
