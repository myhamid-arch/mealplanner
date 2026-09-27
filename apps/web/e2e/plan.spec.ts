// Leaf 1.4.4: Today, Plan, Plate, Recipes, Kitchen (against a real database and worker; the verify
// script starts both and passes DATABASE_URL, AUTH_SECRET and APP_URL to `next start`).
//   @G1  at 390 and 1280 px: plan a week, swap, lock (kept on regeneration), one-off shared /
//        individual override, cook sheet print view, and the Today / Plate / Recipes / Kitchen
//        screens; no horizontal scroll
//   @G2  axe-core: no serious or critical violations on every screen state, light and dark
//   @G3  R2-UX-1: a kitchen flag "ingredient unavailable" → substitution and plate re-solve,
//        checked through the API independently of the UI, and visible to admins
// Each gate has negative controls: the same check on a known-bad page or state must fail.
// W-4: no assertion names a dish; names are read from the page or the API at run time.
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test.describe.configure({ mode: "serial" });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 900 },
] as const;
type Viewport = (typeof VIEWPORTS)[number];

// World ----------------------------------------------------------------------------------------

interface Meal {
  id: string;
  date: string;
  slotKey: string;
  slotTypeId: string;
  memberScope: string;
  dishId: string;
  dishName: string;
  locked: boolean;
  status: string;
  attendees: string[];
  splitMembers: string[];
  plates: Array<{
    id: string;
    memberId: string;
    fitStatus: string;
    target: unknown;
    items: Array<{ componentId: string; variantId: string; cookedG: number }>;
  }>;
}
interface Day {
  date: string;
  status: string;
  meals: Meal[];
}

interface World {
  base: string;
  admin: APIRequestContext;
  states: Record<
    "admin" | "sara" | "kitchen",
    Awaited<ReturnType<APIRequestContext["storageState"]>>
  >;
  members: Record<"omar" | "sara" | "layla" | "adam" | "zayd", string>;
  today: string;
  /** A planned week per viewport for swap, lock and override; a free week each for "plan". */
  weekA: Record<string, string>;
  weekFree: Record<string, string>;
  ownDishId: string;
}

let world: World;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(date: string): string {
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -wd);
}
const week = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

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

async function plan(api: APIRequestContext, dates: string[]) {
  for (let i = 0; i < dates.length; i += 14) {
    const r = await json<{ jobId: string }>(
      await api.post("/api/v1/plans/generate", {
        data: { dates: dates.slice(i, i + 14), seed: 1 },
      }),
      "generate",
    );
    await waitJob(api, r.jobId);
  }
}

async function days(api: APIRequestContext, from: string, to: string): Promise<Day[]> {
  return (
    await json<{ days: Day[] }>(await api.get(`/api/v1/plans?from=${from}&to=${to}`), "plans")
  ).days;
}

async function mealOf(
  api: APIRequestContext,
  date: string,
  slotKey: string,
  shared = true,
): Promise<Meal> {
  const m = (await days(api, date, date))[0]?.meals.find(
    (x) => x.slotKey === slotKey && (x.memberScope === "shared") === shared,
  );
  if (m === undefined) throw new Error(`no ${slotKey} meal on ${date}`);
  return m;
}

/** A household dish (a copy of a seed dish) so the admin-only Edit sheet can be reached. */
async function ownDish(api: APIRequestContext): Promise<string> {
  const list = await json<{
    dishes: Array<{ id: string; isAdjuster: boolean; householdId: string | null }>;
  }>(await api.get("/api/v1/dishes"), "dishes");
  const seed = list.dishes.find((d) => !d.isAdjuster && d.householdId === null);
  if (seed === undefined) throw new Error("no seed dish");
  const dish = await json<{
    name: string;
    description: string;
    slotKeys: string[];
    flavourTags: string[];
    isPackable: boolean;
    servedColdOk: boolean;
    cuisineKey: string;
    components: Array<{
      name: string;
      role: string;
      portioning: string;
      unitLabel: string | null;
      minServingG: number;
      maxServingG: number;
      defaultServingG: number;
      stepG: number;
      required: boolean;
      variants: Array<{
        methodKey: string;
        label: string;
        isDefault: boolean;
        steps: string[];
        cookTimeMin: number | null;
        notes: string | null;
        referenceBatchCookedG: number;
        ingredients: Array<{
          ingredientId: string;
          rawGPerBatch: number;
          roleNote: string | null;
          isAbsorbedOil: boolean;
          cookingLiquid: string | null;
        }>;
      }>;
    }>;
  }>(await api.get(`/api/v1/dishes/${seed.id}`), "dish");
  const methods = (
    await json<{ methods: Array<{ id: string; key: string }> }>(
      await api.get("/api/v1/methods"),
      "methods",
    )
  ).methods;
  const cuisines = (
    await json<{ cuisines: Array<{ id: string; key: string }> }>(
      await api.get("/api/v1/cuisines"),
      "cuisines",
    )
  ).cuisines;
  const id = crypto.randomUUID();
  await json(
    await api.post("/api/v1/change-sets", {
      data: {
        summary: "test: a household dish",
        ops: [
          {
            kind: "dish.create",
            payload: {
              id,
              name: `${dish.name} (house)`,
              slug: `house-${id.slice(0, 8)}`,
              description: dish.description,
              cuisineId: cuisines.find((x) => x.key === dish.cuisineKey)?.id,
              slotKeys: dish.slotKeys,
              flavourTags: dish.flavourTags,
              isPackable: dish.isPackable,
              servedColdOk: dish.servedColdOk,
              components: dish.components.map((comp) => ({
                name: comp.name,
                role: comp.role,
                portioning: comp.portioning,
                unitLabel: comp.unitLabel,
                minServingG: comp.minServingG,
                maxServingG: comp.maxServingG,
                defaultServingG: comp.defaultServingG,
                stepG: comp.stepG,
                required: comp.required,
                variants: comp.variants.map((v) => ({
                  methodId: methods.find((m) => m.key === v.methodKey)?.id,
                  label: v.label,
                  isDefault: v.isDefault,
                  steps: v.steps,
                  cookTimeMin: v.cookTimeMin,
                  notes: v.notes,
                  referenceBatchCookedG: v.referenceBatchCookedG,
                  ingredients: v.ingredients.map((i) => ({
                    ingredientId: i.ingredientId,
                    rawGPerBatch: i.rawGPerBatch,
                    roleNote: i.roleNote,
                    isAbsorbedOil: i.isAbsorbedOil,
                    cookingLiquid: i.cookingLiquid,
                  })),
                })),
              })),
            },
          },
        ],
      },
    }),
    "dish.create",
  );
  return id;
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
  const members = {
    omar: crypto.randomUUID(),
    sara: crypto.randomUUID(),
    layla: crypto.randomUUID(),
    adam: crypto.randomUUID(),
    zayd: crypto.randomUUID(),
  };
  const member = (
    id: string,
    displayName: string,
    color: string,
    birthYear: number,
    isTargeted: boolean,
    appetite: string,
  ) => ({
    kind: "member.create",
    payload: { id, displayName, color, birthYear, isTargeted, appetite },
  });
  // F1 (BLD-2): two targeted adults, three untargeted children, the youngest allergic to sesame.
  await json(
    await admin.post("/api/v1/change-sets", {
      data: {
        summary: "test setup (F1)",
        ops: [
          member(members.omar, "Omar", "sea", 1985, true, "large"),
          member(members.sara, "Sara", "aubergine", 1987, true, "medium"),
          member(members.layla, "Layla", "pomegranate", 2008, false, "large"),
          member(members.adam, "Adam", "saffron", 2011, false, "large"),
          member(members.zayd, "Zayd", "basil", 2016, false, "medium"),
          {
            kind: "target.set",
            payload: {
              memberId: members.omar,
              kind: "default",
              profile: { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70, satFatMaxG: 22 },
            },
          },
          {
            kind: "target.set",
            payload: {
              memberId: members.sara,
              kind: "default",
              profile: { kcal: 1655, proteinG: 130, carbsG: 160, fatG: 55, satFatMaxG: 18 },
            },
          },
          // F1 training (BLD-2): Omar Mon/Wed/Fri 18:00 with a training-day profile; Sara
          // Tue/Thu/Sat 07:00 on her default profile.
          {
            kind: "target.set",
            payload: {
              memberId: members.omar,
              kind: "training",
              profile: { kcal: 2390, proteinG: 180, carbsG: 260, fatG: 70, satFatMaxG: 22 },
            },
          },
          {
            kind: "training.set",
            payload: {
              memberId: members.omar,
              days: [0, 2, 4].map((weekday) => ({ weekday, sessionTime: "18:00:00" })),
            },
          },
          {
            kind: "training.set",
            payload: {
              memberId: members.sara,
              days: [1, 3, 5].map((weekday) => ({ weekday, sessionTime: "07:00:00" })),
            },
          },
          {
            kind: "exclusion.add",
            payload: {
              memberId: members.zayd,
              kind: "dietary_flag",
              key: "contains_sesame",
              reason: "allergy",
              hard: true,
            },
          },
        ],
      },
    }),
    "setup",
  );
  const join = async (role: string, memberId: string | null, name: string) => {
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
  const saraState = await join("member", members.sara, "Sara");
  const kitchenState = await join("kitchen", null, "Priya");
  const hh = await json<{ timezone: string }>(
    await admin.get("/api/v1/households/current"),
    "household",
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: hh.timezone }).format(new Date());
  const monday = mondayOf(today);
  const weekA = { "390": addDays(monday, 7), "1280": addDays(monday, 14) };
  const weekFree = { "390": addDays(monday, 21), "1280": addDays(monday, 28) };
  // The household dish first: its change set's follow-ups (nutrition, graph, plates.resolve) run
  // before any plan exists, so they do not re-solve the plates the tests look at.
  const ownDishId = await ownDish(admin);
  await expect
    .poll(
      async () =>
        (
          await json<{ components: Array<{ variants: Array<{ per100gCooked: unknown }> }> }>(
            await admin.get(`/api/v1/dishes/${ownDishId}`),
            "own dish",
          )
        ).components.every((comp) => comp.variants.every((v) => v.per100gCooked !== null)),
      { timeout: 120_000 },
    )
    .toBe(true);
  await plan(admin, [
    ...week(monday).filter((d) => d >= today),
    ...week(weekA["390"]),
    ...week(weekA["1280"]),
  ]);
  world = {
    base,
    admin,
    states: { admin: await admin.storageState(), sara: saraState, kitchen: kitchenState },
    members,
    today,
    weekA,
    weekFree,
    ownDishId,
  };
});

