// Leaf 1.4.2: design system, app shell, PWA.
//   @G1  rendered text/background pairs meet AA and are declared token pairs (UX-5)
//   @G2  the shell at 390 and 1280 px without horizontal scroll; navigation per role; PWA
//        installability and offline fallback (UX-3, UX-6, ARC-8)
//   @G3  screenshots for the architect's visual review (not a pass/fail gate)
// Each gate has negative controls: the same check run on a known-bad page must fail.
//
// Only /offline is a route of this leaf. The other shell variants and every primitive are
// server-rendered here with react-dom/server and shown under the app's real built CSS.
import { AA_THRESHOLD, AVATAR_PAIRS, TEXT_PAIRS, parseHex } from "@mealplanner/ui-tokens/contrast";
import {
  AVATAR_COLORS,
  COLOR_TOKENS,
  avatarPalette,
  fallbackAvatarColor,
  FIT_STATUSES,
  TONES,
  colors,
  layout,
  type ColorToken,
  type Theme,
} from "@mealplanner/ui-tokens/tokens";
import {
  chromium,
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createElement,
  type ComponentType,
  type Key,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog as RadixDialog } from "radix-ui";
import { ROUTES, homePathFor, railFor, tabsFor, type Role } from "../app/(shell)/_shell/nav";
import { clearOfflineCache } from "../app/(shell)/_shell/offline-cache";
import type { ShellViewer } from "../app/(shell)/_shell/viewer";
import type { IconName } from "../components/ui/icon";

