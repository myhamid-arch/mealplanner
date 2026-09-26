// Verify script for leaf 1.4.2 (design system, app shell, PWA).
// Usage: node scripts/verify/leaf-1.4.2.mjs --gate G1|G2
// Prints "VERIFY leaf-1.4.2 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// G1  Tokens in light and dark; every declared text/background pair meets AA, computed here from
//     the token values with an independent WCAG implementation; every token is mapped into the
//     web CSS; components use no raw colours; then the browser audit of every rendered text pair
//     (apps/web/e2e/shell.spec.ts, @G1).
// G2  The shell at 390 and 1280 px without horizontal scroll, navigation per role, installability
//     through Chromium's Page.getInstallabilityErrors and the offline fallback
//     (apps/web/e2e/shell.spec.ts, @G2); the manifest and icon files checked here as well.
//
// Browser: PLAYWRIGHT_CHROMIUM_EXECUTABLE, else /opt/pw-browsers/chromium when it exists, else
// Playwright's own Chromium.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TOKENS_PKG = join(ROOT, "packages/ui-tokens");
const WEB = join(ROOT, "apps/web");

// UX-5, written here from the spec text (09-ux.md §5), independently of the package.
const UX5_LIGHT = {
  paper: "#FFF8EE",
  card: "#FFFFFF",
  ink: "#2B2118",
  tomato: "#E4572E",
  saffron: "#F3A712",
  basil: "#3F8F3A",
  aubergine: "#5B2A86",
  sea: "#1F8A8A",
  olive: "#8A8A3A",
  pomegranate: "#B3263E",
  flour: "#F1E7D6",
};
const UX5_DARK = { paper: "#1C1714", card: "#26201B", ink: "#F6EEE3" };
const THRESHOLD = { normal: 4.5, large: 3, nonText: 3 };

// ---------------------------------------------------------------------------------------------
// Independent WCAG 2.x contrast
// ---------------------------------------------------------------------------------------------

function rgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`not #RRGGBB: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------------------------
// Checks shared by the real run and the negative controls
// ---------------------------------------------------------------------------------------------

/** Structural problems: key parity, hex format, UX-5 values. */
function paletteProblems(colors) {
  const problems = [];
  const lightKeys = Object.keys(colors.light ?? {}).sort();
  const darkKeys = Object.keys(colors.dark ?? {}).sort();
  if (lightKeys.join() !== darkKeys.join()) {
    const missing = lightKeys.filter((k) => !darkKeys.includes(k));
    const extra = darkKeys.filter((k) => !lightKeys.includes(k));
    problems.push(
      `light/dark keys differ (dark missing ${missing.join(",") || "-"}; extra ${extra.join(",") || "-"})`,
    );
  }
  for (const theme of ["light", "dark"]) {
    for (const [token, value] of Object.entries(colors[theme] ?? {})) {
      if (!/^#[0-9A-F]{6}$/.test(value))
        problems.push(`${theme}.${token} = ${value} is not #RRGGBB`);
    }
  }
  for (const [token, value] of Object.entries(UX5_LIGHT)) {
    if (colors.light?.[token] !== value)
      problems.push(`light.${token} is ${colors.light?.[token]}, UX-5 says ${value}`);
  }
  for (const [token, value] of Object.entries(UX5_DARK)) {
    if (colors.dark?.[token] !== value)
      problems.push(`dark.${token} is ${colors.dark?.[token]}, UX-5 says ${value}`);
  }
  return problems;
}

/** Declared pairs below their AA threshold in one palette. */
function pairFailures(pairs, palette, theme) {
  const out = [];
  for (const p of pairs) {
    const ratio = contrast(palette[p.fg], palette[p.bg]);
    if (!(ratio >= THRESHOLD[p.kind])) {
      out.push(
        `${theme}: ${p.fg} on ${p.bg} (${p.use}) ${ratio.toFixed(2)} < ${THRESHOLD[p.kind]}`,
      );
    }
  }
  return out;
}

const kebab = (token) => token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Tokens not mapped into Tailwind as `--color-x: var(--x);` in globals.css. */
function unmappedTokens(tokens, css) {
  return tokens.filter((t) => !css.includes(`--color-${kebab(t)}: var(--${kebab(t)});`));
}

/** `color: "<name>"` values in the core fixtures (member rows). */
function storedMemberColours(dir) {
  const out = [];
  for (const file of walk(dir, (p) => /f\d\.ts$/.test(p))) {
    for (const m of readFileSync(file, "utf8").matchAll(/\bcolor:\s*"([a-z]+)"/g)) out.push(m[1]);
  }
  return out;
}