test.afterAll(async () => {
  await world.admin.dispose();
});

async function as(
  browser: Browser,
  who: keyof World["states"],
  v: Viewport,
  dark = false,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    storageState: world.states[who],
    viewport: { width: v.width, height: v.height },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Problems with horizontal scrolling (the layout must fit the viewport). */
async function scrollProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const w = window.innerWidth;
    if (document.documentElement.scrollWidth > w)
      out.push(
        `page is ${String(document.documentElement.scrollWidth)} px wide at ${String(w)} px`,
      );
    if (document.body.scrollWidth > w)
      out.push(`body is ${String(document.body.scrollWidth)} px wide`);
    return out;
  });
}
async function expectFits(page: Page, where: string) {
  expect(await scrollProblems(page), `${where}: horizontal scroll`).toEqual([]);
}

async function loaded(page: Page) {
  await expect(page.locator("[data-loading]")).toHaveCount(0, { timeout: 60_000 });
}

/** A plan job started from the page has finished: any earlier "ready" message goes, then returns. */
async function planReady(page: Page) {
  await expect(page.getByText("The plan is ready.")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText("The plan is ready.")).toBeVisible({ timeout: 300_000 });
}

async function openCell(page: Page, date: string, slotKey: string) {
  await page.getByTestId(`cell-${date}-${slotKey}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Did the swap reach the plan? The meal serves `name` in the API and the cell shows it. */
async function swapTookEffect(
  page: Page,
  mealId: string,
  date: string,
  slotKey: string,
  name: string,
): Promise<boolean> {
  const meal = await json<{ dishName: string }>(
    await world.admin.get(`/api/v1/plan-meals/${mealId}`),
    "meal",
  );
  const cell = (await page.getByTestId(`cell-${date}-${slotKey}`).textContent()) ?? "";
  return meal.dishName === name && cell.includes(name);
}

// Print ---------------------------------------------------------------------------------------

interface PrintFacts {
  chromeVisible: string[];
  meals: number;
  breaks: string[];
  a4: boolean;
  bannerVisible: boolean;
}

async function printFacts(page: Page): Promise<PrintFacts> {
  return page.evaluate(() => {
    const visible = (el: Element | null) =>
      el !== null &&
      getComputedStyle(el).display !== "none" &&
      (el as HTMLElement).offsetParent !== null;
    const chrome = [
      'nav[aria-label="Main"]',
      'nav[aria-label="Tabs"]',
      '[data-testid="flag-bar"]',
      ".kitchen-controls",
    ].filter((sel) => [...document.querySelectorAll(sel)].some((el) => visible(el)));
    const meals = [...document.querySelectorAll('[data-testid="cook-meal"]')];
    let a4 = false;
    for (const sheet of [...document.styleSheets])
      for (const rule of [...(sheet.cssRules as unknown as CSSRule[])])
        if (rule instanceof CSSPageRule && /A4/i.test(rule.style.getPropertyValue("size")))
          a4 = true;
    return {
      chromeVisible: chrome,
      meals: meals.filter((m) => getComputedStyle(m).display !== "none").length,
      breaks: meals.map((m) => getComputedStyle(m).breakAfter),
      a4,
      bannerVisible: [...document.querySelectorAll('[data-testid="cook-meal"]')].every((m) =>
        /weigh/i.test(m.textContent),
      ),
    };
  });
}

function printProblems(f: PrintFacts, total: number): string[] {
  const out: string[] = [];
  if (f.chromeVisible.length > 0) out.push(`visible in print: ${f.chromeVisible.join(", ")}`);
  if (f.meals !== total) out.push(`${String(f.meals)} of ${String(total)} meals print`);
  if (!f.a4) out.push("no @page A4 rule");
  if (!f.bannerVisible) out.push("a meal prints without the weigh-and-measure banner");
  f.breaks.forEach((b, i) => {
    const want = i === f.breaks.length - 1 ? ["auto", ""] : ["page"];
    if (!want.includes(b)) out.push(`meal ${String(i + 1)} breaks "${b}"`);
  });
  return out;
}

// G1 ---------------------------------------------------------------------------------------------

for (const v of VIEWPORTS) {
  test(`@G1 plan a week at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(420_000);
    const monday = world.weekFree[v.name] ?? "";
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/plan?week=${monday}`);
    await expect(page.getByRole("heading", { name: "No plan for this week yet" })).toBeVisible({
      timeout: 60_000,
    });
    await expectFits(page, "empty week");
    await page.getByRole("button", { name: "Plan this week" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Planning|Planned|Saving|Started/ })
        .first(),
    ).toBeVisible();
    await expect(page.getByText("The plan is ready.")).toBeVisible({ timeout: 300_000 });
    const planned = await days(world.admin, monday, addDays(monday, 6));
    expect(planned.map((d) => d.date)).toEqual(week(monday));
    for (const d of planned) {
      for (const slotKey of new Set(d.meals.map((m) => m.slotKey)))
        await expect(page.getByTestId(`cell-${d.date}-${slotKey}`)).toBeVisible();
    }
    await expect(page.getByText("SHARED").first()).toBeVisible();
    await expect(page.getByText("INDIVIDUAL").first()).toBeVisible();
    await expect(page.getByTestId("week-status")).toHaveText("Draft · not sent to kitchen");
    // The header strip against figures computed here from the API.
    const sheets = await Promise.all(
      week(monday).map(async (d) =>
        json<{
          meals: Array<{
            cuisineKey: string;
            batches: Array<{ raw: Array<{ ingredientId: string; rawG: number }> }>;
          }>;
        }>(await world.admin.get(`/api/v1/cook-sheets/${d}`), "sheet"),
      ),
    );
    const ingredients = new Set(
      sheets.flatMap((s) =>
        s.meals.flatMap((m) =>
          m.batches.flatMap((b) => b.raw.filter((r) => r.rawG > 0).map((r) => r.ingredientId)),
        ),
      ),
    );
    const cuisines = new Set(sheets.flatMap((s) => s.meals.map((m) => m.cuisineKey)));
    const plates = planned
      .flatMap((d) => d.meals.flatMap((m) => m.plates.map((p) => p.fitStatus)))
      .filter((s) => s !== "untargeted");
    const pct = Math.round(
      (plates.filter((s) => s === "in_tolerance").length / plates.length) * 100,
    );
    await expect(page.getByTestId("stat-ingredients")).toHaveText(
      `${String(ingredients.size)} different ingredients`,
    );
    await expect(page.getByTestId("stat-on-target")).toHaveText(
      `${String(pct)}% targeted meals on target`,
    );
    await expect(page.getByTestId("stat-cuisines")).toHaveText(
      `${String(cuisines.size)} cuisine${cuisines.size === 1 ? "" : "s"}`,
    );
    await expectFits(page, "planned week");
    // Send to kitchen (R-52): every draft day becomes published.
    await page.getByRole("button", { name: "Send to kitchen" }).click();
    await expect(page.getByTestId("week-status")).toHaveText("Sent to kitchen");
    expect(
      (await days(world.admin, monday, addDays(monday, 6))).every((d) => d.status === "published"),
    ).toBe(true);
    await ctx.close();
  });

  test(`@G1 swap a meal at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const date = addDays(world.weekA[v.name] ?? "", 1);
    const meal = await mealOf(world.admin, date, "dinner");
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/plan?week=${date}`);
    await openCell(page, date, "dinner");
    await page.getByRole("button", { name: "Swap" }).first().click();
    const sheet = page.getByRole("dialog", { name: `Swap ${meal.dishName}` });
    await expect(sheet).toBeVisible();
    const alts = sheet.getByTestId("alternative");
    await expect(alts.first()).toBeVisible({ timeout: 60_000 });
    const n = await alts.count();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(5);
    await expect(alts.first().getByRole("meter", { name: "Macros" })).toBeVisible();
    await expect(alts.first().getByRole("meter", { name: "Appeal" })).toBeVisible();
    await expect(alts.first().getByRole("meter", { name: "Economy" })).toBeVisible();
    await expect(sheet.getByText(/^Now: /)).toBeVisible();
    await expectFits(page, "swap sheet");
    const name = ((await alts.first().getByTestId("alternative-name").textContent()) ?? "").trim();
    await alts
      .first()
      .getByRole("button", { name: `Use ${name}` })
      .click();
    await expect(sheet).toBeHidden({ timeout: 60_000 });
    await expect
      .poll(() => swapTookEffect(page, meal.id, date, "dinner", name), { timeout: 30_000 })
      .toBe(true);
    await ctx.close();
  });

  test(`@G1 lock keeps a meal through regeneration at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(420_000);
    const monday = world.weekA[v.name] ?? "";
    const date = addDays(monday, 2);
    const meal = await mealOf(world.admin, date, "lunch");
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/plan?week=${monday}`);
    await openCell(page, date, "lunch");
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Locked", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId(`cell-${date}-lunch`).getByRole("img", { name: "Locked" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Regenerate unlocked" }).click();
    await expect(page.getByText("The plan is ready.")).toBeVisible({ timeout: 300_000 });
    const after = await mealOf(world.admin, date, "lunch");
    expect(after.id).toBe(meal.id);
    expect(after.dishId).toBe(meal.dishId);
    expect(after.locked).toBe(true);
    await expect(page.getByTestId(`cell-${date}-lunch`)).toContainText(meal.dishName);
    await openCell(page, date, "lunch");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("dialog").getByText("Locked", { exact: true })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId(`cell-${date}-lunch`).getByRole("img", { name: "Locked" }),
    ).toHaveCount(0);
    expect((await mealOf(world.admin, date, "lunch")).locked).toBe(false);
    await ctx.close();
  });

  test(`@G1 one-off shared / individual override at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(600_000);
    const monday = world.weekA[v.name] ?? "";
    const wed = addDays(monday, 2);
    const thu = addDays(monday, 3);
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/plan?week=${monday}`);
    // (a) Take Omar out of Wednesday's shared dinner.
    await openCell(page, wed, "dinner");
    await page.getByRole("button", { name: "Swap" }).first().click();
    const sheet = page.getByRole("dialog", { name: /^Swap / });
    await sheet
      .getByRole("group", { name: "People at this meal" })
      .getByRole("button", { name: "Omar" })
      .click();
    await sheet.getByRole("button", { name: "Give Omar their own dish" }).click();
    await page.getByRole("button", { name: "Re-plan Wednesday" }).click();
    await planReady(page);
    await expect(page.getByTestId(`cell-${wed}-dinner`)).toContainText("+ Omar: own dish");
    const shared = await mealOf(world.admin, wed, "dinner");
    expect(shared.splitMembers).toEqual([world.members.omar]);
    const own = (await days(world.admin, wed, wed))[0]?.meals.find(
      (m) => m.slotKey === "dinner" && m.memberScope === world.members.omar,
    );
    expect(own, "Omar has his own dinner").toBeDefined();
    // (b) Make Thursday's dinner individual.
    await openCell(page, thu, "dinner");
    await page.getByRole("button", { name: "Swap" }).first().click();
    await page
      .getByRole("dialog", { name: /^Swap / })
      .getByRole("button", { name: "Make the whole meal individual" })
      .click();
    await page.getByRole("button", { name: "Re-plan Thursday" }).click();
    await planReady(page);
    const thuMeals =
      (await days(world.admin, thu, thu))[0]?.meals.filter((m) => m.slotKey === "dinner") ?? [];
    expect(thuMeals.some((m) => m.memberScope === "shared")).toBe(false);
    expect(thuMeals.length).toBe(5);
    await expect(page.getByTestId(`cell-${thu}-dinner`)).toContainText("5 dishes");
    // And back: one shared dinner on Thursday again.
    await openCell(page, thu, "dinner");
    await page.getByRole("button", { name: "One-off change on Thursday" }).click();
    await page.getByRole("button", { name: "Back to one shared dish" }).click();
    await page.getByRole("button", { name: "Re-plan Thursday" }).click();
    await planReady(page);
    expect((await mealOf(world.admin, thu, "dinner")).memberScope).toBe("shared");
    await expectFits(page, "week after overrides");
    await ctx.close();
  });

  test(`@G1 cook sheet print view at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const date = world.weekA[v.name] ?? "";
    const sheet = await json<{ meals: unknown[] }>(
      await world.admin.get(`/api/v1/cook-sheets/${date}`),
      "sheet",
    );
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/kitchen?date=${date}`);
    await expect(page.getByRole("heading", { name: "Plating table" }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("allergy-banner").first()).toContainText("Zayd");
    await expectFits(page, "cook sheet");
    await page.emulateMedia({ media: "print" });
    const facts = await printFacts(page);
    expect(printProblems(facts, sheet.meals.length)).toEqual([]);
    const pdf = await page.pdf({ format: "A4" });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages, "at least one A4 page per meal").toBeGreaterThanOrEqual(sheet.meals.length);
    await ctx.close();
  });

  test(`@G1 today, plate, recipes and kitchen at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const date = world.weekA[v.name] ?? "";
    // Member: her own day, plates in time order, ring and P/C/F; the plate page with total carbs.
    {
      const { ctx, page } = await as(browser, "sara", v);
      await page.goto("/");
      await expect(page).toHaveURL(/\/today$/);
      await page.goto(`/today?date=${date}`);
      await expect(page.getByRole("heading", { name: "Hi Sara" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("img", { name: /^Day total \d+ of \d+ kcal/ })).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Your meals" }).getByTestId("slot-card"),
      ).not.toHaveCount(0);
      await expect(page.getByRole("list", { name: "Kitchen flags" })).toHaveCount(0);
      await expectFits(page, "member today");
      await page.getByRole("list", { name: "Your meals" }).getByRole("link").first().click();
      await expect(page).toHaveURL(/\/today\/plates\//);
      await expect(page.getByRole("meter", { name: "Carbs g (total)" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByRole("meter", { name: "Calories" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Rate this meal" })).toHaveAttribute(
        "href",
        /^\/reviews\/new\?planMealId=/,
      );
      await expectFits(page, "plate");
      await ctx.close();
    }
    // Admin: the household day; a child's plate shows portions, no target bars (R-28).
    {
      const { ctx, page } = await as(browser, "admin", v);
      await page.goto(`/today?date=${date}`);
      if (v.width >= 1024) {
        await expect(page.getByRole("table", { name: "Everyone's day" })).toBeVisible({
          timeout: 60_000,
        });
        await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
        await expect(page.getByRole("row", { name: /Zayd/ })).toContainText("No targets");
      } else {
        await expect(page.getByRole("heading", { name: "Hi Omar" })).toBeVisible({
          timeout: 60_000,
        });
      }
      await expect(page.getByRole("heading", { name: "Kitchen", exact: true })).toBeVisible();
      await expectFits(page, "admin today");
      const dinner = await mealOf(world.admin, date, "dinner");
      const kid = dinner.plates.find((p) => p.memberId === world.members.zayd);
      expect(kid).toBeDefined();
      await page.goto(`/today/plates/${kid?.id ?? ""}`);
      await expect(page.getByText("Zayd has no macro targets")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("meter")).toHaveCount(0);
      await expectFits(page, "child plate");
      // Recipes: grid, a filter, the recipe page's variant tabs by keyboard.
      await page.goto("/recipes");
      const cards = page.getByTestId("recipe-card");
      await expect(cards.first()).toBeVisible({ timeout: 60_000 });
      const all = await cards.count();
      await page.getByRole("button", { name: "Packable" }).click();
      await expect(page).toHaveURL(/packable=1/);
      await expect.poll(() => cards.count()).toBeLessThan(all);
      await expectFits(page, "recipe library");
      await page.goto(`/recipes/${dinner.dishId}`);
      await expect(page.getByRole("heading", { level: 1, name: dinner.dishName })).toBeVisible({
        timeout: 60_000,
      });
      const tabs = page.getByRole("tab");
      if ((await tabs.count()) > 1) {
        const first = page.getByRole("tablist").first().getByRole("tab").first();
        await first.focus();
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("tablist").first().getByRole("tab").nth(1)).toHaveAttribute(
          "aria-selected",
          "true",
        );
      }
      await expect(page.getByText("Ingredients · for 1 kg cooked").first()).toBeAttached();
      await expectFits(page, "recipe page");
      await ctx.close();
    }
    // Kitchen: lands on Kitchen; marks a meal cooked and back (R-52).
    {
      const { ctx, page } = await as(browser, "kitchen", v);
      await page.goto("/");
      await expect(page).toHaveURL(/\/kitchen$/);
      const dinner = await mealOf(world.admin, date, "dinner");
      await page.goto(`/kitchen?date=${date}&meal=${dinner.id}`);
      const article = page.getByRole("article", {
        name: new RegExp(`${dinner.dishName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      });
      await expect(article).toBeVisible({ timeout: 60_000 });
      await article.getByRole("button", { name: "Mark cooked" }).click();
      await expect(article.getByText("Cooked", { exact: true })).toBeVisible();
      expect((await mealOf(world.admin, date, "dinner")).status).toBe("cooked");
      await article.getByRole("button", { name: "Not cooked yet" }).click();
      await expect(article.getByRole("button", { name: "Mark cooked" })).toBeVisible();
      await page.getByRole("button", { name: "Large text" }).click();
      await expect(page.getByRole("button", { name: "Large text" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expectFits(page, "kitchen large text");
      await page.getByRole("button", { name: "Large text" }).click();
      await ctx.close();
    }
  });
}

for (const v of VIEWPORTS)
  test(`@G1 day targets and the week's training days follow F1 at ${v.name} px`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const monday = world.weekA[v.name] ?? "";
    const sunday = addDays(monday, 6);
    // The week header: Omar trains Mon/Wed/Fri, Sara Tue/Thu/Sat, nobody on Sunday (weekday 0 =
    // Monday, R-24).
    {
      const { ctx, page } = await as(browser, "admin", v);
      await page.goto(`/plan?week=${monday}`);
      const expected = [
        "O trains",
        "S trains",
        "O trains",
        "S trains",
        "O trains",
        "S trains",
        "rest",
      ];
      for (const [i, text] of expected.entries())
        await expect(page.getByTestId(`day-head-${addDays(monday, i)}`)).toContainText(text, {
          timeout: 60_000,
        });
      // The admin's day grid: Omar's day target is his rest-day 2150 and training-day 2390 (R-28).
      if (v.width >= 1024) {
        await page.goto(`/today?date=${sunday}`);
        await expect(page.getByRole("row", { name: /Omar/ })).toContainText("/ 2150 kcal", {
          timeout: 60_000,
        });
        await expect(page.getByRole("row", { name: /Sara/ })).toContainText("/ 1655 kcal");
        await page.goto(`/today?date=${monday}`);
        await expect(page.getByRole("row", { name: /Omar/ })).toContainText("/ 2390 kcal", {
          timeout: 60_000,
        });
      }
      await ctx.close();
    }
    // A member without schedule access: Sara's ring shows her day target (default profile only).
    {
      const { ctx, page } = await as(browser, "sara", v);
      for (const date of [sunday, addDays(monday, 1)]) {
        await page.goto(`/today?date=${date}`);
        await expect(page.getByRole("img", { name: /^Day total \d+ of 1655 kcal/ })).toBeVisible({
          timeout: 60_000,
        });
      }
      await ctx.close();
    }
  });

test("@G1 negative control: a page wider than the viewport is reported", async ({ browser }) => {
  const { ctx, page } = await as(browser, "admin", VIEWPORTS[0]);
  await page.goto(`/today`);
  await loaded(page);
  await page.evaluate(() => {
    const wide = document.createElement("div");
    wide.style.width = "1600px";
    wide.style.height = "10px";
    document.body.appendChild(wide);
  });
  expect(await scrollProblems(page)).not.toEqual([]);
  await ctx.close();
});

test("@G1 negative control: the print check fails without the print stylesheet", async ({
  browser,
}) => {
  const date = world.weekA["1280"] ?? "";
  const sheet = await json<{ meals: unknown[] }>(
    await world.admin.get(`/api/v1/cook-sheets/${date}`),
    "sheet",
  );
  const { ctx, page } = await as(browser, "admin", VIEWPORTS[1]);
  await page.goto(`/kitchen?date=${date}`);
  await expect(page.getByRole("heading", { name: "Plating table" }).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() => {
    for (const s of [...document.querySelectorAll("style")])
      if (/@page/.test(s.textContent)) s.remove();
  });
  await page.emulateMedia({ media: "print" });
  expect(printProblems(await printFacts(page), sheet.meals.length)).not.toEqual([]);
  await ctx.close();
});

test("@G1 negative control: a swap the server did not apply is not reported as done", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const date = addDays(world.weekA["1280"] ?? "", 4);
  const meal = await mealOf(world.admin, date, "dinner");
  const { ctx, page } = await as(browser, "admin", VIEWPORTS[1]);
  // The swap request is answered with the unchanged meal and never reaches the server.
  const current: unknown = await json(
    await world.admin.get(`/api/v1/plan-meals/${meal.id}`),
    "meal",
  );
  await page.route("**/api/v1/plan-meals/*/swap", async (route) => {
    await route.fulfill({ status: 200, json: { changeSetId: crypto.randomUUID(), meal: current } });
  });
  await page.goto(`/plan?week=${date}`);
  await openCell(page, date, "dinner");
  await page.getByRole("button", { name: "Swap" }).first().click();
  const alts = page.getByTestId("alternative");
  await expect(alts.first()).toBeVisible({ timeout: 60_000 });
  const name = ((await alts.first().getByTestId("alternative-name").textContent()) ?? "").trim();
  await alts
    .first()
    .getByRole("button", { name: `Use ${name}` })
    .click();
  await page.waitForTimeout(2000);
  expect(await swapTookEffect(page, meal.id, date, "dinner", name)).toBe(false);
  await ctx.close();
});

// G2 ---------------------------------------------------------------------------------------------

async function axe(page: Page, where: string, extra: string[] = []) {
  // Sheets and cards animate in; colours are measured once the finite animations have ended.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const result = await new AxeBuilder({ page }).analyze();
  const bad = result.violations.filter((x) => x.impact === "serious" || x.impact === "critical");
  const detail = bad.map(
    (x) =>
      `${x.id} (${String(x.impact)}): ${x.nodes
        .map((n) => n.target.join(" "))
        .slice(0, 5)
        .join(" | ")}`,
  );
  expect(detail, `${where}${extra.length === 0 ? "" : ` [${extra.join(", ")}]`}`).toEqual([]);
}

for (const v of VIEWPORTS)
  test(`@G2 axe on every screen of the leaf at ${v.name} px, light and dark`, async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const date = world.weekA[v.name] ?? "";
    const dinner = await mealOf(world.admin, date, "dinner");
    for (const dark of [false, true]) {
      const theme = dark ? "dark" : "light";
      {
        const { ctx, page } = await as(browser, "admin", v, dark);
        const visit = async (path: string, ready: () => Promise<void>, label: string) => {
          await page.goto(path);
          await ready();
          await axe(page, `${label} ${v.name} ${theme}`);
        };
        await visit(
          `/today?date=${date}`,
          () =>
            expect(page.getByRole("heading", { name: "Kitchen", exact: true })).toBeVisible({
              timeout: 60_000,
            }),
          "today (admin)",
        );
        const kid = (await mealOf(world.admin, date, "dinner")).plates.find(
          (p) => p.memberId === world.members.zayd,
        );
        await visit(
          `/today/plates/${kid?.id ?? ""}`,
          () => expect(page.getByText("has no macro targets")).toBeVisible({ timeout: 60_000 }),
          "child plate",
        );
        await visit(
          `/plan?week=${date}`,
          () => expect(page.getByTestId(`cell-${date}-dinner`)).toBeVisible({ timeout: 60_000 }),
          "week",
        );
        await openCell(page, date, "dinner");
        await axe(page, `meal sheet ${v.name} ${theme}`);
        await page.getByRole("button", { name: "Swap" }).first().click();
        await expect(page.getByTestId("alternative").first()).toBeVisible({ timeout: 60_000 });
        await axe(page, `swap sheet ${v.name} ${theme}`);
        await page.getByRole("button", { name: "Make the whole meal individual" }).click();
        await expect(page.getByRole("dialog", { name: /^Re-plan/ })).toBeVisible();
        await axe(page, `override confirmation ${v.name} ${theme}`);
        await page.getByRole("button", { name: "Cancel" }).click();
        await visit(
          "/recipes?packable=1",
          () => expect(page.getByTestId("recipe-card").first()).toBeVisible({ timeout: 60_000 }),
          "recipes (filtered)",
        );
        await visit(
          `/recipes/${dinner.dishId}`,
          () => expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 }),
          "recipe page",
        );
        const tabs = page.getByRole("tab");
        if ((await tabs.count()) > 1) {
          await tabs.nth(1).click();
          await axe(page, `recipe page second variant ${v.name} ${theme}`);
        }
        await visit(
          `/recipes/${world.ownDishId}`,
          () => expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 60_000 }),
          "household recipe",
        );
        await page.getByRole("button", { name: "Edit" }).click();
        await expect(page.getByRole("dialog", { name: /^Edit / })).toBeVisible();
        await axe(page, `edit sheet ${v.name} ${theme}`);
        await page.keyboard.press("Escape");
        await visit(
          `/kitchen?date=${date}`,
          () =>
            expect(page.getByRole("heading", { name: "Plating table" }).first()).toBeVisible({
              timeout: 60_000,
            }),
          "cook sheet",
        );
        await page.getByRole("button", { name: "Large text" }).click();
        await axe(page, `cook sheet large text ${v.name} ${theme}`);
        await page.getByRole("button", { name: "Large text" }).click();
        await page.getByRole("button", { name: "Flag an ingredient" }).first().click();
        await expect(page.getByRole("dialog", { name: "Flag an ingredient" })).toBeVisible();
        await axe(page, `flag dialog ${v.name} ${theme}`);
        await ctx.close();
      }
      {
        const { ctx, page } = await as(browser, "sara", v, dark);
        await page.goto(`/today?date=${date}`);
        await expect(page.getByRole("heading", { name: "Hi Sara" })).toBeVisible({
          timeout: 60_000,
        });
        await axe(page, `today (member) ${v.name} ${theme}`);
        const mine = (await mealOf(world.admin, date, "dinner")).plates.find(
          (p) => p.memberId === world.members.sara,
        );
        await page.goto(`/today/plates/${mine?.id ?? ""}`);
        await expect(page.getByRole("meter", { name: "Calories" })).toBeVisible({
          timeout: 60_000,
        });
        await axe(page, `plate (member) ${v.name} ${theme}`);
        await page.goto(`/plan?week=${date}`);
        await expect(page.getByTestId(`cell-${date}-dinner`)).toBeVisible({ timeout: 60_000 });
        await axe(page, `week (member) ${v.name} ${theme}`);
        await ctx.close();
      }
    }
  });

test("@G2 negative control: axe reports an unlabelled image and button on a bad page", async ({
  page,
}) => {
  await page.setContent(`<!doctype html><html lang="en"><body style="background:#FFF8EE">
    <main><h1>Bad</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button><svg width="20" height="20"></svg></button>
    <p style="color:#E9DCC8">low contrast text</p></main></body></html>`);
  const result = await new AxeBuilder({ page }).analyze();
  const bad = result.violations.filter((x) => x.impact === "serious" || x.impact === "critical");
  expect(bad.map((x) => x.id)).toEqual(
    expect.arrayContaining(["image-alt", "button-name", "color-contrast"]),
  );
});

// G3 ---------------------------------------------------------------------------------------------

interface FlagView {
  reviewId: string;
  kind: string;
  ingredientName: string | null;
  note: string | null;
  job: { status: string } | null;
  result: {
    substituteId?: string | null;
    substituteName: string | null;
    meals: Array<{
      planMealId: string;
      date: string;
      slotLabel: string;
      fromDishName: string;
      toDishName: string;
    }>;
    unresolved: string[];
  } | null;
}

/** Catalogue substitutes (data/substitutes.csv): from-slug → number of candidates. */
function substituteCounts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of readFileSync(join(ROOT, "data/substitutes.csv"), "utf8")
    .split("\n")
    .slice(1)) {
    const from = line.split(",")[0]?.trim();
    if (from !== undefined && from !== "") out.set(from, (out.get(from) ?? 0) + 1);
  }
  return out;
}

/** Meals from `date` on (a week) whose plates still serve the ingredient: its variants' lines. */
async function stillServed(
  api: APIRequestContext,
  date: string,
  ingredientId: string,
  meals: Meal[],
): Promise<string[]> {
  const out: string[] = [];
  const dishes = new Map<
    string,
    {
      components: Array<{
        variants: Array<{ id: string; ingredients: Array<{ ingredientId: string }> }>;
      }>;
    }
  >();
  for (const m of meals) {
    if (m.date < date) continue;
    if (!dishes.has(m.dishId))
      dishes.set(m.dishId, await json(await api.get(`/api/v1/dishes/${m.dishId}`), "dish"));
    const dish = dishes.get(m.dishId);
    const variants = new Map(
      dish?.components.flatMap((comp) => comp.variants.map((v) => [v.id, v] as const)) ?? [],
    );
    const served = new Set(
      m.plates.flatMap((p) => p.items.filter((i) => i.cookedG > 0).map((i) => i.variantId)),
    );
    if (
      [...served].some(
        (id) => variants.get(id)?.ingredients.some((i) => i.ingredientId === ingredientId) === true,
      )
    )
      out.push(m.id);
  }
  return out;
}

/** Is the flag's outcome on the admin's page: who, what, the substitute and each changed meal? */
async function outcomeVisible(page: Page, flag: FlagView): Promise<string[]> {
  const card = page.getByRole("list", { name: "Kitchen flags" });
  const text = (await card.count()) === 0 ? "" : ((await card.first().textContent()) ?? "");
  const missing: string[] = [];
  if (!text.includes("Flag from Priya")) missing.push("author");
  if (
    flag.ingredientName !== null &&
    !text.toLowerCase().includes(`no ${flag.ingredientName.toLowerCase()} today`)
  )
    missing.push("ingredient");
  if (flag.note !== null && !text.includes(flag.note)) missing.push("note");
  const sub = flag.result?.substituteName;
  if (sub === undefined || sub === null || !text.includes(`Using ${sub} instead`))
    missing.push("substitute");
  if (!text.includes("Macros re-checked")) missing.push("re-check");
  for (const m of flag.result?.meals ?? [])
    if (!text.includes(`${m.fromDishName} → ${m.toDishName}`)) missing.push(`meal ${m.slotLabel}`);
  if ((flag.result?.meals.length ?? 0) === 0) missing.push("changed meals");
  return missing;
}

test("@G3 kitchen flags an unavailable ingredient; substitution and re-solve reach the admins", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const date = world.weekA["390"] ?? "";
  const before = (await days(world.admin, date, addDays(date, 6))).flatMap((d) => d.meals);
  const sheet = await json<{
    meals: Array<{
      planMealId: string;
      slotKey: string;
      batches: Array<{ raw: Array<{ ingredientId: string; slug: string }> }>;
    }>;
  }>(await world.admin.get(`/api/v1/cook-sheets/${date}`), "sheet");
  const dinner = sheet.meals.find((m) => m.slotKey === "dinner");
  if (dinner === undefined) throw new Error("no dinner to cook");
  // The dinner ingredient with the most catalogue substitutes (read at run time, W-4).
  const counts = substituteCounts();
  const raw = dinner.batches.flatMap((b) => b.raw).filter((r) => counts.has(r.slug));
  raw.sort(
    (a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0) || a.slug.localeCompare(b.slug),
  );
  const target = raw[0];
  if (target === undefined) throw new Error("no dinner ingredient has a catalogue substitute");
  expect(
    await stillServed(world.admin, date, target.ingredientId, before),
    "negative control: before the flag the dinner serves it",
  ).toContain(dinner.planMealId);

  // Kitchen: flag it on the cook sheet.
  const k = await as(browser, "kitchen", VIEWPORTS[1]);
  await k.page.goto(`/kitchen?date=${date}&meal=${dinner.planMealId}`);
  const article = k.page.getByTestId("cook-meal").filter({ visible: true }).first();
  await expect(article).toBeVisible({ timeout: 60_000 });
  await article.getByRole("button", { name: "Flag an ingredient" }).click();
  const dialog = k.page.getByRole("dialog", { name: "Flag an ingredient" });
  await dialog.getByLabel("Ingredient").selectOption(target.ingredientId);
  await dialog.getByLabel(/Note/).fill("None at the market today");
  await dialog.getByRole("button", { name: "Send flag" }).click();
  await expect(article.getByRole("status")).toContainText("Sent: no");

  // The worker substitutes; wait for the job through the admin's flag list.
  let flag: FlagView | undefined;
  await expect
    .poll(
      async () => {
        const flags = (
          await json<{ flags: FlagView[] }>(
            await world.admin.get(`/api/v1/cook-sheets/${date}/flags`),
            "flags",
          )
        ).flags;
        flag = flags.find((f) => f.kind === "unavailable");
        return flag?.job?.status ?? "none";
      },
      { timeout: 240_000, intervals: [1000] },
    )
    .toBe("succeeded");
  if (flag === undefined) throw new Error("flag not listed");
  expect(flag.result?.meals.length ?? 0, JSON.stringify(flag.result)).toBeGreaterThan(0);

  // Independently of the listing: no meal in the window still serves the ingredient (except any
  // the run reported as unresolved), the changed meals now serve the listed dish, and their
  // plates were re-solved (new plate ids).
  const after = (await days(world.admin, date, addDays(date, 6))).flatMap((d) => d.meals);
  const still = await stillServed(world.admin, date, target.ingredientId, after);
  expect(still.filter((id) => !(flag?.result?.unresolved ?? []).includes(id))).toEqual([]);
  for (const m of flag.result?.meals ?? []) {
    const now = after.find((x) => x.id === m.planMealId);
    const was = before.find((x) => x.id === m.planMealId);
    expect(now?.dishName).toBe(m.toDishName);
    expect(was?.dishName).toBe(m.fromDishName);
    const oldPlates = new Set(was?.plates.map((p) => p.id));
    expect(now?.plates.length ?? 0).toBeGreaterThan(0);
    expect(now?.plates.every((p) => !oldPlates.has(p.id) && p.fitStatus !== "")).toBe(true);
  }
  // The kitchen sees what happened to its flag.
  await k.page.reload();
  await expect(k.page.getByRole("list", { name: "Your flags today" }).first()).toContainText(
    `Use ${flag.result?.substituteName ?? ""}`,
    { timeout: 60_000 },
  );
  await k.ctx.close();

  // Admins see it on Today and the cook sheet, at both widths; members do not.
  for (const v of VIEWPORTS) {
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/today?date=${date}`);
    await expect(page.getByRole("list", { name: "Kitchen flags" })).toBeVisible({
      timeout: 60_000,
    });
    expect(await outcomeVisible(page, flag), `admin today ${v.name}`).toEqual([]);
    await page.goto(`/kitchen?date=${date}`);
    await expect(page.getByRole("list", { name: "Kitchen flags" })).toBeVisible({
      timeout: 60_000,
    });
    expect(await outcomeVisible(page, flag), `admin kitchen ${v.name}`).toEqual([]);
    await expectFits(page, `kitchen with flags ${v.name}`);
    await ctx.close();
  }
  const m = await as(browser, "sara", VIEWPORTS[1]);
  await m.page.goto(`/today?date=${date}`);
  await expect(m.page.getByRole("heading", { name: "Hi Sara" })).toBeVisible({ timeout: 60_000 });
  await expect(m.page.getByRole("list", { name: "Kitchen flags" })).toHaveCount(0);
  await m.ctx.close();
});

test("@G3 negative control: the admin view without the substitution result fails the check", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const date = world.weekA["390"] ?? "";
  const flags = (
    await json<{ flags: FlagView[] }>(
      await world.admin.get(`/api/v1/cook-sheets/${date}/flags`),
      "flags",
    )
  ).flags;
  const flag = flags.find((f) => f.kind === "unavailable");
  expect(flag?.result, "the G3 flag has a result to hide").not.toBeNull();
  const { ctx, page } = await as(browser, "admin", VIEWPORTS[1]);
  // The same page, served a listing where the job has not produced a result yet.
  await page.route(`**/api/v1/cook-sheets/${date}/flags`, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { flags: FlagView[] };
    await route.fulfill({
      response: res,
      json: {
        flags: body.flags.map((f) => ({
          ...f,
          job: f.job === null ? null : { ...f.job, status: "running", finishedAt: null },
          result: null,
        })),
      },
    });
  });
  await page.goto(`/today?date=${date}`);
  await expect(page.getByRole("list", { name: "Kitchen flags" })).toBeVisible({ timeout: 60_000 });
  if (flag === undefined) throw new Error("no flag");
  expect(await outcomeVisible(page, flag)).not.toEqual([]);
  // And a day without the flag shows none of it.
  await page.unroute(`**/api/v1/cook-sheets/${date}/flags`);
  await page.goto(`/today?date=${addDays(date, -1)}`);
  await loaded(page);
  expect(await outcomeVisible(page, flag)).not.toEqual([]);
  await ctx.close();
});

// =================================================================================================
// Leaf 1.4.8 (BLD-8 R-58, R-60): move, day targets, "Use for", substituted cook sheet. Tagged
// `@1.4.8-G<n>`, which 1.4.4's `@G<n>` greps do not match. Each viewport gets its own planned week
// (five and six weeks ahead), planned on first use, so 1.4.4's weeks are untouched.
// =================================================================================================

const moveWeeks = new Map<string, string>();
/** The planned week (Monday) of a viewport for the 1.4.8 tests. */
async function moveWeek(v: Viewport): Promise<string> {
  const known = moveWeeks.get(v.name);
  if (known !== undefined) return known;
  const monday = addDays(mondayOf(world.today), v.name === "390" ? 35 : 42);
  await plan(world.admin, week(monday));
  moveWeeks.set(v.name, monday);
  return monday;
}

/** Drags `from` onto `to` with the mouse (pointer events, ADR-1), in small steps. */
async function drag(
  page: Page,
  from: ReturnType<Page["getByTestId"]>,
  to: ReturnType<Page["getByTestId"]>,
) {
  await from.evaluate((el) => {
    el.scrollIntoView({ block: "center" });
  });
  const a = await from.boundingBox();
  if (a === null) throw new Error("drag source is not visible");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
  await expect(page.getByTestId("drag-ghost")).toBeVisible();
  // The phone list can put the target below the fold: scroll with the wheel mid-drag, as a user would.
  const vh = page.viewportSize()?.height ?? 0;
  let b = await to.boundingBox();
  // Clear of the phone tab bar and of the edge zones where the page scrolls itself (ADR-1).
  const clear = (y: number) => y > 110 && y < vh - 120;
  for (let i = 0; i < 12 && b !== null && !clear(b.y + b.height / 2); i += 1) {
    await page.mouse.wheel(0, b.y + b.height / 2 > vh / 2 ? 200 : -200);
    await page.waitForTimeout(100);
    b = await to.boundingBox();
  }
  if (b === null) throw new Error("drop target is not visible");
  expect(clear(b.y + b.height / 2), `drop target clear of the edges (y ${String(b.y)})`).toBe(true);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** Did the exchange of two meals reach the plan (API, independently of the page)? */
async function exchanged(a: Meal, b: Meal, slotKey: string): Promise<boolean> {
  const nowA = await mealOf(world.admin, a.date, slotKey);
  const nowB = await mealOf(world.admin, b.date, slotKey);
  return (
    nowA.id === b.id && nowA.dishId === b.dishId && nowB.id === a.id && nowB.dishId === a.dishId
  );
}

for (const v of VIEWPORTS) {
  test(`@1.4.8-G1 drag a meal onto another day's slot at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(600_000);
    const monday = await moveWeek(v);
    const from = addDays(monday, 1);
    const to = addDays(monday, 2);
    const a = await mealOf(world.admin, from, "dinner");
    const b = await mealOf(world.admin, to, "dinner");
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/plan?week=${from}`);
    const src = page.getByTestId(`cell-${from}-dinner`);
    await expect(src).toHaveAttribute("data-draggable", "true", { timeout: 60_000 });
    await drag(page, src, page.getByTestId(`cell-${to}-dinner`));
    await expect(page.getByRole("status").filter({ hasText: "is now on" })).toBeVisible({
      timeout: 180_000,
    });
    expect(await exchanged(a, b, "dinner")).toBe(true);
    await expect(page.getByTestId(`cell-${to}-dinner`)).toContainText(a.dishName);
    await expectFits(page, `week after a drag ${v.name}`);
    await ctx.close();
  });

  test(`@1.4.8-G1 Move to… from the keyboard at ${v.name} px`, async ({ browser }) => {
    test.setTimeout(600_000);
    const monday = await moveWeek(v);
    const from = addDays(monday, 3);
    const to = addDays(monday, 5);
    const a = await mealOf(world.admin, from, "breakfast");
    const b = await mealOf(world.admin, to, "breakfast");
    const { ctx, page } = await as(browser, "admin", v);
    await page.goto(`/plan?week=${from}`);
    const cell = page.getByTestId(`cell-${from}-breakfast`);
    await expect(cell).toBeVisible({ timeout: 60_000 });
    await cell.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const toggle = dialog.getByRole("button", { name: "Move to…" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const option = dialog.getByTestId(`move-to-${to}`);
    await expect(option).toContainText(`Swap with ${b.dishName}`);
    for (let i = 0; i < 8; i += 1) {
      if (await option.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(option).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "is now on" })).toBeVisible({
      timeout: 180_000,
    });
    expect(await exchanged(a, b, "breakfast")).toBe(true);
    await ctx.close();
  });
}

test("@1.4.8-G1 a move the planner refuses says why and changes nothing", async ({ browser }) => {
  test.setTimeout(300_000);
  const monday = await moveWeek(VIEWPORTS[1]);
  // Omar's pre-workout is on his training days (Mon/Wed/Fri); Tuesday is not one.
  const mon = await mealOf(world.admin, monday, "pre_workout", false);
  const before = JSON.stringify(await days(world.admin, monday, addDays(monday, 1)));
  const { ctx, page } = await as(browser, "admin", VIEWPORTS[1]);
  await page.goto(`/plan?week=${monday}`);
  await openCell(page, monday, "pre_workout");
  const block = page.getByTestId("meal-block").filter({ hasText: mon.dishName }).first();
  await block.getByRole("button", { name: "Move to…" }).click();
  await block.getByTestId(`move-to-${addDays(monday, 1)}`).click();
  await expect(block.getByRole("alert")).toContainText(/cannot be the pre-workout/i, {
    timeout: 120_000,
  });
  expect(JSON.stringify(await days(world.admin, monday, addDays(monday, 1)))).toBe(before);
  await ctx.close();
});

test("@1.4.8-G1 negative control: a drag the server refused is not reported as moved", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const monday = await moveWeek(VIEWPORTS[1]);
  const from = addDays(monday, 4);
  const to = addDays(monday, 6);
  const a = await mealOf(world.admin, from, "dinner");
  const b = await mealOf(world.admin, to, "dinner");
  const { ctx, page } = await as(browser, "admin", VIEWPORTS[1]);
  await page.route("**/api/v1/plan-meals/*/move", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      json: { type: "about:blank", title: "Conflict", status: 409, detail: "the plan is locked" },
    }),
  );
  await page.goto(`/plan?week=${from}`);
  await expect(page.getByTestId(`cell-${from}-dinner`)).toBeVisible({ timeout: 60_000 });
  await drag(page, page.getByTestId(`cell-${from}-dinner`), page.getByTestId(`cell-${to}-dinner`));
  await expect(page.getByRole("alert").filter({ hasText: "locked" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("status").filter({ hasText: "is now on" })).toHaveCount(0);
  expect(await exchanged(a, b, "dinner")).toBe(false);
  await ctx.close();
});

// G3: the day target on Plan and Plate (W-7) -------------------------------------------------------

for (const v of VIEWPORTS)
  test(`@1.4.8-G3 Plan and Plate show the day target of the day kind at ${v.name} px`, async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const monday = await moveWeek(v);
    const sunday = addDays(monday, 6);
    const { ctx, page } = await as(browser, "admin", v);
    // Omar: 2390 on his training Monday, 2150 on Sunday (rest), whatever his plates' targets sum to.
    for (const [date, kcal] of [
      [monday, 2390],
      [sunday, 2150],
    ] as const) {
      const dinner = await mealOf(world.admin, date, "dinner");
      const omar = dinner.plates.find((p) => p.memberId === world.members.omar);
      if (omar === undefined) throw new Error(`no plate for Omar on ${date}`);
      const sum = (await days(world.admin, date, date))[0]?.meals
        .flatMap((m) => m.plates)
        .filter((p) => p.memberId === world.members.omar)
        .reduce((s, p) => s + ((p.target as { kcal?: number } | null)?.kcal ?? 0), 0);
      console.log(
        `  ${date}: Omar's plate targets sum to ${String(Math.round(sum ?? 0))}, day target ${String(kcal)}`,
      );
      await page.goto(`/plan?week=${date}`);
      await openCell(page, date, "dinner");
      const row = page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Omar" });
      await expect(row.getByTestId("day-target")).toContainText(`of ${String(kcal)} kcal today`);
      await page.keyboard.press("Escape");
      await page.goto(`/today/plates/${omar.id}`);
      await expect(
        page.getByText(
          `on a ${String(kcal)} kcal day (${date === monday ? "training" : "rest"} day)`,
        ),
      ).toBeVisible({ timeout: 60_000 });
      await expectFits(page, `plate ${date} ${v.name}`);
    }
    await ctx.close();
    // A member without schedules: Sara's own plate names her day target.
    const m = await as(browser, "sara", v);
    const hers = (await mealOf(world.admin, sunday, "dinner")).plates.find(
      (p) => p.memberId === world.members.sara,
    );
    await m.page.goto(`/today/plates/${hers?.id ?? ""}`);
    await expect(m.page.getByText("on a 1655 kcal day")).toBeVisible({ timeout: 60_000 });
    await m.ctx.close();
  });

