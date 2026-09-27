// node-1.4 N3 (R-69, R-70): SC-5, the core flows at 390 px and 1280 px, against the built web app and
// the real worker, with recorded model responses (SPEC-Q-6: the onboarding parse and a chat turn;
// no credential, no live call). For each width, a new household goes through:
// - onboarding: at most five questions, then the review, then its first plan from the worker; the
//   household is in the UAE (Asia/Dubai) and metric;
// - the plan of that day; the cook sheet; a quick rating of the dinner;
// - a chat turn in which the agent asks for a protected change: its proposal card is accepted and
//   the accepted change is in the change log.
// axe-core runs on every screen the flows visit, light and dark: no serious or critical finding.
// Negative controls: axe reports a known-bad page (here); a flow fails when its route is removed
// from a disposable copy (the verify script runs this spec against that copy's build).
// Change-log titles are not pinned (R-70 amendment 1): the entry is found by id and source.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { migrateAndSeed } from "@mealplanner/db/seed";
import { measure } from "../../../../packages/db/test/node/support";
import {
  loadRecordings,
  recordedModelEnv,
  startRecordedModel,
  type RecordedModel,
} from "../../test/node/recorded-model";
import {
  requiredEnv,
  startBuiltApp,
  startWorker,
  type BuiltApp,
  type Child,
} from "../../test/node/support";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;

const ANSWERS = {
  people: "Omar 41, Sara 39, Layla 18, Adam 15, Zayd 10",
  omar: "2150 cal, 180p 200c 70f",
  sara: "1655 / 130 / 160 / 55",
  never: "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.",
};

let model: RecordedModel;
let app: BuiltApp;
let worker: Child;
/** Stops what the tests started, last first. */
const cleanup: (() => Promise<void>)[] = [];

test.beforeAll(async () => {
  test.setTimeout(600_000);
  const url = requiredEnv("NODE_DB_URL");
  await migrateAndSeed(url);
  model = await startRecordedModel(loadRecordings("product-parse", {}));
  cleanup.push(() => model.close());
  worker = await startWorker(url, recordedModelEnv(model));
  cleanup.push(() => worker.stop());
  app = await startBuiltApp(url, recordedModelEnv(model));
  cleanup.push(() => app.stop());
});

test.afterAll(async () => {
  for (const stop of cleanup.reverse()) await stop();
});