function walk(dir, predicate) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, predicate));
    else if (predicate(path)) out.push(path);
  }
  return out;
}

/** Raw hex colours in component and shell source (all colour must come from tokens). */
function rawColours(files) {
  const out = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      out.push(`${relative(ROOT, file)}: ${m[0]}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Builds and servers that are safe when G1 and G2 run at the same time (CP3 finding 2)
// ---------------------------------------------------------------------------------------------

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** A cross-process lock (an atomic mkdir); a lock left by a dead process is taken over. */
function withLock(name, fn) {
  const lock = join(
    tmpdir(),
    `mealplanner-${name}-${createHash("sha256").update(ROOT).digest("hex").slice(0, 12)}.lock`,
  );
  const deadline = Date.now() + 20 * 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pidFile = join(lock, "pid");
      const holder = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : NaN;
      if (Number.isInteger(holder) && holder > 0 && !processAlive(holder)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${lock}`, { cause: error });
      }
      sleepMs(500);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Compiles ui-tokens into a private staging directory, then moves each file into dist/ with an
 * atomic rename, so a process reading dist/ at the same time never sees a half-written file.
 */
async function buildTokens(report) {
  const dist = join(TOKENS_PKG, "dist");
  const stage = join(dist, `.stage-${String(process.pid)}`);
  rmSync(stage, { recursive: true, force: true });
  const build = run(
    "pnpm",
    ["--filter", "@mealplanner/ui-tokens", "exec", "tsc", "-p", "tsconfig.json", "--outDir", stage],
    { cwd: ROOT },
  );
  report.check(build.code === 0, "@mealplanner/ui-tokens builds with tsc", tail(build));
  if (build.code !== 0) {
    rmSync(stage, { recursive: true, force: true });
    return undefined;
  }
  for (const file of walk(stage, () => true)) {
    const target = join(dist, relative(stage, file));
    mkdirSync(dirname(target), { recursive: true });
    renameSync(file, target);
  }
  rmSync(stage, { recursive: true, force: true });
  const load = (p) => import(pathToFileURL(join(dist, "src", p)).href);
  return { tokens: await load("tokens/index.js"), contrastModule: await load("contrast/index.js") };
}

/** Each gate's own Next.js build directory (under the gitignored .next/). */
const distDirFor = (gate) => `.next/verify-${gate.toLowerCase()}`;

/**
 * `next build` into the gate's own directory. Builds run one at a time (a lock): Next.js refuses
 * a second concurrent build, and every build rewrites the shared next-env.d.ts that its own
 * typecheck then reads.
 */
function buildWeb(report, gate) {
  const build = withLock("leaf-1.4.2-next-build", () =>
    run("pnpm", ["--filter", "@mealplanner/web", "build"], {
      cwd: ROOT,
      env: { NEXT_TELEMETRY_DISABLED: "1", MISE_NEXT_DIST_DIR: distDirFor(gate) },
    }),
  );
  report.check(
    build.code === 0,
    `apps/web builds into ${distDirFor(gate)} (next build, typecheck included)`,
    tail(build),
  );
  return build.code === 0;
}

function portFree(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => {
      resolvePort(false);
    });
    server.listen(port, () => {
      server.close(() => {
        resolvePort(true);
      });
    });
  });
}