// G4: "Use for <day> <slot>" on the recipe page -----------------------------------------------------

interface StrictWorld {
  state: Awaited<ReturnType<APIRequestContext["storageState"]>>;
  date: string;
  /** A dinner dish Nour may not eat: a core ingredient of a required component is excluded. */
  excluded: { id: string; name: string; ingredient: string };
  /** A dinner dish allowed but whose plate cannot meet Nour's strict (out-of-reach) targets. */
  infeasible: { id: string; name: string };
}
let strictWorld: StrictWorld | null = null;

type DishDetail = {
  components: Array<{
    required: boolean;
    variants: Array<{ ingredients: Array<{ ingredientId: string }> }>;
  }>;
};

/**
 * A second household with one targeted member, Nour (strict, the default), planned one day; then
 * one dinner dish is excluded for her (an ingredient every variant of a required component uses)
 * and her targets are put out of reach, so every allowed dinner is infeasible for her.
 */
async function strictHousehold(playwright: {
  request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> };
}): Promise<StrictWorld> {
  if (strictWorld !== null) return strictWorld;
  const api = await playwright.request.newContext({ baseURL: world.base });
  const tag = Math.random().toString(36).slice(2, 8);
  await json(
    await api.post("/api/v1/signup", {
      data: {
        email: `strict-${tag}@example.test`,
        password: "correct horse battery",
        name: "Nour",
        householdName: "Strict targets",
      },
    }),
    "signup",
  );
  const nour = crypto.randomUUID();
  const apply = async (summary: string, ops: unknown[]) =>
    json(await api.post("/api/v1/change-sets", { data: { summary, ops } }), summary);
  await apply("test setup (strict)", [
    {
      kind: "member.create",
      payload: { id: nour, displayName: "Nour", color: "sea", birthYear: 1990, isTargeted: true },
    },
    {
      kind: "target.set",
      payload: {
        memberId: nour,
        kind: "default",
        profile: { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 65 },
      },
    },
  ]);
  const date = addDays(mondayOf(world.today), 36);
  await plan(api, [date]);
  const dinner = (await days(api, date, date))[0]?.meals.find((m) => m.slotKey === "dinner");
  if (dinner === undefined) throw new Error("no dinner in the strict household");
  const alts = (
    await json<{ alternatives: Array<{ dishId: string; dishName: string }> }>(
      await api.get(`/api/v1/plan-meals/${dinner.id}/alternatives`),
      "alternatives",
    )
  ).alternatives;
  const detail = async (id: string) =>
    json<DishDetail>(await api.get(`/api/v1/dishes/${id}`), "dish");
  // The excluded dish: the first alternative with an ingredient in every variant of a required
  // component (so no variant choice can avoid it).
  let excluded: StrictWorld["excluded"] | null = null;
  let banned = "";
  for (const alt of alts) {
    const d = await detail(alt.dishId);
    for (const comp of d.components.filter((c) => c.required)) {
      const sets = comp.variants.map((x) => new Set(x.ingredients.map((i) => i.ingredientId)));
      const common = [...(sets[0] ?? [])].filter((id) => sets.every((set) => set.has(id)));
      if (common[0] !== undefined) {
        banned = common[0];
        break;
      }
    }
    if (banned !== "") {
      const ing = await json<{ slug: string; name: string }>(
        await api.get(`/api/v1/ingredients/${banned}`),
        "ingredient",
      );
      excluded = { id: alt.dishId, name: alt.dishName, ingredient: ing.slug };
      break;
    }
  }
  if (excluded === null) throw new Error("no alternative has a required ingredient to exclude");
  let infeasible: StrictWorld["infeasible"] | null = null;
  for (const alt of alts) {
    if (alt.dishId === excluded.id || alt.dishId === dinner.dishId) continue;
    const d = await detail(alt.dishId);
    const uses = d.components.some((c) =>
      c.variants.some((x) => x.ingredients.some((i) => i.ingredientId === banned)),
    );
    if (!uses) {
      infeasible = { id: alt.dishId, name: alt.dishName };
      break;
    }
  }
  if (infeasible === null) throw new Error("no alternative without the excluded ingredient");
  await apply("test: an exclusion and targets out of reach", [
    {
      kind: "exclusion.add",
      payload: {
        memberId: nour,
        kind: "ingredient",
        key: excluded.ingredient,
        reason: "allergy",
        hard: true,
      },
    },
    {
      kind: "target.set",
      payload: {
        memberId: nour,
        kind: "default",
        profile: { kcal: 9000, proteinG: 900, carbsG: 900, fatG: 300 },
      },
    },
  ]);
  strictWorld = { state: await api.storageState(), date, excluded, infeasible };
  await api.dispose();
  return strictWorld;
}

