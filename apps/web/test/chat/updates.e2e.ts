// Leaf 1.4.9 G4 (scripts/verify/leaf-1.4.9.mjs runs it; leaf-1.4.9 ADR-1). At 390 and 1280 px,
// with axe-core (no serious or critical violation, light and dark):
//   - the Updates conversation (ChatPhoneDigest): the digest's "Done automatically" block with
//     Undo (W-9a), the "Monday's plan is ready" row (W-9b), and a digest stored before the field
//     existed, still drawn;
//   - the shell (W-10b, R-63 option A): the floating Assistant button shows at 390 px and is hidden
//     at 1280 px, where the side panel's opener covers no content on Planning balance, Plan and
//     Chat.
// Negative controls: axe reports a known-bad page; the overlap check reports content under the
// opener when its space is not reserved; the hidden check fails when the button is forced visible.
//
// Environment (set by the verify script): PLAYWRIGHT_PORT (a running `next start` on the gate's
// database, with the worker), DATABASE_URL, WORLD_FILE, SCREENSHOT_DIR (captures for G5).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import pg from "pg";
import {
  inferSetup,
  parsePeople,
  parseTargets,
  type OnboardingAnswers,
} from "@mealplanner/core/onboarding";

const BASE_URL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "3149"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const WORLD_FILE = process.env.WORLD_FILE ?? join(tmpdir(), "leaf-1.4.9-world.json");
const SHOTS = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "leaf-1.4.9-screenshots");
const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;

interface World {
  state: string;
  updatesId: string;
  monday: string;
  learningChangeSetId: string;
  planJobId: string;
}

async function sql<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

function world(): World {
  if (!existsSync(WORLD_FILE)) throw new Error("the @G4 set-up did not run");
  return JSON.parse(readFileSync(WORLD_FILE, "utf8")) as World;
}

