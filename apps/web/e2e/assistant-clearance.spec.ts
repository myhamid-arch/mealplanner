// Leaf 1.4.11 (W-15, R-77): the floating Assistant button no longer covers a page's last control
// at phone width. Run by scripts/verify/leaf-1.4.11.mjs against a real database and worker; the
// script starts both and passes DATABASE_URL, AUTH_SECRET and APP_URL to `next start`, and the
// pre-fix class lists of the shell (PREFIX_MAIN_CLASS, PREFIX_SHELL_CLASS, read from git).
//   @G1  at 390 and 360 px as an admin, on /account and on a Plate, scrolled to the end: the
//        button's box misses the last control ("Delete my account", "See recipe") and
//        elementFromPoint at the control's centre hits it; a member and a kitchen user keep the
//        pre-fix padding; on /account the control ends at least 16 px above the button. Negative
//        control (R-78): the pre-fix classes on the same page make the button cover "See recipe"
//        by at least 20 px (CP1 amendment 1) and leave "Delete my account" under 16 px from it.
//   @G2  axe-core at 390 px on both pages scrolled to the end: no serious or critical violations.
//        Negative control: the same helper reports a known-bad page.
// Captures for the architect (G3) go to $SCREENSHOT_DIR when it is set.
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "360", width: 360, height: 800 },
] as const;
type Viewport = (typeof VIEWPORTS)[number];
const PHONE = VIEWPORTS[0];

const PREFIX_MAIN_CLASS = process.env.PREFIX_MAIN_CLASS ?? "";
const PREFIX_SHELL_CLASS = process.env.PREFIX_SHELL_CLASS ?? "";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;
/** CP1 amendment 1: the Plate's pre-fix overlap must be substantial, not a 1–2 px graze. */
const MIN_OVERLAP_PX = 20;
/** The margin the fix keeps between the last control and the button (SPEC-Q-1; R-78). */
const MARGIN_PX = 16;

type State = Awaited<ReturnType<APIRequestContext["storageState"]>>;
type Who = "admin" | "member" | "kitchen";

interface World {
  admin: APIRequestContext;
  states: Record<Who, State>;
  /** Omar's dinner plate today (the admin's Plate page) and Sara's (the member's). */
  plates: { admin: string; member: string };
}

let world: World | undefined;
function w(): World {
  if (world === undefined) throw new Error("set-up did not run");
  return world;
}

async function json<T>(r: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  const text = await r.text();
  expect(r.status(), `${what}: ${text.slice(0, 400)}`).toBeLessThan(300);
  return JSON.parse(text) as T;
}