/** axe-core in light and dark once the finite animations have ended: no serious or critical finding. */
async function axe(page: Page, where: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const bad = result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) =>
          `${v.id} (${String(v.impact)}): ${v.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 3)
            .join(" | ")}`,
      );
    measure({ check: "axe", where, colorScheme, serious: bad.length });
    expect(bad, `${where} (${colorScheme})`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function json<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(path);
  expect(res.status(), `${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

interface Household {
  date: string;
  dinnerId: string;
  dinnerName: string;
  dishNames: string[];
  omarId: string;
}

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.name} px`, () => {
    // One household per width, carried from flow to flow.
    test.describe.configure({ mode: "serial" });
    let ctx: BrowserContext;
    let page: Page;
    let hh: Household;

    test.beforeAll(async ({ browser }) => {
      ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        baseURL: app.url,
      });
      page = await ctx.newPage();
    });

    test.afterAll(async () => {
      await ctx.close();
    });

    test(`SC-5 onboarding to a first plan at ${vp.name} px: at most five questions, UAE, metric`, async () => {
      const email = `node14-${vp.name}-${String(Date.now())}@example.test`;
      const signup = await page.request.post("/api/v1/signup", {
        data: {
          email,
          password: "correct horse battery",
          name: "Omar",
          householdName: `SC-5 ${vp.name}`,
        },
      });
      expect(signup.status(), await signup.text()).toBe(201);
      await page.goto("/onboarding");
      const steps = new Set<string>();
      const required: number[] = [];
      const record = async () => {
        const main = page.locator("[data-onboarding-step]");
        steps.add((await main.getAttribute("data-onboarding-step")) ?? "?");
        required.push(await main.locator("[required], [aria-required='true']").count());
      };
      await expect(page.getByRole("heading", { name: "Who eats at home?" })).toBeVisible();
      await axe(page, `onboarding question 1 at ${vp.name}`);
      await page.getByLabel("Household members").fill(ANSWERS.people);
      await expect(page.getByText("Zayd · 10")).toBeVisible();
      await record();
      await page.getByRole("button", { name: "Next", exact: true }).click();

      await expect(page.getByRole("heading", { name: "Who follows macro targets?" })).toBeVisible();
      await page.getByRole("button", { name: "Omar", exact: true }).click();
      await page.getByRole("button", { name: "Sara", exact: true }).click();
      await page.getByLabel("Omar's targets").fill(ANSWERS.omar);
      await page.getByLabel("Sara's targets").fill(ANSWERS.sara);
      await expect(page.getByText("Read as 2150 kcal · P180 C200 F70 (total carbs)")).toBeVisible();
      await record();
      await page.getByRole("button", { name: "Next", exact: true }).click();

      await expect(
        page.getByRole("heading", { name: "What does a normal week look like?" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Kids go to school" }).click();
      await record();
      await page.getByRole("button", { name: "Next", exact: true }).click();

      await expect(
        page.getByRole("heading", { name: "What food does the family love?" }),
      ).toBeVisible();
      for (const c of ["Levantine", "Italian", "Indian", "British"])
        await page.getByRole("button", { name: c, exact: true }).click();
      await record();
      await page.getByRole("button", { name: "Next", exact: true }).click();

      await expect(
        page.getByRole("heading", { name: "Anything anyone must never eat?" }),
      ).toBeVisible();
      await page.getByLabel("Never eat").fill(ANSWERS.never);
      await expect(page.getByText(/Zayd: never anything with sesame/)).toBeVisible();
      await record();
      await page.getByRole("button", { name: "See what I worked out" }).click();

      await expect(page.getByRole("heading", { name: "Here's what I worked out" })).toBeVisible();
      await axe(page, `onboarding review at ${vp.name}`);
      await page.getByRole("button", { name: "Looks right: plan tomorrow" }).click();
      await expect(page.getByRole("heading", { name: "Tomorrow is planned" })).toBeVisible({
        timeout: 240_000,
      });
      await axe(page, `first plan at ${vp.name}`);

      const household = await json<{ timezone: string; countryCode: string; unitSystem: string }>(
        page,
        "/api/v1/households/current",
      );
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: household.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      const date = d.toISOString().slice(0, 10);
      const plans = await json<{
        days: {
          date: string;
          meals: { id: string; slotKey: string; dishName: string; memberScope: string }[];
        }[];
      }>(page, `/api/v1/plans?from=${date}&to=${date}`);
      const day = plans.days.find((x) => x.date === date);
      const dinner = day?.meals.find((m) => m.slotKey === "dinner" && m.memberScope === "shared");
      const members = await json<{ members: { id: string; displayName: string }[] }>(
        page,
        "/api/v1/members",
      );
      measure({
        check: "onboarding",
        width: vp.name,
        questions: steps.size,
        requiredInputs: required.reduce((a, b) => a + b, 0),
        timezone: household.timezone,
        countryCode: household.countryCode,
        unitSystem: household.unitSystem,
        meals: day?.meals.length ?? 0,
      });
      expect(steps.size).toBeGreaterThan(0);
      expect(steps.size).toBeLessThanOrEqual(5);
      expect(household.timezone).toBe("Asia/Dubai");
      expect(household.countryCode).toBe("AE");
      expect(household.unitSystem).toBe("metric");
      expect(dinner).toBeDefined();
      hh = {
        date,
        dinnerId: dinner?.id ?? "",
        dinnerName: dinner?.dishName ?? "",
        // The week grid names a slot's dish when it is shared (an individual slot shows the count).
        dishNames: [
          ...new Set(
            day?.meals.filter((m) => m.memberScope === "shared").map((m) => m.dishName) ?? [],
          ),
        ],
        omarId: members.members.find((m) => m.displayName === "Omar")?.id ?? "",
      };
      expect(hh.omarId).not.toBe("");
    });

    test(`SC-5 the plan at ${vp.name} px`, async () => {
      await page.goto(`/plan?week=${hh.date}`);
      await expect(page.getByText(hh.dinnerName).first()).toBeVisible({ timeout: 60_000 });
      for (const name of hh.dishNames) await expect(page.getByText(name).first()).toBeAttached();
      await axe(page, `plan at ${vp.name}`);
      measure({ check: "plan", width: vp.name, dishes: hh.dishNames.length });
    });

    test(`SC-5 the cook sheet at ${vp.name} px`, async () => {
      await page.goto(`/kitchen?date=${hh.date}`);
      await expect(page.getByRole("heading", { name: "Plating table" }).first()).toBeVisible({
        timeout: 60_000,
      });
      const text = (await page.locator("main").textContent()) ?? "";
      const quantities = text.match(/\d[\d,.]*\s?(?:kg|g)\b/g) ?? [];
      measure({ check: "cooksheet", width: vp.name, quantities: quantities.length });
      expect(quantities.length).toBeGreaterThan(0);
      await axe(page, `cook sheet at ${vp.name}`);
    });

    test(`SC-5 a review at ${vp.name} px`, async () => {
      await page.goto(`/reviews/rate?planMealId=${hh.dinnerId}`);
      const sheet = page.getByRole("dialog", { name: hh.dinnerName });
      await expect(sheet).toBeVisible();
      await axe(page, `quick rating at ${vp.name}`);
      await sheet.getByRole("radio", { name: "4 of 5" }).check({ force: true });
      await sheet.getByRole("button", { name: "Done" }).click();
      await page.waitForURL("**/reviews");
      await axe(page, `reviews at ${vp.name}`);
      const reviews = await json<{
        reviews: { planMealId: string | null; rating: number | null }[];
      }>(page, "/api/v1/reviews?limit=200");
      const mine = reviews.reviews.filter((r) => r.planMealId === hh.dinnerId && r.rating === 4);
      measure({ check: "review", width: vp.name, stored: mine.length });
      expect(mine).toHaveLength(1);
    });

    test(`SC-5 a chat proposal accepted and visible in the change log at ${vp.name} px`, async () => {
      model.add(loadRecordings("product-chat", { OMAR_ID: hh.omarId }));
      await page.goto("/chat?new=1");
      await page
        .getByRole("textbox", { name: "Message" })
        .fill("Loosen Omar's protein tolerance to 10 g, please.");
      await page.getByRole("button", { name: "Send" }).click();
      const log = page.getByRole("log", { name: "Conversation" });
      const card = log.locator("[data-card=proposal]");
      await expect(card).toBeVisible({ timeout: 60_000 });
      await axe(page, `chat with a proposal at ${vp.name}`);
      await card.getByRole("button", { name: /^Accept/ }).click();
      await expect(card.getByText("Accepted", { exact: true })).toBeVisible();
      const accepted = await json<{ proposals: { changeSetId: string | null; kind: string }[] }>(
        page,
        "/api/v1/proposals?status=accepted",
      );
      const changeSetId = accepted.proposals.find((p) => p.changeSetId !== null)?.changeSetId ?? "";
      const log2 = await json<{ entries: { id: string; source: string }[] }>(
        page,
        "/api/v1/change-sets?limit=100",
      );
      const entry = log2.entries.find((e) => e.id === changeSetId);
      expect(entry?.source).toBe("proposal_accept");
      await page.goto("/changelog");
      const badge = page.getByText(/^Proposal accepted by you$/);
      await expect(badge.first()).toBeVisible({ timeout: 60_000 });
      await axe(page, `change log at ${vp.name}`);
      measure({
        check: "chat",
        width: vp.name,
        changeSetId,
        source: entry?.source,
        badges: await badge.count(),
      });
      expect(model.failures, model.failures.join("\n")).toEqual([]);
    });
  });
}

test("SC-5 the recorded model answered every request, and no live call was made", () => {
  const parse = [...model.answered.entries()].filter(([name]) => name.startsWith("parse:"));
  measure({
    check: "model",
    requests: model.requests.length,
    failures: model.failures,
    remaining: model.remaining(),
    parse: parse.reduce((n, [, count]) => n + count, 0),
    chat: model.answered.get("chat: loosen Omar's protein tolerance") ?? 0,
  });
  expect(model.failures, model.failures.join("\n")).toEqual([]);
  expect(model.remaining()).toEqual([]);
  expect(model.answered.get("chat: loosen Omar's protein tolerance")).toBe(2);
  expect(parse.reduce((n, [, count]) => n + count, 0)).toBeGreaterThan(0);
});

test("negative control: axe reports a known-bad page", async ({ page }) => {
  await page.setContent(
    `<html lang="en"><body><main><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button></button><a href="#"></a></main></body></html>`,
  );
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  measure({ check: "axe-control", serious: bad.length, ids: bad.map((v) => v.id) });
  expect(bad.length).toBeGreaterThan(0);
});
