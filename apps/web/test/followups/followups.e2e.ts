// Leaf 1.4.10 G4 (scripts/verify/leaf-1.4.10.mjs runs it). At 390 and 1280 px, with axe-core (no
// serious or critical violation, light and dark):
//   - the Plate's "Why this dinner" box after the kitchen flagged an ingredient of that dinner
//     unavailable and the real `plates.substitute` job re-solved it (W-12, PlatePhone): the
//     reasons name no replaced ingredient and no slug;
//   - /changelog (W-14, ChangeLog) with a block, a target change and a settings change: each
//     entry names its subject, with the before → after chips.
// Negative controls: axe reports a known-bad page; the plate check finds the replaced ingredient
// when a reason names it; the change-log check fails on the stored summaries (title-only).
// Captures for G5 go to SCREENSHOT_DIR.
//
// Environment (set by the verify script): PLAYWRIGHT_PORT (a running `next start` on the gate's
// database, with the worker), DATABASE_URL, WORLD_FILE, SCREENSHOT_DIR.
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

const BASE_URL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "3150"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const WORLD_FILE = process.env.WORLD_FILE ?? join(tmpdir(), "leaf-1.4.10-world.json");
const SHOTS = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "leaf-1.4.10-screenshots");
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 900 },
] as const;

interface World {
  state: string;
  plateId: string;
  /** The replaced ingredient as recipes say it: its name, its head word and its aliases. */
  replaced: string[];
  replacedSlug: string;
  substitute: string;
  householdId: string;
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
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    viewport,
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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Problems with the "Why this …" reasons: the replaced ingredient named, or a slug. */
function reasonProblems(reasons: string[], w: World): string[] {
  const out: string[] = [];
  for (const r of reasons) {
    for (const name of w.replaced)
      if (new RegExp(`\\b${escape(name)}\\b`, "i").test(r)) out.push(`names "${name}": ${r}`);
    if (new RegExp(`\\b${escape(w.replacedSlug)}\\b`).test(r)) out.push(`slug: ${r}`);
    if (/\b[a-z0-9]+(?:-[a-z0-9]+){1,}\b/.test(r) && /\b[a-z]+-[a-z]+-/.test(r))
      out.push(`slug-like: ${r}`);
    if (/\b[a-z0-9]+_[a-z0-9_]+\b/.test(r)) out.push(`snake_case: ${r}`);
  }
  return out;
}

/** The change-log texts the mockup shows for this world (ChangeLog.dc.html). */
const LOG_TITLES: Array<string | RegExp> = [
  "Blocked Ravi (kitchen)",
  "Sara's protein target 130 → 140 g",
  /Household settings: time zone \S+ → Europe\/London/,
];
function logProblems(texts: string[]): string[] {
  return LOG_TITLES.filter((want) =>
    typeof want === "string" ? !texts.includes(want) : !texts.some((t) => want.test(t)),
  ).map((want) => `no entry reads ${String(want)}`);
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
    week: { school: null, work: null, training: [], snacks: false },
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

type PlanMeal = {
  id: string;
  slotKey: string;
  dishName: string;
  plates: Array<{ id: string; memberId: string }>;
};

test.describe.serial("@G4 plain reasons and change-log subjects", () => {
  test.setTimeout(600_000);

  test("@G4 set-up: the mockup's family; Ravi blocked, Sara's protein target and the time zone changed; a dinner substituted", async ({
    browser,
    playwright,
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
          householdName: `Khalifa home ${run}`,
        },
      }),
      "signup",
    );
    await setUpMockupFamily(a);
    const members = (
      await json<{ members: Array<{ id: string; displayName: string }> }>(
        await a.get("/api/v1/members"),
        "members",
      )
    ).members;
    const memberId = (name: string) => {
      const m = members.find((x) => x.displayName === name);
      if (m === undefined) throw new Error(`no member ${name}`);
      return m.id;
    };
    const join = async (role: string, name: string) => {
      const { code } = await json<{ code: string }>(
        await a.post("/api/v1/invites", {
          data: { role, memberId: null, expiresIn: "7d", channel: "link" },
        }),
        "invite",
      );
      const c2 = await playwright.request.newContext({ baseURL: BASE_URL });
      const joined = await json<{ userId: string }>(
        await c2.post("/api/v1/invites/accept", {
          data: {
            code,
            signup: {
              email: `${name.toLowerCase()}-${run}@example.test`,
              password: "another horse battery",
              name,
            },
          },
        }),
        "accept",
      );
      return { ctx: c2, userId: joined.userId };
    };
    const priya = await join("kitchen", "Priya");
    const ravi = await join("kitchen", "Ravi");
    await ravi.ctx.dispose();

    // The three change-log entries of the mockup.
    await json(await a.post(`/api/v1/access/${ravi.userId}/block`, { data: {} }), "block Ravi");
    await json(
      await a.post("/api/v1/change-sets", {
        data: {
          summary: "Targets",
          ops: [
            {
              kind: "target.set",
              payload: {
                memberId: memberId("Sara"),
                kind: "default",
                profile: { kcal: 1695, proteinG: 140, carbsG: 160, fatG: 55 },
              },
            },
          ],
        },
      }),
      "Sara's target",
    );
    await json(
      await a.post("/api/v1/change-sets", {
        data: {
          summary: "Household settings",
          ops: [{ kind: "household.update", payload: { timezone: "Europe/London" } }],
        },
      }),
      "settings",
    );

    // Monday's plan, then the kitchen flags an ingredient of its dinner unavailable.
    const monday = nextMonday();
    const plan = await json<{ jobId: string }>(
      await a.post("/api/v1/plans/generate", { data: { dates: [monday] } }),
      "plan",
    );
    await waitForJob(a, plan.jobId);
    const mealsOf = async () =>
      (
        await json<{ days: Array<{ meals: PlanMeal[] }> }>(
          await a.get(`/api/v1/plans?from=${monday}&to=${monday}`),
          "plans",
        )
      ).days.flatMap((d) => d.meals);
    const dinner = (await mealsOf()).find((m) => m.slotKey === "dinner");
    if (dinner === undefined) throw new Error("no dinner on Monday");
    const [pick] = await sql<{ id: string; name: string; slug: string; aliases: string[] }>(
      `SELECT i.id, i.name, i.slug, i.aliases FROM plate p JOIN plate_item pi ON pi.plate_id = p.id
       JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id JOIN ingredient i ON i.id = vi.ingredient_id
       JOIN kg_node s ON s.key = i.id::text AND s.type = 'Ingredient'
       JOIN kg_edge e ON e.src_id = s.id AND e.type = 'SUBSTITUTES_FOR'
       WHERE p.plan_meal_id = $1 AND i.category <> 'herb_spice' AND i.slug <> 'water'
       GROUP BY i.id, i.name, i.slug, i.aliases ORDER BY count(*) DESC, i.name LIMIT 1`,
      [dinner.id],
    );
    if (pick === undefined) throw new Error("no ingredient of the dinner has a substitute");
    const flagged = await json<{ jobId: string }>(
      await priya.ctx.post(`/api/v1/cook-sheets/${monday}/flags`, {
        data: { kind: "unavailable", ingredientId: pick.id, planMealId: dinner.id },
      }),
      "flag",
    );
    await priya.ctx.dispose();
    await waitForJob(a, flagged.jobId);
    const after = (await mealsOf()).find((m) => m.id === dinner.id);
    expect(after?.dishName, "the dinner is the substituted copy").toMatch(/ \(with .+\)$/);
    const plate = after?.plates.find((p) => p.memberId === memberId("Omar"));
    if (plate === undefined) throw new Error("Omar has no plate at the dinner");
    const substitute = /\(with (.+)\)$/.exec(after?.dishName ?? "")?.[1] ?? "";
    const head = (pick.name.split(",")[0] ?? pick.name).trim();
    const [hh] = await sql<{ household_id: string }>(
      "SELECT household_id FROM plan_meal WHERE id = $1",
      [dinner.id],
    );
    const w: World = {
      state: JSON.stringify(await ctx.storageState()),
      plateId: plate.id,
      replaced: [...new Set([pick.name, head, ...pick.aliases])],
      replacedSlug: pick.slug,
      substitute,
      householdId: hh?.household_id ?? "",
    };
    writeFileSync(WORLD_FILE, JSON.stringify(w));
    await ctx.close();
  });