for (const v of VIEWPORTS)
  test(`@1.4.8-G4 Use for <day> <slot> on the recipe page at ${v.name} px`, async ({
    browser,
    playwright,
  }) => {
    test.setTimeout(600_000);
    const monday = await moveWeek(v);
    const date = addDays(monday, 5);
    const meal = await mealOf(world.admin, date, "dinner");
    const alts = (
      await json<{
        alternatives: Array<{
          dishId: string;
          dishName: string;
          plates: Array<{ fitStatus: string }>;
        }>;
      }>(await world.admin.get(`/api/v1/plan-meals/${meal.id}/alternatives`), "alternatives")
    ).alternatives;
    const good = alts.find((x) => x.plates.every((p) => p.fitStatus !== "infeasible"));
    if (good === undefined) throw new Error("no in-tolerance alternative");
    const { ctx, page } = await as(browser, "admin", v);
    const label = `Use for ${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} dinner`;

    // Accepted: the dish is now that dinner (API), with re-solved plates.
    await page.goto(`/recipes/${good.dishId}?date=${date}&slot=dinner`);
    const button = page.getByRole("button", { name: label });
    await expect(button).toBeEnabled({ timeout: 60_000 });
    await button.click();
    await expect(page.getByTestId("use-for").getByRole("status")).toContainText("is now", {
      timeout: 180_000,
    });
    const now = await mealOf(world.admin, date, "dinner");
    expect(now.dishId).toBe(good.dishId);
    expect(now.plates.map((p) => p.id).some((id) => meal.plates.some((p) => p.id === id))).toBe(
      false,
    );
    await expect(page.getByRole("link", { name: "See the plan" })).toHaveAttribute(
      "href",
      new RegExp(`meal=${meal.id}`),
    );
    await expectFits(page, `recipe use-for ${v.name}`);

    // Without a date and slot there is no action; with a date that has no plan it says so.
    await page.goto(`/recipes/${good.dishId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("use-for")).toHaveCount(0);
    await page.goto(`/recipes/${good.dishId}?date=${addDays(monday, 70)}&slot=dinner`);
    await expect(page.getByText(/Nothing is planned for/)).toBeVisible({ timeout: 60_000 });
    await ctx.close();

    // In the strict household: an excluded dish and an infeasible one are refused, with the reason
    // (exclusion; member, macro and amount for strict targets, R-60), and nothing changes.
    const strict = await strictHousehold(playwright);
    const s = await browser.newContext({
      storageState: strict.state,
      viewport: { width: v.width, height: v.height },
    });
    const sp = await s.newPage();
    const sDinner = async () =>
      (await days(s.request, strict.date, strict.date))[0]?.meals.find(
        (m) => m.slotKey === "dinner",
      );
    const before = await sDinner();
    const sLabel = `Use for ${new Date(`${strict.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} dinner`;
    await sp.goto(`/recipes/${strict.excluded.id}?date=${strict.date}&slot=dinner`);
    await sp.getByRole("button", { name: sLabel }).click();
    await expect(sp.getByTestId("use-for").getByRole("alert")).toContainText(
      /not allowed for this meal \(exclusions/i,
      { timeout: 120_000 },
    );
    await sp.goto(`/recipes/${strict.infeasible.id}?date=${strict.date}&slot=dinner`);
    await sp.getByRole("button", { name: sLabel }).click();
    await expect(sp.getByTestId("use-for").getByRole("alert")).toContainText(
      /Nour's dinner would miss (protein|carbs|fat|calories) by \d+/,
      { timeout: 120_000 },
    );
    expect((await sDinner())?.dishId).toBe(before?.dishId);
    await s.close();
  });

// G5: the substituted cook sheet, and axe on every new state -------------------------------------

/** What in a cook sheet's batches still names `names` (steps, labels, component names). */
function namesLeft(
  batches: Array<{ componentName: string; variantLabel: string; steps: string[] }>,
  names: string[],
  sub: string,
): string[] {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${names.map(esc).join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
  const bare = (x: string) => x.replace(new RegExp(esc(sub), "giu"), "");
  const note = /^Use .+ wherever .+ is mentioned\.$/;
  return batches.flatMap((b) => [
    ...[b.componentName, b.variantLabel].filter((t) => re.test(bare(t))),
    ...b.steps.filter((t) => !note.test(t) && re.test(bare(t))),
  ]);
}

interface SheetBatch {
  componentName: string;
  variantLabel: string;
  steps: string[];
  raw: Array<{ ingredientId: string; slug: string }>;
}

let substituted: { date: string; mealId: string; sub: string; names: string[] } | null = null;

test("@1.4.8-G5 the substituted cook sheet names the substitute (olive oil → canola oil when served)", async ({
  browser,
  playwright,
}) => {
  test.setTimeout(600_000);
  const monday = await moveWeek(VIEWPORTS[0]);
  const date = addDays(monday, 6);
  type Sheet = { meals: Array<{ planMealId: string; dishName: string; batches: SheetBatch[] }> };
  const sheet = await json<Sheet>(await world.admin.get(`/api/v1/cook-sheets/${date}`), "sheet");
  const counts = substituteCounts();
  const raw = sheet.meals.flatMap((m) => m.batches.flatMap((b) => b.raw.map((r) => ({ ...r, m }))));
  // Olive oil when the day serves it (the W-6 case), otherwise the most substitutable ingredient.
  const pick =
    raw.find((r) => r.slug === "olive-oil") ??
    raw
      .filter((r) => counts.has(r.slug))
      .sort(
        (x, y) =>
          (counts.get(y.slug) ?? 0) - (counts.get(x.slug) ?? 0) || x.slug.localeCompare(y.slug),
      )[0];
  if (pick === undefined) throw new Error("no served ingredient has a catalogue substitute");
  const ing = await json<{ name: string; aliases: string[] }>(
    await world.admin.get(`/api/v1/ingredients/${pick.ingredientId}`),
    "ingredient",
  );
  const kitchen = await playwright.request.newContext({
    baseURL: world.base,
    storageState: world.states.kitchen,
  });
  const flagged = await json<{ jobId: string }>(
    await kitchen.post(`/api/v1/cook-sheets/${date}/flags`, {
      data: { kind: "unavailable", ingredientId: pick.ingredientId, planMealId: pick.m.planMealId },
    }),
    "flag",
  );
  await waitJob(world.admin, flagged.jobId);
  const flags = (
    await json<{ flags: FlagView[] }>(
      await world.admin.get(`/api/v1/cook-sheets/${date}/flags`),
      "flags",
    )
  ).flags;
  const result = flags.find((f) => f.kind === "unavailable")?.result;
  const sub = result?.substituteName ?? "";
  expect(sub, JSON.stringify(result)).not.toBe("");
  const changed = result?.meals.find((m) => m.date === date);
  if (changed === undefined) throw new Error("no meal of the date was substituted");
  const names = [ing.name, ...ing.aliases];
  const after = await json<Sheet>(await kitchen.get(`/api/v1/cook-sheets/${date}`), "sheet after");
  const copy = after.meals.find((m) => m.planMealId === changed.planMealId);
  expect(copy?.dishName).toBe(changed.toDishName);
  // The copy's batches that now use the substitute: nothing in them names the ingredient.
  const touched = (copy?.batches ?? []).filter((b) =>
    b.raw.some((r) => r.ingredientId === result?.substituteId),
  );
  expect(touched.length).toBeGreaterThan(0);
  expect(namesLeft(touched, names, sub)).toEqual([]);
  // Negative control: the same check on the date's original batches with the ingredient fails.
  const mentioning = sheet.meals.flatMap((m) =>
    m.batches.filter((b) => b.raw.some((r) => r.ingredientId === pick.ingredientId)),
  );
  expect(namesLeft(mentioning, names, sub).length).toBeGreaterThan(0);
  await kitchen.dispose();
  substituted = { date, mealId: changed.planMealId, sub, names };

  // The kitchen reads it on the page at both widths: the copy's steps as the API gives them.
  for (const v of VIEWPORTS) {
    const { ctx, page } = await as(browser, "kitchen", v);
    await page.goto(`/kitchen?date=${date}&meal=${changed.planMealId}`);
    const article = page.getByTestId("cook-meal").filter({ visible: true }).first();
    await expect(article).toContainText(changed.toDishName, { timeout: 60_000 });
    for (const b of touched) for (const step of b.steps) await expect(article).toContainText(step);
    await expectFits(page, `substituted cook sheet ${v.name}`);
    await ctx.close();
  }
});

for (const v of VIEWPORTS)
  test(`@1.4.8-G5 axe on the move, day-target, use-for and substituted states at ${v.name} px, light and dark`, async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const monday = await moveWeek(v);
    const date = addDays(monday, 2);
    const dinner = await mealOf(world.admin, date, "dinner");
    const alts = (
      await json<{ alternatives: Array<{ dishId: string }> }>(
        await world.admin.get(`/api/v1/plan-meals/${dinner.id}/alternatives`),
        "alternatives",
      )
    ).alternatives;
    for (const dark of [false, true]) {
      const theme = dark ? "dark" : "light";
      const { ctx, page } = await as(browser, "admin", v, dark);
      await page.goto(`/plan?week=${date}`);
      await expect(page.getByTestId(`cell-${date}-dinner`)).toBeVisible({ timeout: 60_000 });
      await axe(page, `week with drag ${v.name} ${theme}`);
      // Mid-drag: the ghost and the drop targets.
      const src = page.getByTestId(`cell-${date}-dinner`);
      await src.evaluate((el) => {
        el.scrollIntoView({ block: "center" });
      });
      const box = await src.boundingBox();
      if (box !== null) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, {
          steps: 4,
        });
        await expect(page.getByTestId("drag-ghost")).toBeVisible();
        await axe(page, `week mid-drag ${v.name} ${theme}`);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(page.getByTestId("drag-ghost")).toHaveCount(0);
        // Escape cancelled the drag: releasing the button does not open the meal sheet.
        await page.waitForTimeout(300);
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
      await openCell(page, date, "dinner");
      await page.getByRole("dialog").getByRole("button", { name: "Move to…" }).first().click();
      await expect(page.getByRole("dialog").getByRole("list", { name: /^Move / })).toBeVisible();
      await axe(page, `meal sheet with Move menu and day targets ${v.name} ${theme}`);
      await page.keyboard.press("Escape");
      // The plate as it is now (plates get new ids whenever the meal is re-solved).
      const omarNow = (await mealOf(world.admin, date, "dinner")).plates.find(
        (p) => p.memberId === world.members.omar,
      );
      await page.goto(`/today/plates/${omarNow?.id ?? ""}`);
      await loaded(page);
      await expect(
        page.getByText(/kcal day/),
        `plate page for ${omarNow?.id ?? "?"}: ${(await page.locator("main").textContent()) ?? ""}`,
      ).toBeVisible({ timeout: 60_000 });
      await axe(page, `plate with day target ${v.name} ${theme}`);
      await page.goto(`/recipes/${alts[0]?.dishId ?? dinner.dishId}?date=${date}&slot=dinner`);
      await expect(page.getByTestId("use-for").getByRole("button")).toBeEnabled({
        timeout: 60_000,
      });
      await axe(page, `recipe with Use for ${v.name} ${theme}`);
      await page.goto(`/recipes/${dinner.dishId}?date=${addDays(monday, 70)}&slot=dinner`);
      await expect(page.getByText(/Nothing is planned for/)).toBeVisible({ timeout: 60_000 });
      await axe(page, `recipe with Use for disabled ${v.name} ${theme}`);
      if (substituted !== null) {
        await page.goto(`/kitchen?date=${substituted.date}&meal=${substituted.mealId}`);
        await expect(page.getByTestId("cook-meal").filter({ visible: true }).first()).toBeVisible({
          timeout: 60_000,
        });
        await axe(page, `substituted cook sheet ${v.name} ${theme}`);
      }
      await ctx.close();
    }
    expect(substituted, "the substituted cook sheet test ran first").not.toBeNull();
  });
