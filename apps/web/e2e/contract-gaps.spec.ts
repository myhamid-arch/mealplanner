// Leaf 1.4.12 (R-82): contract gaps in the planning screens. Run by scripts/verify/leaf-1.4.12.mjs
// against a real database and worker; the script starts both and passes DATABASE_URL, AUTH_SECRET
// and APP_URL to `next start`, and for G2 the recorded agent turn (e2e/contract-gaps/agent-turn.mjs).
//   @1.4.12-G1  PLN-3 at 390 and 1280 px: on Meals & schedule, one tap on "Replaces lunch on the
//               days it's on" for Packed school lunch; the stored schedule has the child off lunch
//               on exactly the packed weekdays, and the plan the worker generates next has no lunch
//               plate and a packed plate for the child on those days (a lunch plate on the others).
//               Negative control: a twin household without the tap fails the same two checks.
//   @1.4.12-G2  R2-DL-6 at 390 and 1280 px: every section with the detail-level control on a
//               member's page offers "Tell the assistant"; it opens the chat with a request naming
//               the member and the section, and the recorded agent turn applies the change the
//               section writes at the level it shows (leaf-1.4.12 SPEC-Q-1): the API agrees and the
//               section, still at that level, shows it. Negative control: the same check on the
//               page with one section's link removed fails and names that section.
// Captures for the architect go to $SCREENSHOT_DIR when it is set.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The values the recorded agent turn writes (e2e/contract-gaps/agent-turn.mjs reads the same). */
const RECORDED = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "contract-gaps/recorded.json"),
    "utf8",
  ),
) as {
  targets: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  lunchShare: number;
  cuisine: string;
  like: number;
};

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 900 },
] as const;
type Viewport = (typeof VIEWPORTS)[number];

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;
async function capture(page: Page, name: string) {
  if (SCREENSHOT_DIR === undefined || SCREENSHOT_DIR === "") return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

/** Monday = 0 … Sunday = 6, as slot_schedule and training rows store weekdays. */
const SCHOOL_DAYS = [0, 1, 2, 3, 4];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// API helpers --------------------------------------------------------------------------------------

async function json<T>(r: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  const text = await r.text();
  expect(r.status(), `${what}: ${text.slice(0, 400)}`).toBeLessThan(300);
  return JSON.parse(text) as T;
}

async function applyOps(api: APIRequestContext, summary: string, ops: unknown[]): Promise<void> {
  await json(await api.post("/api/v1/change-sets", { data: { summary, ops } }), summary);
}

interface Slot {
  id: string;
  key: string;
  active: boolean;
  isTrainingSlot: boolean;
}
interface Schedules {
  slotSchedules: Array<{ memberId: string; slotTypeId: string; weekday: number; attends: boolean }>;
  distributions: Array<{ memberId: string; dayKind: string; slotTypeId: string; share: number }>;
}
interface Meal {
  date: string;
  slotKey: string;
  plates: Array<{ memberId: string }>;
}

async function slots(api: APIRequestContext): Promise<Slot[]> {
  return (await json<{ slots: Slot[] }>(await api.get("/api/v1/slots"), "slots")).slots;
}
async function slotOf(api: APIRequestContext, key: string): Promise<Slot> {
  const s = (await slots(api)).find((x) => x.key === key);
  if (s === undefined) throw new Error(`no ${key} slot`);
  return s;
}
async function schedules(api: APIRequestContext): Promise<Schedules> {
  return json<Schedules>(await api.get("/api/v1/schedules"), "schedules");
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

/** Generates the dates through the worker's plan.generate job and returns the stored meals. */
async function generate(api: APIRequestContext, dates: string[]): Promise<Meal[]> {
  const { jobId } = await json<{ jobId: string }>(
    await api.post("/api/v1/plans/generate", { data: { dates, seed: 1 } }),
    "generate",
  );
  await waitJob(api, jobId);
  const { days } = await json<{ days: Array<{ meals: Meal[] }> }>(
    await api.get(`/api/v1/plans?from=${dates[0] ?? ""}&to=${dates.at(-1) ?? ""}`),
    "plans",
  );
  return days.flatMap((d) => d.meals);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The household's next Monday-to-Sunday week, all in the future. */
async function nextWeek(api: APIRequestContext): Promise<string[]> {
  const hh = await json<{ timezone: string }>(
    await api.get("/api/v1/households/current"),
    "household",
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: hh.timezone }).format(new Date());
  const monday = addDays(today, 7 - weekdayOf(today));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// Households ---------------------------------------------------------------------------------------

let serial = 0;

async function signedIn(browser: Browser, v: Viewport, tag: string): Promise<BrowserContext> {
  serial += 1;
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const email = `${tag}-${String(serial)}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await json(
    await ctx.request.post("/api/v1/signup", {
      data: {
        email,
        password: "correct horse battery",
        name: "Omar",
        householdName: `Gaps ${tag}`,
      },
    }),
    "signup",
  );
  return ctx;
}

interface Family {
  omar: string;
  zayd: string;
}

/** Omar (targeted; F1 numbers; trains Mon/Wed/Fri 18:00) and Zayd (10, untargeted). */
async function family(api: APIRequestContext): Promise<Family> {
  const omar = crypto.randomUUID();
  const zayd = crypto.randomUUID();
  await applyOps(api, "test setup: members", [
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
        id: zayd,
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
        profile: { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70 },
      },
    },
    {
      kind: "training.set",
      payload: {
        memberId: omar,
        days: [0, 2, 4].map((weekday) => ({ weekday, sessionTime: "18:00:00" })),
      },
    },
  ]);
  return { omar, zayd };
}

/**
 * PLN-3's starting point: Packed school lunch switched on; Zayd takes it Monday to Friday and,
 * with no lunch rows, still attends lunch every day; Omar never takes it.
 */
async function schoolLunch(api: APIRequestContext, f: Family): Promise<void> {
  const packed = await slotOf(api, "packed_school_lunch");
  await applyOps(api, "test setup: packed school lunch", [
    { kind: "slot.update", payload: { slotTypeId: packed.id, active: true } },
    {
      kind: "slot_schedule.set",
      payload: {
        memberId: f.zayd,
        slotTypeId: packed.id,
        days: ALL_DAYS.map((weekday) => ({ weekday, attends: SCHOOL_DAYS.includes(weekday) })),
      },
    },
    {
      kind: "slot_schedule.set",
      payload: {
        memberId: f.omar,
        slotTypeId: packed.id,
        days: ALL_DAYS.map((weekday) => ({ weekday, attends: false })),
      },
    },
  ]);
}

// G1 checks (the positive runs and the negative control call the same functions) -------------------

/** What is wrong with the stored lunch schedule of `memberId` after "replaces lunch". */
function scheduleProblems(s: Schedules, memberId: string, lunchId: string): string[] {
  const out: string[] = [];
  const rows = s.slotSchedules.filter((r) => r.memberId === memberId && r.slotTypeId === lunchId);
  for (const weekday of ALL_DAYS) {
    const row = rows.find((r) => r.weekday === weekday);
    if (SCHOOL_DAYS.includes(weekday)) {
      if (row?.attends !== false)
        out.push(`weekday ${String(weekday)}: lunch is not off (row ${JSON.stringify(row)})`);
    } else if (row !== undefined && !row.attends) {
      out.push(`weekday ${String(weekday)}: lunch was switched off on a day without school`);
    }
  }
  return out;
}

/** What is wrong with the member's plates over the generated week. */
function planProblems(meals: Meal[], dates: string[], memberId: string): string[] {
  const out: string[] = [];
  const has = (date: string, slotKey: string) =>
    meals.some(
      (m) =>
        m.date === date && m.slotKey === slotKey && m.plates.some((p) => p.memberId === memberId),
    );
  for (const date of dates) {
    const school = SCHOOL_DAYS.includes(weekdayOf(date));
    if (school && has(date, "lunch")) out.push(`${date}: a lunch plate on a packed-lunch day`);
    if (school && !has(date, "packed_school_lunch")) out.push(`${date}: no packed-lunch plate`);
    if (!school && !has(date, "lunch")) out.push(`${date}: no lunch plate on a day without school`);
    if (!school && has(date, "packed_school_lunch"))
      out.push(`${date}: a packed-lunch plate on a day without school`);
  }
  return out;
}

async function openPackedLunch(page: Page) {
  await page.goto("/settings/schedule");
  await expect(page.getByRole("heading", { name: "Meals & schedule" })).toBeVisible();
  // The one-tap choice is a Detailed setting of the packed slot (ScheduleGrid.dc.html).
  await page
    .getByRole("radiogroup", { name: "Detail level for meals and schedule" })
    .getByRole("radio", { name: "Detailed" })
    .click();
  await page.getByRole("button", { name: /^Packed school lunch/ }).click();
  await expect(page.getByRole("heading", { name: "Packed school lunch" })).toBeVisible();
}

const REPLACES = "Replaces lunch on the days it's on";

for (const v of VIEWPORTS)
  test(`@1.4.12-G1 one tap: the packed school lunch replaces lunch at ${v.name} px`, async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const ctx = await signedIn(browser, v, `g1-${v.name}`);
    const api = ctx.request;
    const f = await family(api);
    await schoolLunch(api, f);
    const lunch = await slotOf(api, "lunch");
    const page = await ctx.newPage();
    await openPackedLunch(page);
    const box = page.getByRole("checkbox", { name: REPLACES });
    await expect(box).not.toBeChecked();
    // Before the tap the check reports every school day (it can fail).
    expect(scheduleProblems(await schedules(api), f.zayd, lunch.id)).toHaveLength(5);
    await box.click(); // the one tap
    await expect(box).toBeChecked();
    await capture(page, `g1-replaces-lunch-${v.name}`);
    await expect
      .poll(async () => scheduleProblems(await schedules(api), f.zayd, lunch.id), {
        timeout: 30_000,
      })
      .toEqual([]);
    // Omar never takes the packed lunch; his lunch is untouched.
    expect(
      (await schedules(api)).slotSchedules.filter(
        (r) => r.memberId === f.omar && r.slotTypeId === lunch.id,
      ),
    ).toEqual([]);
    const dates = await nextWeek(api);
    const meals = await generate(api, dates);
    expect(planProblems(meals, dates, f.zayd)).toEqual([]);
    // Omar keeps lunch every day.
    for (const date of dates)
      expect(
        meals.some(
          (m) =>
            m.date === date && m.slotKey === "lunch" && m.plates.some((p) => p.memberId === f.omar),
        ),
        `${date}: Omar's lunch plate`,
      ).toBe(true);
    // After a reload the choice shows as made.
    await openPackedLunch(page);
    await expect(page.getByRole("checkbox", { name: REPLACES })).toBeChecked();
    await ctx.close();
  });

test("@1.4.12-G1 negative control: without the tap the lunch plate stays", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await signedIn(browser, VIEWPORTS[1], "g1-control");
  const api = ctx.request;
  const f = await family(api);
  await schoolLunch(api, f);
  const lunch = await slotOf(api, "lunch");
  const page = await ctx.newPage();
  await openPackedLunch(page);
  await expect(page.getByRole("checkbox", { name: REPLACES })).not.toBeChecked();
  const stored = scheduleProblems(await schedules(api), f.zayd, lunch.id);
  expect(stored).toHaveLength(SCHOOL_DAYS.length);
  const dates = await nextWeek(api);
  const meals = await generate(api, dates);
  const problems = planProblems(meals, dates, f.zayd);
  // Every school day keeps its lunch plate, and nothing else is wrong.
  expect(problems.sort()).toEqual(
    dates
      .filter((d) => SCHOOL_DAYS.includes(weekdayOf(d)))
      .map((d) => `${d}: a lunch plate on a packed-lunch day`)
      .sort(),
  );
  await ctx.close();
});