  for (const v of VIEWPORTS) {
    test(`@G4 the Plate's "Why this dinner" after a substitution at ${v.name} px`, async ({
      browser,
    }) => {
      const w = world();
      const ctx = await contextFor(browser, w.state, v);
      const page = await ctx.newPage();
      await page.goto(`/today/plates/${w.plateId}`);
      const why = page.getByRole("region", { name: "Why this dinner" });
      await expect(why).toBeVisible({ timeout: 120_000 });
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`(with ${w.substitute})`);
      const reasons = await why.locator("span").allInnerTexts();
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasonProblems(reasons, w)).toEqual([]);
      expect(await axeBoth(page, `plate ${v.name}`)).toEqual([]);
      await why.scrollIntoViewIfNeeded();
      await shot(page, `plate-after-substitution-${v.name}`);
      // Negative control: a reason naming the replaced ingredient is found by the same check.
      await why.evaluate((el, name) => {
        const s = document.createElement("span");
        s.textContent = `Also Levantine, like the lunch with ${name} before it`;
        el.appendChild(s);
      }, w.replaced[0] ?? "");
      const planted = await why.locator("span").allInnerTexts();
      expect(reasonProblems(planted, w).length).toBeGreaterThan(0);
      await ctx.close();
    });

    test(`@G4 /changelog names each subject, with before → after chips, at ${v.name} px`, async ({
      browser,
    }) => {
      const w = world();
      const ctx = await contextFor(browser, w.state, v);
      const page = await ctx.newPage();
      await page.goto("/changelog");
      const list = page.locator("ol li");
      await expect(list.first()).toBeVisible({ timeout: 120_000 });
      const titles = await page.locator("ol li span.font-extrabold").allInnerTexts();
      expect(logProblems(titles)).toEqual([]);
      const target = list.filter({ hasText: "Sara's protein target 130 → 140 g" });
      await expect(target.locator("del")).toHaveText("protein 130 g · calories 1655 kcal");
      await expect(target).toContainText("protein 140 g · calories 1695 kcal");
      const block = list.filter({ hasText: "Blocked Ravi (kitchen)" });
      await expect(
        block.getByRole("button", { name: "Undo: Blocked Ravi (kitchen)" }),
      ).toBeVisible();
      const settings = list.filter({ hasText: "Household settings: time zone" });
      await expect(settings.locator("del")).toContainText("time zone");
      await expect(settings).toContainText("time zone Europe/London");
      expect(await axeBoth(page, `changelog ${v.name}`)).toEqual([]);
      await shot(page, `changelog-${v.name}`);
      await ctx.close();
    });
  }

  test("@G4 negative control: the title-only rendering (stored summaries) fails the change-log check", async () => {
    const w = world();
    const rows = await sql<{ summary: string }>(
      "SELECT summary FROM change_set WHERE household_id = $1",
      [w.householdId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(logProblems(rows.map((r) => r.summary))).toHaveLength(LOG_TITLES.length);
  });

  test("@G4 negative control: axe reports a known-bad page", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await page.setContent(
      `<html lang="en"><body><main><p style="color:#ddd;background:#fff">Faint text</p>` +
        `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"></main></body></html>`,
    );
    expect((await seriousViolations(page)).length).toBeGreaterThan(0);
    await ctx.close();
  });
});