// Playwright loads this spec as native ESM and compiles JSX in imported .tsx files against its
// own component-testing runtime. To server-render the real components, an in-thread resolve
// hook (Node 22 module.registerHooks):
// - sends the JSX runtime back to React's;
// - replaces `next/link` (CommonJS without an `exports` map, which Node's ESM loader cannot
//   import by bare name) with a module that renders what Next's Link renders as static markup,
//   a plain <a href> (checked with react-dom/server).
// The components are imported after the hook is registered.
(globalThis as { __miseCreateElement?: typeof createElement }).__miseCreateElement = createElement;
const linkShim = `
const createElement = globalThis.__miseCreateElement;
export default function Link({ href, prefetch, replace, scroll, shallow, locale, ...rest }) {
  return createElement("a", { href: String(href), ...rest });
}`;
const linkShimUrl = `data:text/javascript,${encodeURIComponent(linkShim)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link")
      return { url: linkShimUrl, format: "module", shortCircuit: true };
    if (/[\\/]playwright[\\/]jsx-(dev-)?runtime(\.js)?$/.test(specifier)) {
      return nextResolve("react/jsx-runtime", context);
    }
    return nextResolve(specifier, context);
  },
});

const { AppShellFrame } = await import("../app/(shell)/_shell/app-shell");
const { Rail } = await import("../app/(shell)/_shell/rail");
const { TabBar } = await import("../app/(shell)/_shell/tab-bar");
const {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ICON_PATHS,
  Icon,
  LinkButton,
  MacroBar,
  MacroRing,
  SegmentedControl,
  SheetPanel,
  SkeletonBlock,
  StarRatingDisplay,
  StarRatingInput,
} = await import("../components/ui/index");

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKUPS = resolve(HERE, "../../../docs/mockups");

// createElement with children as arguments; every other prop is still type-checked.
const createLoose = createElement as unknown as (
  type: unknown,
  props: unknown,
  ...children: ReactNode[]
) => ReactElement;
function h(
  type: string,
  props: Record<string, unknown> | null,
  ...children: ReactNode[]
): ReactElement;
function h<P extends object>(
  type: ComponentType<P>,
  props: (Omit<P, "children"> & { key?: Key }) | null,
  ...children: ReactNode[]
): ReactElement;
function h(type: unknown, props: unknown, ...children: ReactNode[]): ReactElement {
  return createLoose(type, props, ...children);
}

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;
const SCHEMES: readonly Theme[] = ["light", "dark"];

// ---------------------------------------------------------------------------------------------
// Fixtures: shell viewers and a page of every primitive
// ---------------------------------------------------------------------------------------------

const VIEWERS: Record<Role, ShellViewer> = {
  admin: {
    name: "Omar",
    role: "admin",
    householdName: "Khalifa City home",
    memberKey: "omar",
    memberColor: "sea",
    pendingProposals: 3,
  },
  member: {
    name: "Sara",
    role: "member",
    householdName: "Khalifa City home",
    memberKey: "sara",
    memberColor: "aubergine",
    pendingProposals: 0,
  },
  kitchen: {
    name: "Priya",
    role: "kitchen",
    householdName: "Khalifa City home",
    memberKey: "priya",
    memberColor: null,
    pendingProposals: 0,
  },
};

interface ShellVariant {
  readonly id: string;
  readonly viewer: ShellViewer | null;
  readonly pathname: string;
}

const SHELL_VARIANTS: readonly ShellVariant[] = [
  { id: "admin", viewer: VIEWERS.admin, pathname: ROUTES.today },
  { id: "member", viewer: VIEWERS.member, pathname: ROUTES.me },
  { id: "kitchen", viewer: VIEWERS.kitchen, pathname: ROUTES.kitchen },
  { id: "signed-out", viewer: null, pathname: ROUTES.offline },
];

function section(title: string, ...children: ReactNode[]): ReactElement {
  return h(
    "section",
    { className: "flex flex-col gap-3" },
    h("h2", { className: "text-xl" }, title),
    ...children,
  );
}

function row(...children: ReactNode[]): ReactElement {
  return h("div", { className: "flex flex-wrap items-center gap-3" }, ...children);
}

/** Every primitive, in the states later screens use. */
function PrimitivesGallery(): ReactElement {
  const noop = (): void => undefined;
  return h(
    "div",
    { className: "flex max-w-4xl flex-col gap-8" },
    h("h1", { className: "text-[32px]" }, "Sunday 27 September"),
    section(
      "Buttons",
      row(
        h(Button, { variant: "primary" }, "Plan tomorrow"),
        h(Button, { variant: "secondary", icon: "refresh" }, "Regenerate"),
        h(Button, { variant: "ghost" }, "Skip"),
        h(Button, { variant: "danger" }, "Remove"),
        h(Button, { variant: "primary", loading: true }, "Planning"),
        h(LinkButton, { href: ROUTES.plan, icon: "arrowRight" }, "Open the week"),
      ),
    ),
    section(
      "Chips",
      row(...TONES.map((tone) => h(Chip, { key: tone, tone }, tone))),
      row(
        h(Chip, { tone: "basil", icon: "check" }, "On target"),
        h(Chip, { tone: "saffron", icon: "approx" }, "Close to target"),
        h(Chip, { tone: "pomegranate", icon: "cross" }, "Off target"),
        h(Chip, { tone: "sea", size: "sm" }, "grilled"),
      ),
    ),
    section(
      "Cards",
      h(
        "div",
        { className: "grid grid-cols-1 gap-3 sm:grid-cols-3" },
        h(
          Card,
          null,
          h("span", { className: "text-xs font-extrabold text-ink-muted" }, "BREAKFAST 07:00"),
          h("p", { className: "m-0 font-extrabold" }, "Shakshuka with labneh"),
          h("span", { className: "text-sm text-ink-soft" }, "438 kcal · P33 C44 F15"),
        ),
        h(
          Card,
          { highlight: true },
          h("span", { className: "text-xs font-extrabold text-action" }, "DINNER 20:30"),
          h("p", { className: "m-0 font-extrabold" }, "Hammour, saffron rice, fattoush"),
        ),
        h(
          Card,
          { ruled: true },
          h("p", { className: "m-0" }, "Rinse the rice until the water runs clear."),
        ),
      ),
    ),
    section(
      "Segmented control",
      h(SegmentedControl, {
        label: "Detail level for targets",
        value: "detailed",
        onValueChange: noop,
        options: [
          { value: "basic", label: "Basic" },
          { value: "detailed", label: "Detailed" },
          { value: "expert", label: "Expert" },
        ],
      }),
    ),
    section(
      "Avatars and macro rings",
      row(
        h(Avatar, { name: "Omar", color: "sea", colorKey: "omar", labelled: true }),
        h(Avatar, { name: "Sara", color: "aubergine", colorKey: "sara", size: 44, labelled: true }),
        h(Avatar, {
          name: "Layla",
          color: "pomegranate",
          colorKey: "layla",
          size: 30,
          labelled: true,
        }),
        h(Avatar, { name: "Zayd", color: "basil", colorKey: "zayd", size: 56, labelled: true }),
      ),
      row(
        ...FIT_STATUSES.map((fit) =>
          h(
            MacroRing,
            {
              key: fit,
              fit,
              size: 56,
              label: `Sara, ${fit}`,
              ...(fit === "untargeted"
                ? {}
                : { macros: { protein: 43, carbs: 47, fat: 17 }, targetKcal: 523 }),
            },
            h(Avatar, { name: "Sara", color: "aubergine", colorKey: "sara", size: 30 }),
          ),
        ),
        h(
          MacroRing,
          {
            fit: "in_tolerance",
            size: 64,
            label: "Day total 1656 of 1655 kcal",
            macros: { protein: 133, carbs: 155, fat: 55 },
            targetKcal: 1655,
          },
          h("span", { className: "tabular text-xs text-ink" }, "1656"),
        ),
      ),
    ),
    section(
      "Macro bars",
      h(
        Card,
        { className: "flex flex-col gap-3" },
        h(MacroBar, { macro: "protein", actual: 43, target: 41, tolerance: 5 }),
        h(MacroBar, { macro: "carbs", actual: 47, target: 51, tolerance: 5 }),
        h(MacroBar, { macro: "fat", actual: 21, target: 17, tolerance: 2 }),
        h(MacroBar, { macro: "kcal", actual: 523, target: 523, tolerance: 50 }),
      ),
    ),
    section(
      "Star ratings",
      row(
        h(StarRatingDisplay, { value: 4.5, count: 12, showValue: true }),
        h(StarRatingDisplay, { value: 3, size: 20 }),
        h(StarRatingDisplay, { value: 2.3, size: 14 }),
      ),
      h(StarRatingInput, {
        label: "Rating for lunch",
        value: 5,
        onValueChange: noop,
        name: "tiles",
      }),
      h(StarRatingInput, {
        label: "Rating for dinner",
        value: 4,
        onValueChange: noop,
        appearance: "row",
        name: "row",
      }),
    ),
    section(
      "Icons",
      row(
        ...(Object.keys(ICON_PATHS) as IconName[]).map((name) =>
          h(Icon, { key: name, name, label: name }),
        ),
      ),
    ),
    section("Loading", h(SkeletonBlock, { label: "Loading the plan" })),
    h(EmptyState, {
      title: "No plan for tomorrow yet",
      description: "Plan it in one tap, or ask the assistant.",
      action: h(LinkButton, { href: ROUTES.plan }, "Plan it"),
      secondaryAction: h(
        LinkButton,
        { href: ROUTES.chat, variant: "secondary" },
        "Ask the assistant",
      ),
    }),
  );
}

function shellMarkup(variant: ShellVariant, content: ReactElement): string {
  return renderToStaticMarkup(
    h(AppShellFrame, { viewer: variant.viewer, pathname: variant.pathname }, content),
  );
}

function sheetMarkup(): string {
  return renderToStaticMarkup(
    h(
      RadixDialog.Root,
      { open: true },
      h(RadixDialog.Overlay, {
        className: "fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--rail)_55%,transparent)]",
      }),
      h(
        SheetPanel,
        {
          title: "Rate lunch",
          description: "Chicken shawarma bowl · today",
          desktop: "center",
          footer: h(Button, null, "Send"),
        },
        h(StarRatingInput, { label: "Rating", value: 4, onValueChange: () => undefined }),
        h("p", { className: "m-0 text-sm font-extrabold text-ink-muted" }, "Anything else?"),
        row(h(Chip, null, "Too much"), h(Chip, { tone: "basil", icon: "check" }, "Loved it")),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------------------------

let headCache: string | undefined;

/** The built app's <head> (stylesheets, fonts, token CSS) without scripts. */
async function appHead(request: APIRequestContext): Promise<string> {
  if (headCache !== undefined) return headCache;
  const html = await (await request.get(ROUTES.offline)).text();
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1];
  if (head === undefined) throw new Error("no <head> in /offline");
  headCache = head
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]*rel="preload"[^>]*as="script"[^>]*>/g, "");
  return headCache;
}

/** Shows server-rendered markup under the app's CSS, on the app's origin. */
async function showMarkup(page: Page, request: APIRequestContext, body: string): Promise<void> {
  const head = await appHead(request);
  await page.goto(ROUTES.offline);
  await page.setContent(
    `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`,
    {
      waitUntil: "load",
    },
  );
  await page.evaluate(() => document.fonts.ready);
}

async function setup(page: Page, width: number, height: number, scheme: Theme): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
}

// ---------------------------------------------------------------------------------------------
// G1: rendered contrast audit
// ---------------------------------------------------------------------------------------------

interface RenderedPair {
  readonly text: string;
  readonly fg: [number, number, number];
  readonly bg: [number, number, number];
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly gradient: boolean;
}

/** Every visible text run's colour and effective background, read from the browser. */
async function renderedPairs(page: Page): Promise<RenderedPair[]> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    function parse(value: string): RGBA | null {
      const rgb = /rgba?\(([^)]+)\)/.exec(value);
      if (rgb?.[1] !== undefined) {
        const parts = rgb[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
      }
      const srgb = /color\(srgb ([^)]+)\)/.exec(value);
      if (srgb?.[1] !== undefined) {
        const parts = srgb[1]
          .split(/[\s/]+/)
          .filter(Boolean)
          .map(Number);
        return [(parts[0] ?? 0) * 255, (parts[1] ?? 0) * 255, (parts[2] ?? 0) * 255, parts[3] ?? 1];
      }
      return null;
    }
    function over(top: RGBA, under: RGBA): RGBA {
      const a = top[3];
      return [
        top[0] * a + under[0] * (1 - a),
        top[1] * a + under[1] * (1 - a),
        top[2] * a + under[2] * (1 - a),
        1,
      ];
    }
    function visible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number(style.opacity) === 0) return false;
        if (style.clipPath === "inset(50%)") return false;
        if (node.closest("[disabled],[aria-disabled='true']") !== null) return false;
      }
      return true;
    }
    function background(el: Element): { color: RGBA; gradient: boolean } {
      const layers: RGBA[] = [];
      let gradient = false;
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        // The ruled-paper lines are 1 px decoration under text; any other image or gradient
        // behind text cannot be checked from colours alone and is reported.
        if (style.backgroundImage !== "none" && !node.classList.contains("ruled")) gradient = true;
        const c = parse(style.backgroundColor);
        if (c !== null && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
      }
      let result: RGBA = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const layer = layers[i];
        if (layer !== undefined) result = over(layer, result);
      }
      return { color: result, gradient };
    }
    const out: {
      text: string;
      fg: [number, number, number];
      bg: [number, number, number];
      fontSize: number;
      fontWeight: number;
      gradient: boolean;
    }[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (el.closest("svg") !== null) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (own === "" || !visible(el)) continue;
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      if (fg === null) continue;
      const bg = background(el);
      const fgFlat = over(fg, bg.color);
      out.push({
        text: own.slice(0, 40),
        fg: [Math.round(fgFlat[0]), Math.round(fgFlat[1]), Math.round(fgFlat[2])],
        bg: [Math.round(bg.color[0]), Math.round(bg.color[1]), Math.round(bg.color[2])],
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight),
        gradient: bg.gradient,
      });
    }
    return out;
  });
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function lum([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratio(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const key = (rgb: readonly number[]): string => rgb.join(",");

/** Token names per rgb value in one theme. */
function tokensByRgb(theme: Theme): Map<string, ColorToken[]> {
  const map = new Map<string, ColorToken[]>();
  for (const token of COLOR_TOKENS) {
    const k = key(parseHex(colors[theme][token]));
    map.set(k, [...(map.get(k) ?? []), token]);
  }
  return map;
}

export interface AuditProblem {
  readonly text: string;
  readonly problem: string;
}

/** AA for the rendered size, and the pair must be declared in TEXT_PAIRS or AVATAR_PAIRS. */
export function auditPairs(pairs: readonly RenderedPair[], theme: Theme): AuditProblem[] {
  const byRgb = tokensByRgb(theme);
  const declared = new Set(TEXT_PAIRS.map((p) => `${p.fg}/${p.bg}`));
  const avatars = new Set(AVATAR_PAIRS.map((p) => `${key(parseHex(p.fg))}/${key(parseHex(p.bg))}`));
  const problems: AuditProblem[] = [];
  for (const p of pairs) {
    const large = p.fontSize >= 24 || (p.fontSize >= 18.66 && p.fontWeight >= 700);
    const need = large ? AA_THRESHOLD.large : AA_THRESHOLD.normal;
    if (p.gradient) {
      problems.push({ text: p.text, problem: "text over an image or gradient background" });
      continue;
    }
    const r = ratio(p.fg, p.bg);
    if (r < need) {
      problems.push({
        text: p.text,
        problem: `contrast ${r.toFixed(2)} < ${String(need)} (fg ${key(p.fg)} on ${key(p.bg)})`,
      });
      continue;
    }
    const fgNames = byRgb.get(key(p.fg)) ?? [];
    const bgNames = byRgb.get(key(p.bg)) ?? [];
    const isDeclared =
      avatars.has(`${key(p.fg)}/${key(p.bg)}`) ||
      fgNames.some((f) => bgNames.some((b) => declared.has(`${f}/${b}`)));
    if (!isDeclared) {
      problems.push({
        text: p.text,
        problem: `undeclared pair fg ${key(p.fg)} [${fgNames.join("|") || "no token"}] on bg ${key(p.bg)} [${bgNames.join("|") || "no token"}]`,
      });
    }
  }
  return problems;
}

const EMOJI = /\p{Extended_Pictographic}/u;

async function expectCleanAudit(page: Page, theme: Theme, label: string): Promise<number> {
  const pairs = await renderedPairs(page);
  expect(pairs.length, `${label}: text found`).toBeGreaterThan(0);
  const problems = auditPairs(pairs, theme);
  expect(problems, `${label}: ${JSON.stringify(problems, null, 1)}`).toEqual([]);
  const text = await page.evaluate(() => document.body.innerText);
  expect(EMOJI.test(text), `${label}: no emoji in the UI (R2-UX-5)`).toBe(false);
  return pairs.length;
}

test.describe("@G1 rendered contrast", () => {
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      test(`@G1 /offline ${vp.name} ${scheme}: every text pair is AA and declared`, async ({
        page,
      }) => {
        await setup(page, vp.width, vp.height, scheme);
        await page.goto(ROUTES.offline);
        await page.evaluate(() => document.fonts.ready);
        await expectCleanAudit(page, scheme, `/offline ${vp.name} ${scheme}`);
      });

      test(`@G1 shells and primitives ${vp.name} ${scheme}: every text pair is AA and declared`, async ({
        page,
        request,
      }) => {
        await setup(page, vp.width, vp.height, scheme);
        for (const variant of SHELL_VARIANTS) {
          await showMarkup(page, request, shellMarkup(variant, PrimitivesGallery()));
          await expectCleanAudit(page, scheme, `${variant.id} ${vp.name} ${scheme}`);
        }
        await showMarkup(page, request, sheetMarkup());
        await expectCleanAudit(page, scheme, `sheet ${vp.name} ${scheme}`);
      });
    }
  }

  test("@G1 negative control: an injected low-contrast element fails the audit", async ({
    page,
  }) => {
    await setup(page, 1280, 800, "light");
    await page.goto(ROUTES.offline);
    await page.evaluate(() => {
      const bad = document.createElement("p");
      bad.textContent = "Faint text";
      bad.style.cssText = "color:#B8A791;background:#FFF8EE;font-size:15px;margin:0";
      document.querySelector("main")?.append(bad);
    });
    const problems = auditPairs(await renderedPairs(page), "light");
    expect(problems.map((p) => p.text)).toContain("Faint text");
  });

  test("@G1 negative control: an AA-passing but undeclared pair fails the audit", async ({
    page,
  }) => {
    await setup(page, 1280, 800, "light");
    await page.goto(ROUTES.offline);
    await page.evaluate(() => {
      const bad = document.createElement("p");
      bad.textContent = "Off-palette text";
      bad.style.cssText = "color:#000000;background:#FFFFFF;font-size:15px;margin:0";
      document.querySelector("main")?.append(bad);
    });
    const problems = auditPairs(await renderedPairs(page), "light");
    expect(problems.find((p) => p.text === "Off-palette text")?.problem).toMatch(/undeclared/);
  });

  test("@G1 negative control: text over a gradient is reported", async ({ page }) => {
    await setup(page, 1280, 800, "light");
    await page.goto(ROUTES.offline);
    await page.evaluate(() => {
      const bad = document.createElement("p");
      bad.textContent = "Text on a gradient";
      bad.style.cssText = "color:#2B2118;background:linear-gradient(#FFF8EE,#E4572E);margin:0";
      document.querySelector("main")?.append(bad);
    });
    const problems = auditPairs(await renderedPairs(page), "light");
    expect(problems.find((p) => p.text === "Text on a gradient")?.problem).toMatch(/gradient/);
  });

  test("@G1 negative control: emoji in the UI is detected", () => {
    expect(EMOJI.test("Rate it 😋")).toBe(true);
    expect(EMOJI.test("Rate it 5 of 5")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// G2: layout, navigation, accessibility basics, installability, offline
// ---------------------------------------------------------------------------------------------

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth;
  });
}

async function isShown(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible();
}

/** Interactive elements smaller than 44 × 44 px (UX-6), ignoring hidden ones. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const out: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll("a[href], button, [role='radio'], label.star-tile"),
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || el.classList.contains("sr-only-focusable")) continue;
      if (el.closest("[aria-hidden='true']") !== null) continue;
      if (rect.width < min - 0.5 || rect.height < min - 0.5) {
        out.push(
          `${el.tagName} "${el.textContent.trim().slice(0, 30)}" ${rect.width.toFixed(0)}×${rect.height.toFixed(0)}`,
        );
      }
    }
    return out;
  }, layout.minTarget);
}

test.describe("@G2 shell layout", () => {
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      test(`@G2 /offline ${vp.name} ${scheme}: no horizontal scroll, correct navigation`, async ({
        page,
      }) => {
        const external: string[] = [];
        page.on("request", (req) => {
          const url = new URL(req.url());
          if (url.hostname !== "localhost") external.push(req.url());
        });
        await setup(page, vp.width, vp.height, scheme);
        await page.goto(ROUTES.offline);
        await page.evaluate(() => document.fonts.ready);

        expect(await horizontalOverflow(page), "horizontal overflow in px").toBeLessThanOrEqual(0);
        const desktop = vp.width >= layout.desktopMinWidth;
        expect(await isShown(page, "nav[aria-label='Main']")).toBe(desktop);
        expect(await isShown(page, "nav[aria-label='Tabs']")).toBe(!desktop);
        await expect(page.locator("main#main")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
        expect(await smallTargets(page)).toEqual([]);
        expect(external, "no request leaves the origin (self-hosted fonts)").toEqual([]);

        // Fonts: self-hosted Fraunces (display), Nunito (body) are loaded and applied.
        const fonts = await page.evaluate(() => ({
          body: getComputedStyle(document.body).fontFamily,
          h1: getComputedStyle(document.querySelector("h1") ?? document.body).fontFamily,
          nunito: document.fonts.check("15px Nunito"),
          fraunces: document.fonts.check("32px 'Fraunces Variable'"),
        }));
        expect(fonts.body).toMatch(/^Nunito/);
        expect(fonts.h1).toMatch(/^"?Fraunces Variable/);
        expect(fonts.nunito && fonts.fraunces).toBe(true);
      });
    }
  }

  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      test(`@G2 role shells ${vp.name} ${scheme}: no horizontal scroll, targets ≥ 44 px`, async ({
        page,
        request,
      }) => {
        await setup(page, vp.width, vp.height, scheme);
        for (const variant of SHELL_VARIANTS) {
          await showMarkup(page, request, shellMarkup(variant, PrimitivesGallery()));
          expect(await horizontalOverflow(page), `${variant.id}: overflow`).toBeLessThanOrEqual(0);
          expect(await smallTargets(page), `${variant.id}: small targets`).toEqual([]);
        }
      });
    }
  }

  test("@G2 navigation per role (UX-3, R-21)", async ({ page, request }) => {
    expect(railFor("admin").map((i) => i.label)).toEqual([
      "Today",
      "Plan",
      "Recipes",
      "Kitchen",
      "Reviews",
      "Insights",
      "Family",
      "Settings",
      "People & access",
    ]);
    expect(railFor("member").map((i) => i.label)).toEqual([
      "Today",
      "Plan",
      "Recipes",
      "Reviews",
      "My tastes",
    ]);
    expect(railFor("kitchen").map((i) => i.label)).toEqual(["Kitchen", "Plan", "Recipes"]);
    expect(railFor(null)).toEqual(railFor("member"));
    expect(tabsFor("admin").map((i) => i.label)).toEqual([
      "Today",
      "Plan",
      "Recipes",
      "Reviews",
      "Me",
    ]);
    expect(tabsFor("member").at(-1)?.href).toBe("/family/me");
    expect(homePathFor("kitchen")).toBe("/kitchen");
    expect(homePathFor("admin")).toBe("/today");

    for (const vp of VIEWPORTS) {
      await setup(page, vp.width, vp.height, "light");
      const desktop = vp.width >= layout.desktopMinWidth;
      for (const variant of SHELL_VARIANTS) {
        await showMarkup(page, request, shellMarkup(variant, h("p", null, "Content")));
        const nav = page.locator(desktop ? "nav[aria-label='Main']" : "nav[aria-label='Tabs']");
        const expected = (desktop ? railFor : tabsFor)(variant.viewer?.role ?? null);
        await expect(nav.locator("ul > li > a")).toHaveText(expected.map((i) => i.label));
        const current = nav.locator("a[aria-current='page']");
        await expect(current, `${variant.id}: one current item`).toHaveCount(
          variant.viewer === null ? 0 : 1,
        );
        const admin = variant.viewer?.role === "admin";
        const assistant = desktop
          ? page.locator("nav[aria-label='Main'] a[href='/chat']")
          : page.getByRole("link", { name: /Open assistant/ });
        await expect(assistant).toHaveCount(admin ? 1 : 0);
        if (admin) {
          await expect(assistant).toHaveAccessibleName(/assistant.*3 pending proposals/i);
        }
        if (desktop) {
          await expect(page.locator("nav[aria-label='Main'] a[href='/account']")).toHaveCount(
            variant.viewer === null ? 0 : 1,
          );
        }
      }
    }
  });

  test("@G2 rating input is a keyboard-operable radio group", async ({ page, request }) => {
    await setup(page, 390, 844, "light");
    await showMarkup(
      page,
      request,
      renderToStaticMarkup(
        h(StarRatingInput, {
          label: "Rating",
          value: 3,
          onValueChange: () => undefined,
          name: "k",
        }),
      ),
    );
    const group = page.getByRole("radiogroup", { name: "Rating" });
    await expect(group.getByRole("radio")).toHaveCount(5);
    await expect(group.getByRole("radio", { name: "3 of 5" })).toBeChecked();
    await group.getByRole("radio", { name: "3 of 5" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "4 of 5" })).toBeChecked();
    await expect(group.getByRole("radio", { name: "4 of 5" })).toBeFocused();
    expect(await smallTargets(page)).toEqual([]);
  });

  test("@G2 primitives render their data without JavaScript (rings, bars, stars)", async ({
    page,
    request,
  }) => {
    await setup(page, 390, 844, "light");
    await showMarkup(
      page,
      request,
      renderToStaticMarkup(
        h(
          "div",
          null,
          h(MacroRing, {
            fit: "flexible_miss",
            label: "Sara, 1600 of 1655 kcal",
            macros: { protein: 130, carbs: 150, fat: 55 },
            targetKcal: 1655,
          }),
          h(MacroBar, { macro: "fat", actual: 21, target: 17, tolerance: 2 }),
          h(StarRatingDisplay, { value: 4.3, count: 12 }),
        ),
      ),
    );
    const arcs = await page
      .locator("circle.ring-arc")
      .evaluateAll((els) =>
        els.map((el) => Number.parseFloat(el.getAttribute("stroke-dasharray") ?? "0")),
      );
    expect(arcs).toHaveLength(3);
    expect(arcs.every((dash) => dash > 0)).toBe(true);
    await expect(
      page.getByRole("img", { name: "Sara, 1600 of 1655 kcal, close to target" }),
    ).toHaveCount(1);
    await expect(page.getByRole("meter", { name: "Fat" })).toHaveAttribute(
      "aria-valuetext",
      "21 g, target 17 g plus or minus 2, 2 g above the target range",
    );
    await expect(page.getByRole("img", { name: "Rated 4.5 out of 5 from 12 reviews" })).toHaveCount(
      1,
    );
  });

  test("@G2 avatar: the stored member colour overrides the id hash", async ({ page, request }) => {
    const key = "member-7";
    const fallback = fallbackAvatarColor(key);
    const stored = AVATAR_COLORS.find((c) => c !== fallback) ?? "sea";
    await setup(page, 390, 844, "light");
    await showMarkup(
      page,
      request,
      renderToStaticMarkup(
        h(
          "div",
          null,
          h(Avatar, { name: "Stored", color: stored, colorKey: key, labelled: true }),
          h(Avatar, { name: "Fallback", colorKey: key, labelled: true }),
          h(Avatar, { name: "Omar", color: "sea", colorKey: "omar", labelled: true }),
        ),
      ),
    );
    const fill = async (name: string) =>
      page.getByRole("img", { name }).evaluate((el) => getComputedStyle(el).backgroundColor);
    const rgbOf = (hex: string) => `rgb(${parseHex(hex).join(", ")})`;
    // Negative control: without a stored colour the hash decides, and it differs from `stored`.
    expect(await fill("Fallback")).toBe(rgbOf(avatarPalette[fallback]));
    expect(await fill("Stored")).toBe(rgbOf(avatarPalette[stored]));
    expect(await fill("Stored")).not.toBe(await fill("Fallback"));
    // The mockups' Omar is teal (#17706F, "sea").
    expect(await fill("Omar")).toBe(rgbOf("#17706F"));
    // The shell's account card uses the viewer's stored colour.
    await setup(page, 1280, 800, "light");
    await showMarkup(
      page,
      request,
      shellMarkup(
        { id: "admin", viewer: VIEWERS.admin, pathname: ROUTES.today },
        h("p", null, "x"),
      ),
    );
    const account = page.locator("nav[aria-label='Main'] a[href='/account'] [data-avatar-color]");
    await expect(account).toHaveAttribute("data-avatar-color", "sea");
  });

  test("@G2 negative control: a forced 1600 px element is caught as horizontal scroll", async ({
    page,
  }) => {
    await setup(page, 390, 844, "light");
    await page.goto(ROUTES.offline);
    await page.evaluate(() => {
      const wide = document.createElement("div");
      wide.style.width = "1600px";
      wide.style.height = "10px";
      document.querySelector("main")?.append(wide);
    });
    expect(await horizontalOverflow(page)).toBeGreaterThan(0);
  });

  test("@G2 negative control: a 30 px link is caught as a small target", async ({ page }) => {
    await setup(page, 390, 844, "light");
    await page.goto(ROUTES.offline);
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "/plan";
      a.textContent = "x";
      a.style.cssText = "display:inline-block;width:30px;height:30px";
      document.querySelector("main")?.append(a);
    });
    expect((await smallTargets(page)).length).toBeGreaterThan(0);
  });
});

// Installability runs in a persistent profile: an incognito context always reports
// "in-incognito" from Page.getInstallabilityErrors.
async function withProfile<T>(
  baseURL: string,
  run: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "mise-pwa-"));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const context = await chromium.launchPersistentContext(dir, {
    baseURL,
    ...(executablePath === undefined ? {} : { executablePath }),
  });
  try {
    return await run(context);
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

interface InstallabilityError {
  errorId: string;
}

async function installability(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: InstallabilityError[];
  };
  const manifest = (await cdp.send("Page.getAppManifest")) as {
    url: string;
    errors: { message: string }[];
    data?: string;
  };
  return { installabilityErrors, manifest };
}

/** Pixel size from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe("@G2 PWA", () => {
  test("@G2 installable: no installability errors, worker controls the page, icons match", async ({
    baseURL,
    request,
  }) => {
    if (baseURL === undefined) throw new Error("baseURL");
    await withProfile(baseURL, async (context) => {
      const page = await context.newPage();
      await page.goto(ROUTES.offline);
      await page.evaluate(async () => navigator.serviceWorker.ready);
      await page.reload();
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

      const { installabilityErrors, manifest } = await installability(context, page);
      expect(installabilityErrors).toEqual([]);
      expect(manifest.errors).toEqual([]);
      expect(manifest.url).toMatch(/\/manifest\.webmanifest$/);

      const data = JSON.parse(manifest.data ?? "{}") as {
        name?: string;
        short_name?: string;
        start_url?: string;
        display?: string;
        icons?: { src: string; sizes: string; type: string; purpose?: string }[];
      };
      expect(data.name).toBe("Mise");
      expect(data.display).toBe("standalone");
      expect(data.start_url).toBe("/");
      const icons = data.icons ?? [];
      expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
      expect(icons.some((i) => i.sizes === "512x512" && (i.purpose ?? "any") === "any")).toBe(true);
      expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
      for (const icon of icons.filter((i) => i.type === "image/png")) {
        const response = await request.get(icon.src);
        expect(response.ok(), icon.src).toBe(true);
        const { width, height } = pngSize(await response.body());
        expect(`${String(width)}x${String(height)}`, icon.src).toBe(icon.sizes);
      }
    });
  });

  // Offline is simulated by aborting every request at the context: Playwright applies context
  // routes to service-worker fetches in Chromium, whereas setOffline() is not reliably applied
  // to a restarted service-worker target (measured: the second offline navigation reached the
  // server).
  test("@G2 offline: Today is kept for offline reading, other pages fall back, sign-out clears", async ({
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("baseURL");
    await withProfile(baseURL, async (context) => {
      const page = await context.newPage();
      await page.goto(ROUTES.offline);
      await page.evaluate(async () => navigator.serviceWorker.ready);
      await page.reload();

      // Online: a Today page (1.4.4 does not exist yet, so the test serves one).
      const todayHtml =
        '<!doctype html><html lang="en"><body><h1>Today: shakshuka, shawarma bowl, hammour</h1></body></html>';
      await context.route("**/today", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: todayHtml }),
      );
      await page.goto(ROUTES.today);
      await context.unrouteAll();

      // Offline.
      await context.route("**/*", (route) => route.abort("internetdisconnected"));
      await page.goto(ROUTES.today);
      await expect(
        page.getByRole("heading", { level: 1, name: /^Today: shakshuka/ }),
      ).toBeVisible();
      await page.goto(ROUTES.plan);
      await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();

      // Sign-out (1.4.6) posts the clear message; the kept Today plan is gone afterwards.
      await page.evaluate(clearOfflineCache);
      const kept = await page.evaluate(async () => {
        const pages = (await caches.keys()).filter((k) => k.startsWith("mise-pages-"));
        return pages.length;
      });
      expect(kept).toBe(0);
      await page.goto(ROUTES.today);
      await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
      await expect(page.getByText("Today: shakshuka")).toHaveCount(0);
      await context.unrouteAll();
    });
  });

  test("@G2 negative control: a manifest without icons is not installable", async ({ baseURL }) => {
    if (baseURL === undefined) throw new Error("baseURL");
    await withProfile(baseURL, async (context) => {
      await context.route("**/manifest.webmanifest", (route) =>
        route.fulfill({
          contentType: "application/manifest+json",
          body: JSON.stringify({
            name: "Mise",
            short_name: "Mise",
            start_url: "/",
            display: "standalone",
            icons: [],
          }),
        }),
      );
      const page = await context.newPage();
      await page.goto(ROUTES.offline);
      const { installabilityErrors } = await installability(context, page);
      expect(installabilityErrors.map((e) => e.errorId)).toContain(
        "manifest-missing-suitable-icon",
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
// G3 material: screenshots (written to SHELL_SCREENSHOT_DIR; not a pass/fail gate)
// ---------------------------------------------------------------------------------------------

/** Expands a mockup component (Rail/TabBar .dc.html) into static HTML with its own script. */
function mockupMarkup(file: string, active: string): string {
  const html = readFileSync(join(MOCKUPS, file), "utf8");
  const script = /class Component extends DCLogic \{([\s\S]*?)\n\}\n<\/script>/.exec(html)?.[1];
  const body = /<x-dc>[\s\S]*?<\/helmet>([\s\S]*?)<\/x-dc>/.exec(html)?.[1];
  if (script === undefined || body === undefined) throw new Error(`cannot read ${file}`);
  // The mockup's own render function, run on its own data (docs/mockups are the reference).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const defineComponent = new Function(
    "DCLogic",
    `return class Component extends DCLogic {${script}\n}`,
  ) as (base: unknown) => new () => { renderVals(): { items: Record<string, string>[] } };
  const Component = defineComponent(
    class {
      props: Record<string, string>;
      constructor() {
        this.props = { active };
      }
    },
  );
  const { items } = new Component().renderVals();
  return body
    .replace(
      /<sc-for list="\{\{items\}\}" as="item"[^>]*>([\s\S]*?)<\/sc-for>/,
      (_m, tpl: string) =>
        items
          .map((item) => tpl.replace(/\{\{item\.(\w+)\}\}/g, (_x, k: string) => item[k] ?? ""))
          .join(""),
    )
    .replaceAll("Fraunces, serif", "'Fraunces Variable', serif");
}

/** Mockup colours changed for AA (deviations 1–3 and the star outline), side by side. */
function deviationMarkup(): string {
  const swatch = (fg: string, bg: string, text: string) =>
    `<div style="display:flex;align-items:center;gap:10px"><span style="display:inline-flex;align-items:center;justify-content:center;min-width:220px;height:48px;border-radius:12px;background:${bg};color:${fg};font-weight:800;font-size:13px;padding:0 12px">${text}</span><span class="tabular" style="font-size:13px;color:var(--ink)">${fg} on ${bg}: ${ratio(parseHex(fg), parseHex(bg)).toFixed(2)}:1</span></div>`;
  const rows: [string, [string, string], [string, string], string][] = [
    ["Active tab label", ["#C4411E", "#FDE3D8"], ["#A3351A", "#FDE3D8"], "Today"],
    [
      "Basil text on basil tint",
      ["#2F7A2B", "#E1EFD9"],
      ["#2A6E27", "#E1EFD9"],
      "All 8 meals on target",
    ],
    ["Avatar initial", ["#FFFFFF", "#B7790A"], ["#FFFFFF", "#9A6508"], "A"],
    [
      "Star outline on a rating tile",
      ["#B7790A", "#F1E7D6"],
      ["#9A6508", "#F1E7D6"],
      "Star outline",
    ],
  ];
  return `<main style="padding:24px;display:flex;flex-direction:column;gap:18px;background:var(--paper);color:var(--ink)"><h1 style="font-size:24px">AA changes: mockup (left) and build (right)</h1>${rows
    .map(
      ([title, a, b, text]) =>
        `<section style="display:flex;flex-direction:column;gap:6px"><h2 style="font-size:17px">${title}</h2><div style="display:flex;gap:24px;flex-wrap:wrap">${swatch(a[0], a[1], text)}${swatch(b[0], b[1], text)}</div></section>`,
    )
    .join("")}</main>`;
}

test.describe("@G3 screenshots", () => {
  test("@G3 shell, primitives and mockup references", async ({ page, request }) => {
    test.setTimeout(240_000);
    const out = process.env.SHELL_SCREENSHOT_DIR ?? join(tmpdir(), "mise-shell-screenshots");
    mkdirSync(out, { recursive: true });
    for (const vp of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        await setup(page, vp.width, vp.height, scheme);
        await page.goto(ROUTES.offline);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(out, `offline-${vp.name}-${scheme}.png`) });
        for (const variant of SHELL_VARIANTS) {
          await showMarkup(page, request, shellMarkup(variant, PrimitivesGallery()));
          await page.screenshot({
            path: join(out, `shell-${variant.id}-${vp.name}-${scheme}.png`),
          });
          if (variant.id === "admin") {
            await page.screenshot({
              path: join(out, `primitives-${vp.name}-${scheme}.png`),
              fullPage: true,
            });
          }
        }
        await showMarkup(page, request, sheetMarkup());
        await page.screenshot({ path: join(out, `sheet-${vp.name}-${scheme}.png`) });
      }
    }
    // Mockup (left / top) next to the build, same data: admin Omar on Today.
    const label = (text: string) =>
      `<p style="margin:0 0 8px;font:800 13px Nunito,sans-serif;color:#5A4A3B">${text}</p>`;
    await setup(page, 560, 900, "light");
    await showMarkup(
      page,
      request,
      `<div style="display:flex;gap:40px;padding:20px;background:#FFF8EE;align-items:flex-start"><div>${label("Rail.dc.html")}${mockupMarkup("Rail.dc.html", "today")}</div><div>${label("Build")}<div style="height:860px;display:flex">${renderToStaticMarkup(
        h(Rail, { viewer: VIEWERS.admin, pathname: ROUTES.today }),
      ).replace("h-dvh", "h-full")}</div></div></div>`,
    );
    await page.screenshot({ path: join(out, "compare-rail-mockup-vs-build.png"), fullPage: true });
    await setup(page, 390, 300, "light");
    await showMarkup(
      page,
      request,
      `<div style="padding:12px 0;background:#FFF8EE">${label("&nbsp;TabBar.dc.html")}${mockupMarkup("TabBar.dc.html", "today")}<div style="height:24px"></div>${label("&nbsp;Build")}<div style="position:relative;height:84px;transform:translateZ(0)">${renderToStaticMarkup(
        h(TabBar, { viewer: VIEWERS.admin, pathname: ROUTES.today }),
      )}</div></div>`,
    );
    await page.screenshot({
      path: join(out, "compare-tabbar-mockup-vs-build.png"),
      fullPage: true,
    });
    await setup(page, 1100, 700, "light");
    await showMarkup(page, request, deviationMarkup());
    await page.screenshot({ path: join(out, "aa-deviations.png"), fullPage: true });
  });
});