// G2 checks ----------------------------------------------------------------------------------------

interface SectionFacts {
  id: string;
  title: string;
  prompt: string | null;
}

/** Every detail-level section of the page, with the request its "Tell the assistant" prefills. */
async function detailSections(page: Page): Promise<SectionFacts[]> {
  return page.locator("section:has([data-detail-control])").evaluateAll((els) =>
    els.map((el) => {
      const title = el.querySelector("h2, h3")?.textContent.trim() ?? "";
      const link = [...el.querySelectorAll("a")].find(
        (a) => a.textContent.trim() === "Tell the assistant",
      );
      const href = link?.getAttribute("href") ?? null;
      const prompt =
        href !== null && href.startsWith("/chat?prompt=")
          ? new URLSearchParams(href.slice("/chat?".length)).get("prompt")
          : null;
      return { id: el.id, title, prompt };
    }),
  );
}

/** The heading's last word ("Daily targets" → "targets", "Tastes (detailed)" → "tastes"). */
function sectionWord(title: string): string {
  return (
    title
      .replace(/\(.*\)/g, "")
      .trim()
      .split(/\s+/)
      .at(-1)
      ?.toLowerCase() ?? ""
  );
}

/** R2-DL-6 on one member's page: what is missing (empty when every section offers it). */
function tellAssistantProblems(sections: SectionFacts[], member: string): string[] {
  const out: string[] = [];
  if (sections.length < 3)
    out.push(`only ${String(sections.length)} detail-level sections on the member's page`);
  for (const s of sections) {
    if (s.prompt === null) {
      out.push(`${s.id}: no "Tell the assistant"`);
      continue;
    }
    const p = s.prompt.toLowerCase();
    if (!p.includes(member.toLowerCase())) out.push(`${s.id}: the request does not name ${member}`);
    if (!p.includes(sectionWord(s.title)))
      out.push(`${s.id}: the request does not name the section (${sectionWord(s.title)})`);
  }
  return out;
}