/** A free port from the gate's own range: G1 odd ports from 3151, G2 even ports from 3152. */
async function gatePort(gate) {
  const start = gate === "G1" ? 3151 : 3152;
  for (let port = start; port < start + 800; port += 2) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port for ${gate}`);
}

function collectResults(suite, prefix = []) {
  const out = [];
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const statuses = (t.results ?? []).map((r) => r.status);
      out.push({ title: spec.title, status: statuses.at(-1) ?? t.status ?? "unknown" });
    }
  }
  for (const child of suite.suites ?? [])
    out.push(...collectResults(child, [...prefix, child.title]));
  return out;
}

/** Runs the e2e spec for one tag and checks every expected test passed (none skipped). */
async function runE2E(report, gate, expectedTitles) {
  const tag = `@${gate}`;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.2-"));
  const jsonFile = join(dir, "results.json");
  const env = {
    PLAYWRIGHT_SKIP_BUILD: "1",
    PLAYWRIGHT_PORT: String(await gatePort(gate)),
    MISE_NEXT_DIST_DIR: distDirFor(gate),
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
    PLAYWRIGHT_OUTPUT_DIR: join(dir, "out"),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE === undefined &&
    existsSync("/opt/pw-browsers/chromium")
  ) {
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";
  }
  try {
    const result = run(
      "pnpm",
      ["exec", "playwright", "test", "e2e/shell.spec.ts", "--grep", tag, "--reporter=json"],
      { cwd: WEB, env, timeoutMs: 900_000 },
    );
    report.check(result.code === 0, `Playwright ${tag} run exits 0`, tail(result, 60));
    if (!existsSync(jsonFile)) {
      report.check(false, `Playwright ${tag} wrote a JSON report`);
      return;
    }
    const results = collectResults(JSON.parse(readFileSync(jsonFile, "utf8")));
    const byTitle = new Map(results.map((r) => [r.title, r.status]));
    for (const r of results) console.log(`       ${r.status.padEnd(7)} ${r.title}`);
    report.check(
      results.length >= expectedTitles.length && results.every((r) => r.status === "passed"),
      `${String(results.length)} ${tag} tests ran and every one passed (none skipped)`,
      results
        .filter((r) => r.status !== "passed")
        .map((r) => `${r.status}: ${r.title}`)
        .join("\n"),
    );
    for (const title of expectedTitles) {
      report.check(
        byTitle.get(title) === "passed",
        `passed: ${title}`,
        `status ${String(byTitle.get(title))}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const COMBOS = ["phone light", "phone dark", "desktop light", "desktop dark"];

// ---------------------------------------------------------------------------------------------
// G1
// ---------------------------------------------------------------------------------------------

async function gateG1() {
  const report = new Report("leaf-1.4.2 G1");
  const loaded = await buildTokens(report);
  if (loaded === undefined) return report.finish();
  const { tokens, contrastModule } = loaded;
  const { colors, COLOR_TOKENS } = tokens;
  const { TEXT_PAIRS, AVATAR_PAIRS, contrastRatio } = contrastModule;

  // Structure and UX-5 values.
  const structure = paletteProblems(colors);
  report.check(
    structure.length === 0,
    `light and dark define the same ${String(COLOR_TOKENS.length)} tokens, UX-5 values kept`,
    structure.join("\n"),
  );

  // Every declared pair, both themes, computed from the token values.
  report.check(
    TEXT_PAIRS.length >= 40,
    `declared text/background pairs: ${String(TEXT_PAIRS.length)}`,
  );
  for (const theme of ["light", "dark"]) {
    const failures = pairFailures(TEXT_PAIRS, colors[theme], theme);
    const lowest = (kinds) =>
      Math.min(
        ...TEXT_PAIRS.filter((p) => kinds.includes(p.kind)).map((p) =>
          contrast(colors[theme][p.fg], colors[theme][p.bg]),
        ),
      ).toFixed(2);
    report.check(
      failures.length === 0,
      `${theme}: all ${String(TEXT_PAIRS.length)} declared pairs meet AA (lowest text ${lowest(["normal", "large"])}:1, lowest non-text ${lowest(["nonText"])}:1)`,
      failures.join("\n"),
    );
    const disagreements = TEXT_PAIRS.filter(
      (p) =>
        Math.abs(
          contrastRatio(colors[theme][p.fg], colors[theme][p.bg]) -
            contrast(colors[theme][p.fg], colors[theme][p.bg]),
        ) > 0.01,
    );
    report.check(
      disagreements.length === 0,
      `${theme}: package contrast agrees with the independent implementation`,
      JSON.stringify(disagreements),
    );
  }
  const avatarFailures = AVATAR_PAIRS.filter((p) => contrast(p.fg, p.bg) < THRESHOLD.normal);
  report.check(
    avatarFailures.length === 0,
    `all ${String(AVATAR_PAIRS.length)} avatar colours carry their initial at AA`,
    JSON.stringify(avatarFailures),
  );

  // Every member.color the F1–F3 fixtures store (leaf 1.1.2) is an avatar colour.
  const fixtureDir = join(ROOT, "packages/core/test/fixtures");
  const fixtureColours = existsSync(fixtureDir) ? storedMemberColours(fixtureDir) : [];
  const unknownColours = fixtureColours.filter((c) => !tokens.AVATAR_COLORS.includes(c));
  report.check(
    fixtureColours.length > 0 && unknownColours.length === 0,
    `every member colour in the F1–F3 fixtures (${[...new Set(fixtureColours)].join(", ")}) is an avatar colour`,
    unknownColours.join(", "),
  );
  const badFixtures = mkdtempSync(join(tmpdir(), "leaf-1.4.2-fixtures-"));
  try {
    writeFileSync(
      join(badFixtures, "f9.ts"),
      'export const m = [{ color: "sea" }, { color: "teal" }];\n',
    );
    const scanned = storedMemberColours(badFixtures);
    report.check(
      scanned.includes("teal") && scanned.some((c) => !tokens.AVATAR_COLORS.includes(c)),
      "negative control: a fixture member colour outside the palette is detected",
    );
  } finally {
    rmSync(badFixtures, { recursive: true, force: true });
  }

  // Tokens reach the web app, and components colour only through tokens.
  const css = readFileSync(join(WEB, "app/globals.css"), "utf8");
  const unmapped = unmappedTokens(COLOR_TOKENS, css);
  report.check(
    unmapped.length === 0,
    "every colour token is a Tailwind colour in globals.css",
    unmapped.join(", "),
  );
  report.check(
    /--color-\*:\s*initial;/.test(css),
    "Tailwind's default palette is removed (only token colours exist)",
  );
  const sources = [
    ...walk(join(WEB, "components/ui"), (p) => /\.(tsx?|css)$/.test(p)),
    ...walk(join(WEB, "app"), (p) => /\.(tsx?|css)$/.test(p)),
  ];
  const raw = rawColours(sources);
  report.check(
    raw.length === 0,
    `no raw hex colours in ${String(sources.length)} component, shell and CSS files`,
    raw.join("\n"),
  );
  const tokenSrc = ["tokens", "css", "contrast"]
    .map((d) => readFileSync(join(TOKENS_PKG, "src", d, "index.ts"), "utf8"))
    .join("\n");
  report.check(
    !/from "react|from "react-dom|\bdocument\.|\bwindow\./.test(tokenSrc),
    "ui-tokens has no React or DOM dependency (usable from React Native)",
  );

  // The package's own unit tests.
  const unit = run("pnpm", ["--filter", "@mealplanner/ui-tokens", "test:unit"], { cwd: ROOT });
  report.check(
    unit.code === 0 && /Tests\s+\d+ passed/.test(unit.stdout),
    "ui-tokens unit tests pass",
    tail(unit),
  );

  // Negative controls for the static checks.
  const weakLight = { ...colors.light, inkMuted: "#A89A88" };
  const weak = pairFailures(TEXT_PAIRS, weakLight, "light");
  report.check(
    weak.some((f) => f.includes("inkMuted")),
    `negative control: ink-muted #A89A88 fails AA (${String(weak.length)} failing pairs)`,
  );
  const darkMissing = { ...colors.dark };
  delete darkMissing.paper;
  report.check(
    paletteProblems({ light: colors.light, dark: darkMissing }).length > 0,
    "negative control: a dark palette missing a key is rejected",
  );
  report.check(
    paletteProblems({ ...colors, light: { ...colors.light, tomato: "#E4572F" } }).length > 0,
    "negative control: a changed UX-5 value is rejected",
  );
  const brokenCss = css.replace("--color-ink-muted: var(--ink-muted);", "");
  report.check(
    unmappedTokens(COLOR_TOKENS, brokenCss).includes("inkMuted"),
    "negative control: an unmapped token is detected",
  );
  report.check(
    rawColours([join(ROOT, "scripts/verify/leaf-1.4.2.mjs")]).length > 0,
    "negative control: raw hex colours are detected in a file that has them",
  );

  // Rendered pairs in the browser (includes its own negative controls).
  if (buildWeb(report, "G1")) {
    await runE2E(report, "G1", [
      ...COMBOS.map((c) => `@G1 /offline ${c}: every text pair is AA and declared`),
      ...COMBOS.map((c) => `@G1 shells and primitives ${c}: every text pair is AA and declared`),
      "@G1 negative control: an injected low-contrast element fails the audit",
      "@G1 negative control: an AA-passing but undeclared pair fails the audit",
      "@G1 negative control: text over a gradient is reported",
      "@G1 negative control: emoji in the UI is detected",
    ]);
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G2
// ---------------------------------------------------------------------------------------------

const REQUIRED_MANIFEST = ["name", "short_name", "start_url", "display", "icons"];

function manifestProblems(manifest, iconSize) {
  const problems = [];
  for (const field of REQUIRED_MANIFEST) {
    if (manifest[field] === undefined) problems.push(`missing ${field}`);
  }
  if (!["standalone", "fullscreen", "minimal-ui"].includes(manifest.display))
    problems.push(`display ${manifest.display}`);
  const icons = manifest.icons ?? [];
  const png = icons.filter((i) => i.type === "image/png");
  if (!png.some((i) => i.sizes === "192x192")) problems.push("no 192x192 PNG icon");
  if (!png.some((i) => i.sizes === "512x512" && (i.purpose ?? "any").includes("any")))
    problems.push("no 512x512 PNG icon");
  if (!png.some((i) => (i.purpose ?? "").includes("maskable"))) problems.push("no maskable icon");
  for (const icon of png) {
    const size = iconSize(icon.src);
    if (size !== icon.sizes) problems.push(`${icon.src} is ${size}, declared ${icon.sizes}`);
  }
  return problems;
}

function pngSizeOf(src) {
  const path = join(WEB, "public", src.replace(/^\//, ""));
  if (!existsSync(path)) return "missing";
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 1, 4) !== "PNG") return "not a PNG";
  return `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
}

async function gateG2() {
  const report = new Report("leaf-1.4.2 G2");

  const manifest = JSON.parse(readFileSync(join(WEB, "public/manifest.webmanifest"), "utf8"));
  const problems = manifestProblems(manifest, pngSizeOf);
  report.check(
    problems.length === 0,
    "manifest has the installability fields and correctly sized icons",
    problems.join("\n"),
  );
  const layout = readFileSync(join(WEB, "app/layout.tsx"), "utf8");
  report.check(
    layout.includes('manifest: "/manifest.webmanifest"'),
    "root layout links the manifest",
  );
  const sw = join(WEB, "public/sw.js");
  const swCheck = run(process.execPath, ["--check", sw], { cwd: ROOT });
  const swText = readFileSync(sw, "utf8");
  report.check(swCheck.code === 0, "public/sw.js parses", tail(swCheck));
  report.check(
    swText.includes('"/today", "/kitchen"') &&
      swText.includes("mise:clear-offline-cache") &&
      swText.includes('"/offline"'),
    "service worker keeps /today and /kitchen for offline read, precaches /offline, clears on sign-out",
  );

  // Negative controls for the file checks.
  const noIcons = { ...manifest };
  delete noIcons.icons;
  report.check(
    manifestProblems(noIcons, pngSizeOf).length > 0,
    "negative control: a manifest without icons is rejected",
  );
  report.check(
    manifestProblems(manifest, (src) => (src.includes("192") ? "180x180" : pngSizeOf(src))).length >
      0,
    "negative control: an icon whose pixels do not match its declared size is rejected",
  );
  const noStart = { ...manifest };
  delete noStart.start_url;
  report.check(
    manifestProblems(noStart, pngSizeOf).includes("missing start_url"),
    "negative control: a manifest without start_url is rejected",
  );

  const loaded = await buildTokens(report);
  if (loaded !== undefined && buildWeb(report, "G2")) {
    await runE2E(report, "G2", [
      ...COMBOS.map((c) => `@G2 /offline ${c}: no horizontal scroll, correct navigation`),
      ...COMBOS.map((c) => `@G2 role shells ${c}: no horizontal scroll, targets ≥ 44 px`),
      "@G2 navigation per role (UX-3, R-21)",
      "@G2 rating input is a keyboard-operable radio group",
      "@G2 primitives render their data without JavaScript (rings, bars, stars)",
      "@G2 avatar: the stored member colour overrides the id hash",
      "@G2 installable: no installability errors, worker controls the page, icons match",
      "@G2 offline: Today is kept for offline reading, other pages fall back, sign-out clears",
      "@G2 negative control: a forced 1600 px element is caught as horizontal scroll",
      "@G2 negative control: a 30 px link is caught as a small target",
      "@G2 negative control: a manifest without icons is not installable",
    ]);
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
const GATES = { G1: gateG1, G2: gateG2 };
const gateIndex = process.argv.indexOf("--gate");
const gate = gateIndex === -1 ? undefined : process.argv[gateIndex + 1];
const runGate = gate === undefined ? undefined : GATES[gate];
if (runGate === undefined) {
  console.log(`usage: node scripts/verify/leaf-1.4.2.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
process.exitCode = await runGate();