async function waitJob(api: APIRequestContext, jobId: string, timeoutMs = 240_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const j = await json<{ status: string; error: unknown }>(
      await api.get(`/api/v1/jobs/${jobId}`),
      "job",
    );
    if (j.status === "succeeded") return;
    if (j.status === "failed" || j.status === "cancelled")
      throw new Error(`job ${jobId} ${j.status}: ${JSON.stringify(j.error)}`);
    if (Date.now() > end) throw new Error(`job ${jobId} still ${j.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  const base = test.info().project.use.baseURL ?? "";
  const tag = Math.random().toString(36).slice(2, 8);
  const admin = await playwright.request.newContext({ baseURL: base });
  await json(
    await admin.post("/api/v1/signup", {
      data: {
        email: `omar-${tag}@example.test`,
        password: "correct horse battery",
        name: "Omar",
        householdName: "The Hamids",
      },
    }),
    "signup",
  );
  const omar = crypto.randomUUID();
  const sara = crypto.randomUUID();
  // The targeted adults of F1 (BLD-2) and one child, so the Plate has bars and a full layout.
  await json(
    await admin.post("/api/v1/change-sets", {
      data: {
        summary: "test setup (F1 adults)",
        ops: [
          {
            kind: "member.create",
            payload: {
              id: omar,
              displayName: "Omar",
              color: "sea",
              birthYear: 1985,
              isTargeted: true,
              appetite: "large",
            },
          },
          {
            kind: "member.create",
            payload: {
              id: sara,
              displayName: "Sara",
              color: "aubergine",
              birthYear: 1987,
              isTargeted: true,
              appetite: "medium",
            },
          },
          {
            kind: "member.create",
            payload: {
              id: crypto.randomUUID(),
              displayName: "Zayd",
              color: "basil",
              birthYear: 2016,
              isTargeted: false,
              appetite: "medium",
            },
          },
          {
            kind: "target.set",
            payload: {
              memberId: omar,
              kind: "default",
              profile: { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70, satFatMaxG: 22 },
            },
          },
          {
            kind: "target.set",
            payload: {
              memberId: sara,
              kind: "default",
              profile: { kcal: 1655, proteinG: 130, carbsG: 160, fatG: 55, satFatMaxG: 18 },
            },
          },
        ],
      },
    }),
    "setup",
  );
  const joinAs = async (role: string, memberId: string | null, name: string) => {
    const { code } = await json<{ code: string }>(
      await admin.post("/api/v1/invites", {
        data: { role, memberId, expiresIn: "7d", channel: "link" },
      }),
      "invite",
    );
    const ctx = await playwright.request.newContext({ baseURL: base });
    await json(
      await ctx.post("/api/v1/invites/accept", {
        data: {
          code,
          signup: {
            email: `${name.toLowerCase()}-${tag}@example.test`,
            password: "another horse battery",
            name,
          },
        },
      }),
      "accept",
    );
    const state = await ctx.storageState();
    await ctx.dispose();
    return state;
  };
  const memberState = await joinAs("member", sara, "Sara");
  const kitchenState = await joinAs("kitchen", null, "Priya");
  const hh = await json<{ timezone: string }>(
    await admin.get("/api/v1/households/current"),
    "household",
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: hh.timezone }).format(new Date());
  // Today planned through the API and the worker, as 1.4.8's plan.spec.ts does.
  const job = await json<{ jobId: string }>(
    await admin.post("/api/v1/plans/generate", { data: { dates: [today], seed: 1 } }),
    "generate",
  );
  await waitJob(admin, job.jobId);
  const plan = await json<{
    days: Array<{
      meals: Array<{
        slotKey: string;
        memberScope: string;
        plates: Array<{ id: string; memberId: string }>;
      }>;
    }>;
  }>(await admin.get(`/api/v1/plans?from=${today}&to=${today}`), "plans");
  const dinner = plan.days[0]?.meals.find(
    (m) => m.slotKey === "dinner" && m.memberScope === "shared",
  );
  const plateOf = (memberId: string) => {
    const p = dinner?.plates.find((x) => x.memberId === memberId);
    if (p === undefined) throw new Error(`no dinner plate today for ${memberId}`);
    return p.id;
  };
  world = {
    admin,
    states: { admin: await admin.storageState(), member: memberState, kitchen: kitchenState },
    plates: { admin: plateOf(omar), member: plateOf(sara) },
  };
});

test.afterAll(async () => {
  await world?.admin.dispose();
});

// Pages ----------------------------------------------------------------------------------------

interface Target {
  readonly name: "account" | "plate";
  readonly path: (who: Who) => string;
  /** The page's last control. */
  readonly control: (page: Page) => ReturnType<Page["getByRole"]>;
}

const ACCOUNT: Target = {
  name: "account",
  path: () => "/account",
  control: (page) => page.getByRole("button", { name: "Delete my account", exact: true }),
};
const PLATE: Target = {
  name: "plate",
  path: (who) => `/today/plates/${who === "member" ? w().plates.member : w().plates.admin}`,
  control: (page) => page.getByRole("link", { name: "See recipe", exact: true }),
};
const TARGETS = [ACCOUNT, PLATE] as const;

async function open(
  browser: Browser,
  who: Who,
  v: Viewport,
  target: Target,
  dark = false,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    storageState: w().states[who],
    viewport: { width: v.width, height: v.height },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await ctx.newPage();
  await page.goto(target.path(who));
  await expect(target.control(page)).toBeVisible({ timeout: 120_000 });
  await settled(page);
  return { ctx, page };
}

/** Fonts loaded, animations finished and the layout unchanged over three samples. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.readyState === "complete", undefined, {
    timeout: 120_000,
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const layout = () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      const r = main?.getBoundingClientRect();
      return `${String(document.documentElement.scrollHeight)}/${String(r?.width)}/${String(r?.height)}/${String(main?.querySelectorAll("*").length)}`;
    });
  let last = await layout();
  let same = 0;
  const deadline = Date.now() + 60_000;
  while (same < 2) {
    if (Date.now() > deadline) throw new Error(`layout did not settle (${last})`);
    await page.waitForTimeout(250);
    const now = await layout();
    same = now === last ? same + 1 : 0;
    last = now;
  }
}

async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  });
  await page.waitForFunction(
    () =>
      Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) <= 1,
    undefined,
    { timeout: 10_000 },
  );
  // Two frames, so layout and paint have caught up before measuring.
  await page.evaluate(
    () =>
      new Promise((r) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            r(null);
          });
        });
      }),
  );
}

/** The pre-fix class lists on the shell's `main` and outer `div` (the negative control). */
async function applyPreFix(page: Page): Promise<string> {
  expect(PREFIX_MAIN_CLASS, "PREFIX_MAIN_CLASS is set by the verify script").toContain(
    "pb-[calc(100px+env(safe-area-inset-bottom))]",
  );
  expect(PREFIX_SHELL_CLASS, "PREFIX_SHELL_CLASS is set by the verify script").toContain(
    "min-h-dvh",
  );
  await page.evaluate(
    ([mainClass, shellClass]) => {
      const main = document.querySelector("main#main");
      if (main === null) throw new Error("no main#main");
      main.className = mainClass;
      if (main.parentElement === null) throw new Error("main has no parent");
      main.parentElement.className = shellClass;
    },
    [PREFIX_MAIN_CLASS, PREFIX_SHELL_CLASS] as const,
  );
  return paddingBottom(page);
}

function paddingBottom(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector("main#main") as Element).paddingBottom,
  );
}

const assistantButton = (page: Page) => page.getByRole("link", { name: /^Open assistant/ });

interface Measure {
  /** document height and viewport height */
  scrollHeight: number;
  innerHeight: number;
  button: { x: number; y: number; width: number; height: number };
  control: { x: number; y: number; width: number; height: number };
  overlap: { width: number; height: number };
  /** The control's bottom edge to the button's top edge (negative when they overlap). */
  gap: number;
  /** elementFromPoint at the control's centre is the control or inside it. */
  hitsControl: boolean;
  hitDescription: string;
}

/** Scrolls to the end and measures the button against the control with real layout. */
async function measure(page: Page, target: Target): Promise<Measure> {
  await scrollToEnd(page);
  const control = await target.control(page).elementHandle();
  const button = await assistantButton(page).elementHandle();
  return page.evaluate(
    ([c, b]) => {
      const box = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const cb = box(c);
      const bb = box(b);
      const overlap = {
        width: Math.max(0, Math.min(cb.x + cb.width, bb.x + bb.width) - Math.max(cb.x, bb.x)),
        height: Math.max(0, Math.min(cb.y + cb.height, bb.y + bb.height) - Math.max(cb.y, bb.y)),
      };
      const hit = document.elementFromPoint(cb.x + cb.width / 2, cb.y + cb.height / 2);
      const describe = (e: Element | null) =>
        e === null
          ? "nothing"
          : `${e.tagName.toLowerCase()}${e.getAttribute("aria-label") ? ` [${String(e.getAttribute("aria-label"))}]` : ""} "${e.textContent.trim().slice(0, 40)}"`;
      return {
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        button: bb,
        control: cb,
        overlap,
        gap: bb.y - (cb.y + cb.height),
        hitsControl: hit !== null && (hit === c || c.contains(hit)),
        hitDescription: describe(hit),
      };
    },
    [control, button] as const,
  );
}

const fmt = (m: Measure) =>
  `button y ${m.button.y.toFixed(1)}–${(m.button.y + m.button.height).toFixed(1)}, control y ${m.control.y.toFixed(1)}–${(m.control.y + m.control.height).toFixed(1)} x ${m.control.x.toFixed(1)}–${(m.control.x + m.control.width).toFixed(1)}, overlap ${m.overlap.width.toFixed(1)}×${m.overlap.height.toFixed(1)}, gap ${m.gap.toFixed(1)}, hit ${m.hitDescription}`;

async function capture(page: Page, name: string): Promise<void> {
  if (SCREENSHOT_DIR === undefined || SCREENSHOT_DIR === "") return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((x) => x.impact === "serious" || x.impact === "critical")
    .map(
      (x) =>
        `${x.id} (${String(x.impact)}): ${x.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 5)
          .join(" | ")}`,
    );
}

// G1 -------------------------------------------------------------------------------------------

for (const v of VIEWPORTS)
  for (const target of TARGETS)
    test(`@G1 at ${v.name} px as an admin, ${target.name} scrolled to the end: the Assistant button misses the last control`, async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, "admin", v, target);
      try {
        await expect(assistantButton(page)).toBeVisible();
        expect(await paddingBottom(page), "main reserves the button's space").toBe("174px");
        const m = await measure(page, target);
        console.log(`  ${target.name} ${v.name} px, after: ${fmt(m)}`);
        expect(m.scrollHeight, "the page is taller than the viewport").toBeGreaterThan(
          m.innerHeight,
        );
        expect(m.overlap.width * m.overlap.height, `no intersection: ${fmt(m)}`).toBe(0);
        expect(m.hitsControl, `elementFromPoint hits the control: ${fmt(m)}`).toBe(true);
        // R-78: on /account the fix keeps at least the margin between the control and the button.
        if (target === ACCOUNT)
          expect(
            m.gap,
            `the gap is at least ${String(MARGIN_PX)} px: ${fmt(m)}`,
          ).toBeGreaterThanOrEqual(MARGIN_PX);
        if (v === PHONE) await capture(page, `${target.name}-${v.name}-after`);
      } finally {
        await ctx.close();
      }
    });

// Negative control (R-78): with the pre-fix class lists the button covers the Plate's "See recipe"
// by at least 20 px; on /account 1.4.6's own bottom padding already keeps "Delete my account" just
// clear of it at the end of the page, so there the control is the gap under the 16 px margin.
for (const v of VIEWPORTS)
  for (const target of TARGETS)
    test(
      target === PLATE
        ? `@G1 negative control at ${v.name} px, plate: with the pre-fix padding the button covers the last control by at least ${String(MIN_OVERLAP_PX)} px`
        : `@G1 negative control at ${v.name} px, account: with the pre-fix padding the gap to the button is under the ${String(MARGIN_PX)} px margin`,
      async ({ browser }) => {
        const { ctx, page } = await open(browser, "admin", v, target);
        try {
          expect(await applyPreFix(page), "the pre-fix class computes to 100 px").toBe("100px");
          await settled(page);
          const m = await measure(page, target);
          console.log(`  ${target.name} ${v.name} px, pre-fix: ${fmt(m)}`);
          expect(m.scrollHeight, "the page is taller than the viewport").toBeGreaterThan(
            m.innerHeight,
          );
          if (target === PLATE) {
            expect(m.overlap.width, `the button covers the control: ${fmt(m)}`).toBeGreaterThan(0);
            expect(
              m.overlap.height,
              `the overlap is at least ${String(MIN_OVERLAP_PX)} px high: ${fmt(m)}`,
            ).toBeGreaterThanOrEqual(MIN_OVERLAP_PX);
          } else {
            expect(m.gap, `the gap is under ${String(MARGIN_PX)} px: ${fmt(m)}`).toBeLessThan(
              MARGIN_PX,
            );
          }
          if (v === PHONE) await capture(page, `${target.name}-${v.name}-before`);
        } finally {
          await ctx.close();
        }
      },
    );

for (const [who, target] of [
  ["member", ACCOUNT],
  ["member", PLATE],
  ["kitchen", ACCOUNT],
] as const)
  test(`@G1 without the assistant (${who}), ${target.name} at 390 px keeps the pre-fix padding`, async ({
    browser,
  }) => {
    const { ctx, page } = await open(browser, who, PHONE, target);
    try {
      await expect(assistantButton(page)).toHaveCount(0);
      const now = await paddingBottom(page);
      expect(now, "main's bottom padding is the tab bar clearance only").toBe("100px");
      // The same page with the pre-fix class lists computes the same value.
      expect(await applyPreFix(page)).toBe(now);
    } finally {
      await ctx.close();
    }
  });

// G2 -------------------------------------------------------------------------------------------

for (const target of TARGETS)
  for (const dark of [false, true])
    test(`@G2 axe at 390 px, ${target.name} scrolled to the end (${dark ? "dark" : "light"}): no serious or critical violations`, async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, "admin", PHONE, target, dark);
      try {
        await expect(assistantButton(page)).toBeVisible();
        await scrollToEnd(page);
        expect(await seriousViolations(page)).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

test("@G2 negative control: axe reports a known-bad page", async ({ page }) => {
  await page.setContent(
    `<html><body><main><button></button><p style="color:#eee;background:#fff">faint</p></main></body></html>`,
  );
  expect((await seriousViolations(page)).length).toBeGreaterThan(0);
});