interface Level {
  memberId: string | null;
  section: string;
  level: string;
}
async function levelOf(api: APIRequestContext, memberId: string, section: string) {
  const { levels } = await json<{ levels: Level[] }>(
    await api.get("/api/v1/detail-levels"),
    "levels",
  );
  return levels.find((l) => l.memberId === memberId && l.section === section)?.level ?? "basic";
}

const LABEL = { basic: "Basic", detailed: "Detailed", expert: "Expert" } as const;

interface Case {
  id: "targets" | "meals" | "tastes";
  section: string;
  scope: string;
  level: keyof typeof LABEL;
  says: string;
  /** Checks the stored state through the API; returns what is wrong. */
  stored: (api: APIRequestContext, f: Family) => Promise<string[]>;
  /** Checks the section on the member page shows the change at its level. */
  shown: (page: Page) => Promise<void>;
}

const CASES: Case[] = [
  {
    id: "targets",
    section: "targets",
    scope: "Omar's targets",
    level: "basic",
    says: `${String(RECORDED.targets.kcal)} kcal, P${String(RECORDED.targets.proteinG)} C${String(RECORDED.targets.carbsG)} F${String(RECORDED.targets.fatG)}`,
    stored: async (api, f) => {
      const { targets } = await json<{
        targets: Array<{
          memberId: string;
          kind: string;
          kcal: number;
          proteinG: number;
          carbsG: number;
          fatG: number;
        }>;
      }>(await api.get("/api/v1/targets"), "targets");
      const t = targets.find((x) => x.memberId === f.omar && x.kind === "default");
      const want = RECORDED.targets;
      return t !== undefined &&
        t.kcal === want.kcal &&
        t.proteinG === want.proteinG &&
        t.carbsG === want.carbsG &&
        t.fatG === want.fatG
        ? []
        : [`targets: stored ${JSON.stringify(t)}`];
    },
    shown: async (page) => {
      const s = page.locator("section#targets");
      await expect(s.getByLabel("Calories")).toHaveValue(String(RECORDED.targets.kcal));
      await expect(s.getByLabel("Protein g")).toHaveValue(String(RECORDED.targets.proteinG));
    },
  },
  {
    id: "meals",
    section: "meal_split",
    scope: "Omar's meals",
    level: "detailed",
    says: "lunch 40 %",
    stored: async (api, f) => {
      const rows = (await schedules(api)).distributions.filter(
        (d) => d.memberId === f.omar && d.dayKind === "default",
      );
      const lunch = await slotOf(api, "lunch");
      const sum = rows.reduce((a, r) => a + r.share, 0);
      const out: string[] = [];
      if (rows.find((r) => r.slotTypeId === lunch.id)?.share !== RECORDED.lunchShare)
        out.push(`meals: lunch share ${JSON.stringify(rows)}`);
      if (Math.abs(sum - 1) > 1e-6) out.push(`meals: shares sum to ${String(sum)}`);
      return out;
    },
    shown: async (page) => {
      console.log(await page.locator("section#meals").innerText());
      const lunch = page.locator("section#meals [data-slot=lunch]");
      await expect(lunch.locator("[data-share]")).toHaveText(/^40\s?%$/);
      await expect(lunch.locator("[data-dl=yours]")).toBeVisible();
      // The other meals were rebalanced, not set: they keep their auto tag (R2-DL-4).
      const others = page.locator("section#meals [data-slot]:not([data-slot=lunch])");
      expect(await others.count()).toBeGreaterThan(0);
      for (const o of await others.all()) await expect(o.locator("[data-dl=auto]")).toBeVisible();
    },
  },
  {
    id: "tastes",
    section: "taste",
    scope: "Omar's tastes",
    level: "detailed",
    says: "more Levantine food",
    stored: async (api, f) => {
      const { preferences } = await json<{
        preferences: Array<{
          memberId: string | null;
          entityType: string;
          entityKey: string;
          score: number;
          source: string;
        }>;
      }>(await api.get("/api/v1/preferences"), "preferences");
      const p = preferences.find(
        (x) =>
          x.memberId === f.omar && x.entityType === "cuisine" && x.entityKey === RECORDED.cuisine,
      );
      return p?.score === RECORDED.like && p.source === "explicit"
        ? []
        : [`tastes: stored ${JSON.stringify(p)}`];
    },
    shown: async (page) => {
      const row = page.locator(`section#tastes [data-cuisine=${RECORDED.cuisine}]`);
      await expect(row.getByRole("radio", { name: "Likes" })).toBeChecked();
    },
  },
];