async function json<T>(
  res: Awaited<ReturnType<APIRequestContext["get"]>>,
  what: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${what}: ${String(res.status())} ${await res.text()}`);
  return (await res.json()) as T;
}

async function waitForJob(request: APIRequestContext, jobId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const j = await json<{ status: string }>(await request.get(`/api/v1/jobs/${jobId}`), "job");
        if (j.status === "failed") throw new Error(`job ${jobId} failed`);
        return j.status;
      },
      { timeout: 300_000, intervals: [500, 1000, 2000] },
    )
    .toBe("succeeded");
}

/** The Monday after today (UTC). */
function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

async function contextFor(
  browser: Browser,
  state: string,
  viewport: { width: number; height: number },
  colorScheme: "light" | "dark" = "light",
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    viewport,
    colorScheme,
    storageState: JSON.parse(state) as { cookies: []; origins: [] },
  });
}

async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) => `${v.id} (${v.impact ?? ""}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
}

/** axe in light and dark; every serious or critical violation found. */
async function axeBoth(page: Page, where: string): Promise<string[]> {
  const found: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await settled(page);
    for (const v of await seriousViolations(page)) found.push(`${where} [${scheme}]: ${v}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await settled(page);
  return found;
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** The floating Assistant button (1.4.2, UX-3): the phone's "Open assistant" link. */
async function floatingButtonShown(page: Page): Promise<boolean> {
  return page.getByRole("link", { name: /^Open assistant/ }).isVisible();
}

/**
 * Waits for the content a check measures (CP3 finding 1): the given element visible, the document
 * loaded, fonts loaded, and the page's layout unchanged over three samples 250 ms apart. Under
 * concurrent gate load a page can otherwise be measured before it has rendered or hydrated.
 */
async function contentSettled(page: Page, selector: string): Promise<void> {
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 120_000 });
  // Not "networkidle": some pages keep a live connection open (job events, previews).
  await page.waitForFunction(() => document.readyState === "complete", undefined, {
    timeout: 120_000,
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
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

/**
 * Elements inside `main` whose box overlaps the side panel's opener, at the top, the middle and
 * the bottom of the page (W-10b). Empty when there is no opener.
 */
async function underTheOpener(page: Page): Promise<string[]> {
  const found = new Set<string>();
  for (const at of [0, 0.5, 1]) {
    await page.evaluate((f) => {
      window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * f);
    }, at);
    await page.waitForTimeout(150);
    const hits = await page.evaluate(() => {
      const opener = document.querySelector(
        "aside > button[aria-label='Open the assistant panel']",
      );
      const main = document.querySelector("main");
      if (opener === null || main === null) return [];
      const o = opener.getBoundingClientRect();
      const out: string[] = [];
      for (const el of main.querySelectorAll("*")) {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > o.left && r.left < o.right && r.bottom > o.top && r.top < o.bottom)
          out.push(
            `${el.tagName.toLowerCase()}${el.id === "" ? "" : `#${el.id}`} "${el.textContent.trim().slice(0, 40)}"`,
          );
      }
      return out;
    });
    for (const h of hits) found.add(h);
  }
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  return [...found];
}

async function setUpMockupFamily(request: APIRequestContext): Promise<void> {
  const omar = parseTargets("2150 cal, 180p 200c 70f");
  const sara = parseTargets("1655 / 130 / 160 / 55");
  if (!omar.ok || !sara.ok) throw new Error("targets did not parse");
  const answers: OnboardingAnswers = {
    people: parsePeople(
      "me (41), my wife Sara 39 and our three kids Layla 18 F, Adam 15 M and Zayd 10 M",
    ),
    targets: [
      { person: "me", numbers: omar.value },
      { person: "Sara", numbers: sara.value },
    ],
    week: {
      school: { people: ["Layla", "Adam", "Zayd"], weekdays: [0, 1, 2, 3, 4] },
      work: null,
      training: [{ person: "me", weekdays: [0, 2, 4], time: "evening" }],
      snacks: false,
    },
    cuisines: ["levantine", "italian"],
    neverEat: null,
  };
  const [slots, cuisines, ingredients, household] = await Promise.all([
    json<{ slots: never[] }>(await request.get("/api/v1/slots"), "slots"),
    json<{ cuisines: never[] }>(await request.get("/api/v1/cuisines"), "cuisines"),
    json<{ ingredients: never[] }>(
      await request.get("/api/v1/ingredients?limit=500"),
      "ingredients",
    ),
    json<{ satFatDefaultPct: number }>(
      await request.get("/api/v1/households/current"),
      "household",
    ),
  ]);
  const setup = inferSetup(answers, {
    referenceYear: new Date().getUTCFullYear(),
    adminName: "Omar",
    slots: slots.slots,
    cuisines: cuisines.cuisines,
    ingredients: ingredients.ingredients,
    satFatDefaultPct: household.satFatDefaultPct,
    newId: () => randomUUID(),
  });
  await json(
    await request.post("/api/v1/change-sets", {
      data: { summary: "Household set up from onboarding", ops: setup.changeOps },
    }),
    "set up",
  );
}

test.describe.serial("@G4 Updates conversation and shell", () => {
  test.setTimeout(420_000);

  test("@G4 set-up: the mockup's family, a too-much rating for Zayd, the insights run and Monday's plan", async ({
    browser,
  }) => {
    const run = randomUUID().slice(0, 8);
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const a = ctx.request;
    await json(
      await a.post("/api/v1/signup", {
        data: {
          email: `omar-${run}@example.com`,
          password: "omar-password-1",
          name: "Omar",
          householdName: `Updates home ${run}`,
        },
      }),
      "signup",
    );
    await setUpMockupFamily(a);
    const members = await json<{ members: { id: string; displayName: string }[] }>(
      await a.get("/api/v1/members"),
      "members",
    );
    const zayd = members.members.find((m) => m.displayName === "Zayd");
    expect(zayd, "the parse named Zayd").toBeDefined();
    expect(members.members.map((m) => m.displayName).sort()).toEqual(
      ["Adam", "Layla", "Omar", "Sara", "Zayd"].sort(),
    );
    const dishes = await json<{ dishes: { id: string; name: string }[] }>(
      await a.get("/api/v1/dishes"),
      "dishes",
    );
    const dish = dishes.dishes.find((d) => /rice/i.test(d.name)) ?? dishes.dishes[0];
    if (dish === undefined || zayd === undefined) throw new Error("no dish or no Zayd");
    await json(
      await a.post("/api/v1/reviews", {
        data: {
          targetType: "dish",
          targetId: dish.id,
          onBehalfOfMemberId: zayd.id,
          rating: 3,
          tags: ["too_much"],
        },
      }),
      "review",
    );
    const [learning] = await sql<{ id: string }>(
      `SELECT id FROM change_set WHERE source = 'learning' AND forward @> '[{"kind":"portion_bias.set"}]'::jsonb
        AND household_id = (SELECT household_id FROM member WHERE id = $1)
        ORDER BY applied_at DESC LIMIT 1`,
      [zayd.id],
    );
    if (learning === undefined) throw new Error("the review wrote no portion move");
    const insights = await json<{ jobId: string }>(
      await a.post("/api/v1/insights/run"),
      "insights",
    );
    await waitForJob(a, insights.jobId);
    const monday = nextMonday();
    const plan = await json<{ jobId: string }>(
      await a.post("/api/v1/plans/generate", { data: { dates: [monday] } }),
      "generate",
    );
    await waitForJob(a, plan.jobId);
    const conversations = await json<{ conversations: { id: string; title: string }[] }>(
      await a.get("/api/v1/conversations"),
      "conversations",
    );
    const updates = conversations.conversations.find((c) => c.title === "Updates");
    if (updates === undefined) throw new Error("no Updates conversation");
    // A digest stored before `automatic` existed (1.4.5's shape), an hour before the others.
    await sql(
      `INSERT INTO chat_message (id, household_id, conversation_id, role, content, created_at)
       SELECT $1, household_id, id, 'event', $2::jsonb,
              (SELECT min(created_at) FROM chat_message WHERE conversation_id = $3) - interval '1 hour'
         FROM conversation WHERE id = $3`,
      [
        randomUUID(),
        JSON.stringify({
          text: "I looked at the latest reviews: 1 note(s), no new proposals.",
          cards: [
            {
              type: "insight_digest",
              runAt: new Date(Date.now() - 3_600_000).toISOString(),
              proposals: [],
              dropped: [],
              notes: [{ title: "Earlier note", rationale: "Stored before the automatic list." }],
            },
          ],
        }),
        updates.id,
      ],
    );
    const w: World = {
      state: JSON.stringify(await ctx.storageState()),
      updatesId: updates.id,
      monday,
      learningChangeSetId: learning.id,
      planJobId: plan.jobId,
    };
    writeFileSync(WORLD_FILE, JSON.stringify(w));
    await ctx.close();
  });

  for (const vp of [
    { name: "390", size: PHONE },
    { name: "1280", size: DESKTOP },
  ] as const)
    test(`@G4 the Updates conversation at ${vp.name} px: Done automatically with Undo, the plan-ready row, an older digest`, async ({
      browser,
    }) => {
      const w = world();
      const ctx = await contextFor(browser, w.state, vp.size);
      const page = await ctx.newPage();
      await page.goto(`/chat/${w.updatesId}`);
      const digests = page.locator("[data-card=insight_digest]");
      await expect(digests).toHaveCount(2);
      await expect(page.locator("[data-card=unreadable]")).toHaveCount(0);
      // The digest stored without the field is drawn as before.
      await expect(digests.first()).toContainText("Earlier note");
      await expect(digests.first().locator("[data-automatic-change]")).toHaveCount(0);
      const auto = page.locator(`[data-automatic-change="${w.learningChangeSetId}"]`);
      await expect(auto).toBeVisible();
      await expect(auto).toContainText("DONE AUTOMATICALLY");
      await expect(auto).toContainText(/Zayd's .+ portions? (is|are) 10% smaller\./);
      await expect(auto.getByRole("button", { name: /^Undo: Zayd's/ })).toBeVisible();
      const ready = page.locator("[data-plan-ready]");
      await expect(ready).toHaveCount(1);
      await expect(ready).toContainText("Monday's plan is ready");
      await expect(ready).toContainText(/All meals on target|off target/);
      await expect(ready).toContainText("3 packed school lunches");
      await expect(ready).toContainText("Omar's training-day meals included");
      await expect(ready.getByRole("link", { name: "Look, then send to kitchen" })).toHaveAttribute(
        "href",
        `/plan?week=${w.monday}`,
      );
      // The digest comes before the plan row, as in ChatPhoneDigest.
      const order = await page.evaluate(() => {
        const a = document.querySelector("[data-automatic-change]");
        const b = document.querySelector("[data-plan-ready]");
        return a !== null && b !== null && (a.compareDocumentPosition(b) & 4) !== 0;
      });
      expect(order).toBe(true);
      expect(await axeBoth(page, `Updates ${vp.name}`)).toEqual([]);
      await auto.scrollIntoViewIfNeeded();
      await shot(page, `updates-${vp.name}-light`);
      await page.emulateMedia({ colorScheme: "dark" });
      await settled(page);
      await shot(page, `updates-${vp.name}-dark`);
      await ctx.close();
    });

  test("@G4 Undo at 390 px undoes the learning change set through the change log", async ({
    browser,
  }) => {
    const w = world();
    const ctx = await contextFor(browser, w.state, PHONE);
    const page = await ctx.newPage();
    await page.goto(`/chat/${w.updatesId}`);
    const auto = page.locator(`[data-automatic-change="${w.learningChangeSetId}"]`);
    await auto.getByRole("button", { name: /^Undo: / }).click();
    await expect(auto.getByText("Undone")).toBeVisible();
    const [row] = await sql<{ undone_at: Date | null }>(
      `SELECT undone_at FROM change_set WHERE id = $1`,
      [w.learningChangeSetId],
    );
    expect(row?.undone_at).not.toBeNull();
    // Read back from the change log after a reload, not only from the click.
    await page.reload();
    await expect(
      page.locator(`[data-automatic-change="${w.learningChangeSetId}"]`).getByText("Undone"),
    ).toBeVisible();
    await ctx.close();
  });

  test("@G4 the floating Assistant button shows at 390 px and is hidden at 1280 px", async ({
    browser,
  }) => {
    const w = world();
    for (const [size, shown] of [
      [PHONE, true],
      [DESKTOP, false],
    ] as const) {
      const ctx = await contextFor(browser, w.state, size);
      const page = await ctx.newPage();
      for (const path of ["/today", `/plan?week=${w.monday}`, "/settings/planning"]) {
        await page.goto(path);
        await contentSettled(page, "main h1");
        expect(await floatingButtonShown(page), `${path} at ${String(size.width)} px`).toBe(shown);
      }
      if (!shown)
        await expect(
          page.locator("nav[aria-label='Main']").getByRole("link", { name: /^Assistant/ }),
        ).toBeVisible();
      await ctx.close();
    }
  });

  test("@G4 at 1280 px the side panel's opener covers no content on Planning balance, Plan and Chat", async ({
    browser,
  }) => {
    const w = world();
    const ctx = await contextFor(browser, w.state, DESKTOP);
    const page = await ctx.newPage();
    await page.goto("/settings/planning");
    await page
      .getByRole("radiogroup", { name: "Detail level for planning balance" })
      .getByRole("radio", { name: "Detailed" })
      .click();
    const panel = page.getByRole("region", { name: "Next week, if you save" });
    await expect(panel).toHaveAttribute("data-preview", "ready", { timeout: 300_000 });
    const opener = page.getByRole("button", { name: "Open the assistant panel" });
    await expect(opener).toBeVisible();
    await contentSettled(page, "[data-preview=ready]");
    expect(await underTheOpener(page), "Planning balance").toEqual([]);
    await shot(page, "planning-balance-1280");
    await page.goto(`/plan?week=${w.monday}`);
    await contentSettled(page, "[data-testid=week-stats]");
    await expect(opener).toBeVisible();
    expect(await underTheOpener(page), "Plan").toEqual([]);
    await shot(page, "plan-1280");
    // On the assistant's own page the panel (and its opener) is not shown.
    await page.goto(`/chat/${w.updatesId}`);
    await contentSettled(page, "[data-plan-ready]");
    await expect(opener).toHaveCount(0);
    expect(await underTheOpener(page), "Chat").toEqual([]);
    expect(await floatingButtonShown(page)).toBe(false);
    // With the panel open there is no opener, and the page is not narrowed for one.
    await page.goto(`/plan?week=${w.monday}`);
    await contentSettled(page, "[data-testid=week-stats]");
    await opener.click();
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
    const pad = await page.evaluate(
      () => getComputedStyle(document.querySelector("main") as Element).paddingRight,
    );
    expect(pad).toBe("32px");
    await ctx.close();
  });

  test("@G4 negative control: axe reports a known-bad page", async ({ page }) => {
    await page.setContent(
      `<html><body><main><button></button><p style="color:#eee;background:#fff">faint</p></main></body></html>`,
    );
    expect((await seriousViolations(page)).length).toBeGreaterThan(0);
  });

  test("@G4 negative control: the overlap check finds content under the opener when its space is not reserved", async ({
    browser,
  }) => {
    const w = world();
    const ctx = await contextFor(browser, w.state, DESKTOP);
    const page = await ctx.newPage();
    await page.goto(`/plan?week=${w.monday}`);
    await contentSettled(page, "[data-testid=week-stats]");
    await expect(page.getByRole("button", { name: "Open the assistant panel" })).toBeVisible();
    // 1.4.2's padding (before R-63), and content running to the bottom-right corner. Inserted
    // idempotently and measured until it is in place: a late hydration can re-render the page and
    // drop nodes added from outside React.
    const unreserve = () =>
      page.evaluate(() => {
        if (document.getElementById("leaf149-unreserved") === null) {
          const style = document.createElement("style");
          style.id = "leaf149-unreserved";
          style.textContent = "main#main { padding: 28px 32px !important; }";
          document.head.appendChild(style);
        }
        if (document.getElementById("leaf149-last-line") === null) {
          const p = document.createElement("p");
          p.id = "leaf149-last-line";
          p.textContent = "Last line of the page, right-aligned";
          p.style.textAlign = "right";
          p.style.marginTop = "400px";
          document.querySelector("main")?.appendChild(p);
        }
      });
    await expect
      .poll(
        async () => {
          await unreserve();
          await expect(page.locator("#leaf149-last-line")).toBeVisible();
          return (await underTheOpener(page)).length;
        },
        { timeout: 60_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0);
    await ctx.close();
  });

  test("@G4 negative control: the hidden check fails when the floating button is forced visible at 1280 px", async ({
    browser,
  }) => {
    const w = world();
    const ctx = await contextFor(browser, w.state, DESKTOP);
    const page = await ctx.newPage();
    await page.goto("/today");
    await contentSettled(page, "main h1");
    expect(await floatingButtonShown(page)).toBe(false);
    // Inserted idempotently and re-checked until in place (see the overlap control).
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            if (document.getElementById("leaf149-forced") !== null) return;
            const style = document.createElement("style");
            style.id = "leaf149-forced";
            style.textContent = ".lg\\:hidden { display: block !important; }";
            document.head.appendChild(style);
          });
          return floatingButtonShown(page);
        },
        { timeout: 60_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    await ctx.close();
  });
});