async function memberPage(page: Page, f: Family) {
  await page.goto(`/family/${f.omar}`);
  await expect(page.locator("section#tastes [data-detail-control]")).toBeVisible();
}

async function setLevel(page: Page, c: Case) {
  const group = page.getByRole("radiogroup", { name: `Detail level for ${c.scope}` });
  await group.getByRole("radio", { name: LABEL[c.level] }).click();
  await expect(group.getByRole("radio", { name: LABEL[c.level] })).toBeChecked();
}

for (const v of VIEWPORTS)
  test(`@1.4.12-G2 every detail-level section tells the assistant, applied at its level, at ${v.name} px`, async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const ctx = await signedIn(browser, v, `g2-${v.name}`);
    const api = ctx.request;
    const f = await family(api);
    const page = await ctx.newPage();
    await memberPage(page, f);
    const sections = await detailSections(page);
    expect(tellAssistantProblems(sections, "Omar")).toEqual([]);
    expect(sections.map((s) => s.id).sort()).toEqual(["meals", "targets", "tastes"]);

    for (const c of CASES) {
      await memberPage(page, f);
      await setLevel(page, c);
      await expect.poll(() => levelOf(api, f.omar, c.section)).toBe(c.level);
      // Before the turn the stored state does not have the change (the check can fail).
      expect(await c.stored(api, f)).not.toEqual([]);
      const facts = (await detailSections(page)).find((s) => s.id === c.id);
      await page
        .locator(`section#${c.id}`)
        .getByRole("link", { name: "Tell the assistant" })
        .click();
      await page.waitForURL(/\/chat\?prompt=/);
      const box = page.getByRole("textbox", { name: "Message" });
      await expect(box).toHaveValue(facts?.prompt ?? "(no prompt)");
      const prefill = await box.inputValue();
      expect(prefill).toContain("Omar");
      expect(prefill.toLowerCase()).toContain(c.id);
      // Prefilled, not sent.
      await expect(page.locator("[data-role=user]")).toHaveCount(0);
      await capture(page, `g2-chat-prefill-${c.id}-${v.name}`);
      await box.fill(`${prefill}${c.says}`);
      await page.getByRole("button", { name: "Send" }).click();
      const log = page.getByRole("log", { name: "Conversation" });
      await expect(log.locator("[data-card=applied_change]")).toBeVisible({ timeout: 60_000 });
      await expect(log).toContainText("Done:");
      expect(await c.stored(api, f)).toEqual([]);
      // Back on the member page: the section is still at its level and shows the change.
      await memberPage(page, f);
      expect(await levelOf(api, f.omar, c.section)).toBe(c.level);
      await expect(
        page
          .getByRole("radiogroup", { name: `Detail level for ${c.scope}` })
          .getByRole("radio", { name: LABEL[c.level] }),
      ).toBeChecked();
      await capture(page, `g2-applied-${c.id}-${v.name}`);
      await c.shown(page);
    }
    await ctx.close();
  });

test("@1.4.12-G2 negative control: a section without the control fails the same check", async ({
  browser,
}) => {
  const ctx = await signedIn(browser, VIEWPORTS[1], "g2-control");
  const f = await family(ctx.request);
  const page = await ctx.newPage();
  await memberPage(page, f);
  expect(tellAssistantProblems(await detailSections(page), "Omar")).toEqual([]);
  // The same page variant without the Meals section's control.
  await page.locator("section#meals a", { hasText: "Tell the assistant" }).evaluate((a) => {
    a.remove();
  });
  expect(tellAssistantProblems(await detailSections(page), "Omar")).toEqual([
    'meals: no "Tell the assistant"',
  ]);
  // And a request that names the member but not the section (the pre-R-84 Tastes prompt).
  const sections = await detailSections(page);
  const tastes = sections.map((s) => (s.id === "tastes" ? { ...s, prompt: "Omar likes " } : s));
  expect(tellAssistantProblems(tastes, "Omar")).toContain(
    "tastes: the request does not name the section (tastes)",
  );
  await ctx.close();
});
