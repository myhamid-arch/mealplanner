// Leaf 1.4.3: Onboarding, Family, Settings, detail levels (against a real database and worker; the
// verify script starts both and passes DATABASE_URL, AUTH_SECRET and APP_URL to `next start`).
//   @G1  at 390 and 1280 px: onboarding → tomorrow's plan; family edits; settings edits; every
//        screen without horizontal scroll and with the mockup's structure
//   @G2  axe-core: no serious or critical violations on every screen state (light and dark)
//   @G3  R2-DL: auto tags, per-value override and back to auto, keep / reset when lowering
//   @G5  SC-6 required answers before the first plan; SC-7 every Adjust link resolves
// Each gate has a negative control: the same check on a known-bad page must fail.
// G5 writes what it measured to $LEAF143_TRACE_DIR; the verify script computes the verdicts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;

const MOCKUP = {
  people: "Omar 41, Sara 39, Layla 18, Adam 15, Zayd 10",
  omar: "2150 cal, 180p 200c 70f",
  sara: "1655 / 130 / 160 / 55",
  never: "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.",
};

let serial = 0;

async function signup(page: Page, tag: string): Promise<string> {
  serial += 1;
  const email = `${tag}-${String(serial)}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const res = await page.request.post("/api/v1/signup", {
    data: { email, password: "correct horse battery", name: "Omar", householdName: `Test ${tag}` },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { householdId: string }).householdId;
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.status(), `${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

async function applyOps(request: APIRequestContext, ops: unknown[]): Promise<void> {
  const res = await request.post("/api/v1/change-sets", { data: { summary: "test setup", ops } });
  expect(res.status(), await res.text()).toBe(201);
}

function uuid(): string {
  return crypto.randomUUID();
}

/** A small household through the API: Omar (targeted, trains Mon/Wed/Fri) and Zayd (10). */
async function family(page: Page): Promise<{ omar: string; zayd: string }> {
  await signup(page, "family");
  const omar = uuid();
  const zayd = uuid();
  await applyOps(page.request, [
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
        days: [
          { weekday: 0, sessionTime: "18:00:00" },
          { weekday: 2, sessionTime: "18:00:00" },
          { weekday: 4, sessionTime: "18:00:00" },
        ],
      },
    },
  ]);
  return { omar, zayd };
}

/** Problems with horizontal scrolling (the layout must fit the viewport). */
async function scrollProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth > width)
      out.push(
        `page is ${String(document.documentElement.scrollWidth)} px wide at ${String(width)} px`,
      );
    return out;
  });
}

async function expectFits(page: Page, where: string) {
  expect(await scrollProblems(page), `${where}: horizontal scroll`).toEqual([]);
}

async function tomorrowIn(page: Page): Promise<string> {
  const household = await getJson<{ timezone: string }>(page.request, "/api/v1/households/current");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: household.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface StepRecord {
  step: string;
  heading: string;
  inputs: number;
  requiredInputs: number;
  skipOffered: boolean;
}

/** Records one onboarding screen: its inputs and whether it can be passed without answering. */
async function recordStep(page: Page): Promise<StepRecord> {
  const main = page.locator("[data-onboarding-step]");
  const step = (await main.getAttribute("data-onboarding-step")) ?? "?";
  const heading = (await main.locator("h1").first().textContent()) ?? "";
  return {
    step,
    heading,
    inputs: await main.locator("input, textarea, select").count(),
    requiredInputs: await main.locator("[required], [aria-required='true']").count(),
    skipOffered: await main.getByRole("button", { name: "Skip", exact: true }).isVisible(),
  };
}

/** Answers the five questions with the Onboarding mockup's answers (or skips them all). */
async function onboard(
  page: Page,
  opts: { skipAll?: boolean; check?: (where: string) => Promise<void> } = {},
): Promise<StepRecord[]> {
  const steps: StepRecord[] = [];
  const check = opts.check ?? (async () => undefined);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Who eats at home?" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "What the app has worked out" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
  const skip = async () => {
    steps.push(await recordStep(page));
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  };
  if (opts.skipAll === true) {
    for (let i = 0; i < 5; i += 1) {
      await check(`question ${String(i + 1)} (skipped)`);
      await skip();
    }
  } else {
    await page.getByLabel("Household members").fill(MOCKUP.people);
    await expect(page.getByText("Zayd · 10")).toBeVisible();
    await check("question 1");
    steps.push(await recordStep(page));
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Who follows macro targets?" })).toBeVisible();
    await page.getByRole("button", { name: "Omar", exact: true }).click();
    await page.getByRole("button", { name: "Sara", exact: true }).click();
    await page.getByLabel("Omar's targets").fill(MOCKUP.omar);
    await page.getByLabel("Sara's targets").fill(MOCKUP.sara);
    await expect(page.getByText("Read as 2150 kcal · P180 C200 F70 (total carbs)")).toBeVisible();
    await check("question 2");
    steps.push(await recordStep(page));
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "What does a normal week look like?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Kids go to school" }).click();
    await page.getByRole("button", { name: "Someone eats lunch at work" }).click();
    await page
      .getByRole("group", { name: "Who eats lunch at work" })
      .getByRole("button", { name: "Omar" })
      .click();
    await page.getByRole("button", { name: "Someone trains" }).click();
    await check("question 3");
    steps.push(await recordStep(page));
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "What food does the family love?" }),
    ).toBeVisible();
    for (const c of ["Levantine", "Italian", "Indian", "British"])
      await page.getByRole("button", { name: c, exact: true }).click();
    await check("question 4");
    steps.push(await recordStep(page));
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Anything anyone must never eat?" }),
    ).toBeVisible();
    await page.getByLabel("Never eat").fill(MOCKUP.never);
    await expect(page.getByText(/Zayd: never anything with sesame/)).toBeVisible();
    await check("question 5");
    steps.push(await recordStep(page));
    await page.getByRole("button", { name: "See what I worked out" }).click();
  }
  await expect(page.getByRole("heading", { name: "Here's what I worked out" })).toBeVisible();
  await check("review");
  steps.push(await recordStep(page));
  await page.getByRole("button", { name: "Looks right: plan tomorrow" }).click();
  await expect(page.getByRole("heading", { name: "Tomorrow is planned" })).toBeVisible({
    timeout: 120_000,
  });
  await check("planned");
  return steps;
}

// G1 ---------------------------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.name} px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`@G1 onboarding to tomorrow's plan at ${vp.name} px`, async ({ page }) => {
      test.setTimeout(240_000);
      await signup(page, `onboard${vp.name}`);
      await onboard(page, { check: (where) => expectFits(page, `onboarding ${where}`) });
      // One change set holds the whole setup (R2-ONB-4).
      const log = await getJson<{ entries: { summary: string }[] }>(
        page.request,
        "/api/v1/change-sets?limit=50",
      );
      expect(
        log.entries.filter((e) => e.summary === "Household set up from onboarding"),
      ).toHaveLength(1);
      const members = await getJson<{
        members: { id: string; displayName: string; isTargeted: boolean }[];
      }>(page.request, "/api/v1/members");
      expect(members.members.map((m) => m.displayName).sort()).toEqual([
        "Adam",
        "Layla",
        "Omar",
        "Sara",
        "Zayd",
      ]);
      expect(
        members.members
          .filter((m) => m.isTargeted)
          .map((m) => m.displayName)
          .sort(),
      ).toEqual(["Omar", "Sara"]);
      const exclusions = await getJson<{
        exclusions: { kind: string; key: string; reason: string; memberId: string | null }[];
      }>(page.request, "/api/v1/exclusions");
      const zayd = members.members.find((m) => m.displayName === "Zayd")?.id;
      expect(exclusions.exclusions).toContainEqual(
        expect.objectContaining({
          memberId: zayd,
          kind: "dietary_flag",
          key: "contains_sesame",
          reason: "allergy",
        }),
      );
      // Tomorrow is planned, with a plate for every member at dinner.
      const date = await tomorrowIn(page);
      const plans = await getJson<{
        days: { date: string; meals: { plates: { memberId: string }[] }[] }[];
      }>(page.request, `/api/v1/plans?from=${date}&to=${date}`);
      const day = plans.days.find((d) => d.date === date);
      expect(day, "tomorrow has a plan day").toBeDefined();
      const plated = new Set(day?.meals.flatMap((m) => m.plates.map((p) => p.memberId)));
      for (const m of members.members)
        expect(plated.has(m.id), `${m.displayName} has a plate tomorrow`).toBe(true);
    });

    test(`@G1 family edits at ${vp.name} px`, async ({ page }) => {
      const { omar } = await family(page);
      await page.goto(`/family/${omar}`);
      for (const h of ["Daily targets", "Meals", "Training", "Tastes", "Allergies & never-serve"])
        await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
      await expectFits(page, "member page");
      // Change targets.
      await page.getByLabel("Calories").fill("2200");
      await page.getByRole("button", { name: "Save targets" }).click();
      await expect(page.getByText("Saved. It's in the change log")).toBeVisible();
      await expect
        .poll(
          async () =>
            (
              await getJson<{ targets: { memberId: string; kcal: number }[] }>(
                page.request,
                "/api/v1/targets",
              )
            ).targets.find((t) => t.memberId === omar)?.kcal,
        )
        .toBe(2200);
      // Add an allergy.
      await page.locator("#never-serve").getByRole("button", { name: "Add", exact: true }).click();
      await page.getByLabel("Food or allergen").fill("peanuts");
      await expect(page.getByText(/Everything flagged nuts/)).toBeVisible();
      await page.getByRole("button", { name: "Save rule" }).click();
      await expect(page.locator("[data-never-serve='Omar|allergy']")).toBeVisible();
      const ex = await getJson<{
        exclusions: { memberId: string | null; key: string; reason: string; hard: boolean }[];
      }>(page.request, "/api/v1/exclusions");
      expect(ex.exclusions).toContainEqual(
        expect.objectContaining({
          memberId: omar,
          key: "contains_nuts",
          reason: "allergy",
          hard: true,
        }),
      );
      // Add a person (from the list; on phones the list is its own page).
      await page.goto("/family");
      await page.getByRole("button", { name: "Add a person" }).click();
      await page.getByLabel("Name").fill("Nadia");
      await page.getByLabel("Age").fill("6");
      await page
        .getByRole("form", { name: "Add a person" })
        .getByRole("button", { name: "Add", exact: true })
        .click();
      await expect(page).toHaveURL(/\/family\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { name: "Nadia", exact: true })).toBeVisible();
      const members = await getJson<{ members: { displayName: string; appetite: string }[] }>(
        page.request,
        "/api/v1/members",
      );
      expect(members.members).toContainEqual(
        expect.objectContaining({ displayName: "Nadia", appetite: "small" }),
      );
      await page.reload();
      await expect(page.getByRole("heading", { name: "Nadia", exact: true })).toBeVisible();
      await expectFits(page, "new member page");
      // Family tastes and My tastes.
      await page.goto("/family/tastes");
      await expect(page.getByRole("heading", { name: "Family tastes" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Never serve" })).toBeVisible();
      await page.locator("[data-sticker='levantine']").click();
      await expect(page.locator("[data-sticker='levantine']")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expectFits(page, "family tastes");
      await page.goto("/family/me");
      await expect(page.getByRole("heading", { name: "My tastes" })).toBeVisible();
      await expectFits(page, "my tastes");
    });

    test(`@G1 settings edits at ${vp.name} px`, async ({ page }) => {
      await family(page);
      await page.goto("/settings");
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
      await expectFits(page, "settings");
      await page.goto("/settings/schedule");
      for (const h of ["Shared meals", "Individual meals"])
        await expect(page.getByRole("heading", { name: h })).toBeVisible();
      await expect(page.getByLabel("This week at a glance")).toBeVisible();
      await page.getByLabel("Packed school lunch on").check();
      await expect
        .poll(
          async () =>
            (
              await getJson<{ slots: { key: string; active: boolean }[] }>(
                page.request,
                "/api/v1/slots",
              )
            ).slots.find((s) => s.key === "packed_school_lunch")?.active,
        )
        .toBe(true);
      await expectFits(page, "meals & schedule");
      await page.goto("/settings/planning");
      for (const p of ["Macros first", "Balanced", "Crowd-pleaser", "Fewest ingredients"])
        await expect(page.getByRole("radio", { name: new RegExp(p) })).toBeVisible();
      await page.getByRole("radio", { name: /Crowd-pleaser/ }).click();
      await expect
        .poll(
          async () => (await getJson<{ appeal: number }>(page.request, "/api/v1/weights")).appeal,
        )
        .toBe(0.9);
      await expect(page.getByRole("radio", { name: /Crowd-pleaser/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expectFits(page, "planning balance");
      await page.goto("/settings/detail-levels");
      await expect(
        page.getByRole("heading", { name: "One control for detail, everywhere" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Daily targets" })).toBeVisible();
      await expectFits(page, "detail levels");
    });
  });
}

test("@G1 negative control: a page wider than the viewport is reported", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    `<!doctype html><body style="margin:0"><div style="width:1600px;height:10px"></div></body>`,
  );
  expect(await scrollProblems(page)).not.toEqual([]);
});

// G2 ---------------------------------------------------------------------------------------------

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id} (${v.impact ?? "?"}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
}

for (const vp of VIEWPORTS) {
  test(`@G2 axe on every screen of the leaf at ${vp.name} px, light and dark`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const found: string[] = [];
    const scan = async (where: string) => {
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const v of await seriousViolations(page)) found.push(`${where} [${scheme}]: ${v}`);
      }
      await page.emulateMedia({ colorScheme: "light" });
    };
    await signup(page, `axe${vp.name}`);
    await onboard(page, { check: scan });
    const members = await getJson<{ members: { id: string; displayName: string }[] }>(
      page.request,
      "/api/v1/members",
    );
    const omar = members.members.find((m) => m.displayName === "Omar")?.id ?? "";
    const layla = members.members.find((m) => m.displayName === "Layla")?.id ?? "";
    await page.goto("/family");
    await expect(page.getByRole("navigation", { name: "Family members" })).toBeVisible();
    await scan("family");
    await page.goto(`/family/${omar}`);
    await expect(page.getByRole("heading", { name: "Daily targets" })).toBeVisible();
    for (const level of ["Detailed", "Expert"] as const) {
      for (const scope of ["Omar's targets", "Omar's meals", "Omar's tastes"])
        await page
          .getByRole("radiogroup", { name: `Detail level for ${scope}` })
          .getByRole("radio", { name: level })
          .click();
      await page.waitForTimeout(300);
      await scan(`member at ${level}`);
    }
    // The keep / reset prompt.
    await page.locator("#meals [data-slot] [data-dl='auto']").first().click();
    await page.getByLabel(/share in %/).fill("30");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await expect(page.locator("#meals [data-dl='yours']")).toHaveCount(1);
    await page
      .getByRole("radiogroup", { name: "Detail level for Omar's meals" })
      .getByRole("radio", { name: "Basic" })
      .click();
    await expect(page.locator("[data-detail-prompt]")).toBeVisible();
    await scan("member keep/reset prompt");
    await page.getByRole("button", { name: "Keep them, just hide" }).click();
    await page.goto(`/family/${layla}`);
    await expect(page.getByRole("heading", { name: "Daily targets" })).toBeVisible();
    await scan("untargeted member");
    await page.goto("/family/tastes");
    await expect(page.getByRole("heading", { name: "Family tastes" })).toBeVisible();
    for (const level of ["Basic", "Detailed", "Expert"] as const) {
      await page
        .getByRole("radiogroup", { name: "Detail level for family tastes" })
        .getByRole("radio", { name: level })
        .click();
      await page.waitForTimeout(300);
      await scan(`family tastes at ${level}`);
    }
    await page.goto("/family/me");
    await expect(page.getByRole("heading", { name: "My tastes" })).toBeVisible();
    await scan("my tastes");
    await page.goto("/settings");
    await scan("settings");
    await page.goto("/settings/schedule?slot=packed_school_lunch");
    await expect(page.getByRole("heading", { name: "Shared meals" })).toBeVisible();
    for (const level of ["Basic", "Detailed", "Expert"] as const) {
      await page
        .getByRole("radiogroup", { name: "Detail level for meals and schedule" })
        .getByRole("radio", { name: level })
        .click();
      await page.waitForTimeout(300);
      await scan(`meals & schedule at ${level}`);
    }
    await page.goto("/settings/planning");
    await expect(page.getByRole("heading", { name: "Planning balance" })).toBeVisible();
    for (const level of ["Basic", "Detailed", "Expert"] as const) {
      await page
        .getByRole("radiogroup", { name: "Detail level for planning balance" })
        .getByRole("radio", { name: level })
        .click();
      await page.waitForTimeout(300);
      await scan(`planning balance at ${level}`);
    }
    await page.goto("/settings/detail-levels");
    await expect(
      page.getByRole("heading", { name: "One control for detail, everywhere" }),
    ).toBeVisible();
    await scan("detail levels");
    if (found.length > 0) console.log(found.join("\n"));
    expect(found).toEqual([]);
  });
}

test("@G2 negative control: axe reports an unlabelled image and button on a bad page", async ({
  page,
}) => {
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>bad</title></head><body><main><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"><button></button></main></body></html>`,
  );
  const v = await seriousViolations(page);
  expect(v.some((x) => x.startsWith("image-alt"))).toBe(true);
  expect(v.some((x) => x.startsWith("button-name"))).toBe(true);
});

// G3 ---------------------------------------------------------------------------------------------

/** Detailed split cards without a visible auto/yours tag (R2-DL-3: always shown). */
async function untaggedValues(page: Page): Promise<string[]> {
  return page
    .locator("#meals [data-slot]")
    .evaluateAll((cards) =>
      cards
        .filter((c) => c.querySelector("[data-dl]") === null && c.querySelector("form") === null)
        .map((c) => c.getAttribute("data-slot") ?? "?"),
    );
}

async function levelOf(
  request: APIRequestContext,
  memberId: string,
  section: string,
): Promise<string | undefined> {
  const r = await getJson<{
    levels: { memberId: string | null; section: string; level: string }[];
  }>(request, "/api/v1/detail-levels");
  return r.levels.find((l) => l.memberId === memberId && l.section === section)?.level;
}

async function distributions(request: APIRequestContext, memberId: string) {
  const s = await getJson<{
    distributions: { memberId: string; dayKind: string; slotTypeId: string; share: number }[];
  }>(request, "/api/v1/schedules");
  return s.distributions.filter((d) => d.memberId === memberId && d.dayKind === "default");
}

test.describe("R2-DL", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("@G3 automatic values carry auto; one value set is yours, the rest rebalance to 100 %, back to auto clears it", async ({
    page,
  }) => {
    const { omar } = await family(page);
    await page.goto(`/family/${omar}`);
    // Basic: the automatic split is visible with its tag.
    await expect(page.locator("#meals [data-split='basic'] [data-dl='auto']")).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "Detail level for Omar's meals" })
      .getByRole("radio", { name: "Detailed" })
      .click();
    await expect.poll(() => levelOf(page.request, omar, "meal_split")).toBe("detailed");
    await page.reload();
    await expect(
      page
        .getByRole("radiogroup", { name: "Detail level for Omar's meals" })
        .getByRole("radio", { name: "Detailed" }),
    ).toHaveAttribute("aria-checked", "true");
    const cards = page.locator("#meals [data-slot]");
    expect(await cards.count()).toBeGreaterThanOrEqual(4);
    expect(await untaggedValues(page)).toEqual([]);
    await expect(page.locator("#meals [data-dl='auto']")).toHaveCount(await cards.count());
    // Override breakfast.
    await page.locator("#meals [data-slot='breakfast'] [data-dl='auto']").click();
    await page.getByLabel("Breakfast share in %").fill("30");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await expect(page.locator("#meals [data-slot='breakfast'] [data-dl='yours']")).toBeVisible();
    await expect(page.locator("#meals [data-dl='yours']")).toHaveCount(1);
    const rows = await distributions(page.request, omar);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(rows.reduce((a, r) => a + r.share, 0) - 1)).toBeLessThanOrEqual(0.001);
    const slots = await getJson<{ slots: { id: string; key: string }[] }>(
      page.request,
      "/api/v1/slots",
    );
    const breakfast = slots.slots.find((s) => s.key === "breakfast")?.id;
    expect(rows.find((r) => r.slotTypeId === breakfast)?.share).toBeCloseTo(0.3, 4);
    await expect(page.locator("#meals [data-slot='breakfast'] [data-share]")).toHaveText("30 %");
    // Back to auto.
    await page.getByRole("button", { name: "Breakfast share: yours. Back to auto" }).click();
    await expect(page.locator("#meals [data-dl='yours']")).toHaveCount(0);
    await expect.poll(async () => (await distributions(page.request, omar)).length).toBe(0);
    // A target value: saturated fat at Detailed.
    await page
      .getByRole("radiogroup", { name: "Detail level for Omar's targets" })
      .getByRole("radio", { name: "Detailed" })
      .click();
    const sat = page.locator("[data-profile='Rest days'] [data-extra='satFatMaxG']");
    await expect(sat.locator("[data-dl='auto']")).toBeVisible();
    await expect(sat).toContainText("14"); // 6 % of 2150 kcal / 9 (R-28)
    await sat.locator("[data-dl='auto']").click();
    await sat.getByLabel("Sat fat max g").fill("20");
    await sat.getByRole("button", { name: "Set" }).click();
    await expect(sat.locator("[data-dl='yours']")).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await getJson<{
              targets: { memberId: string; kind: string; satFatMaxG: number | null }[];
            }>(page.request, "/api/v1/targets")
          ).targets.find((t) => t.memberId === omar && t.kind === "default")?.satFatMaxG,
      )
      .toBe(20);
    await sat.locator("[data-dl='yours']").click();
    await expect
      .poll(
        async () =>
          (
            await getJson<{
              targets: { memberId: string; kind: string; satFatMaxG: number | null }[];
            }>(page.request, "/api/v1/targets")
          ).targets.find((t) => t.memberId === omar && t.kind === "default")?.satFatMaxG,
      )
      .toBeNull();
  });

  test("@G3 lowering the level with your values asks Keep or Reset; keep hides them, reset clears them", async ({
    page,
  }) => {
    const { omar } = await family(page);
    await page.goto(`/family/${omar}`);
    const control = page.getByRole("radiogroup", { name: "Detail level for Omar's meals" });
    await control.getByRole("radio", { name: "Detailed" }).click();
    await page.locator("#meals [data-slot='lunch'] [data-dl='auto']").click();
    await page.getByLabel("Lunch share in %").fill("36");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await expect(page.locator("#meals [data-slot='lunch'] [data-dl='yours']")).toBeVisible();
    // Lower: the prompt appears; the level is not changed yet.
    await control.getByRole("radio", { name: "Basic" }).click();
    await expect(page.locator("[data-detail-prompt]")).toBeVisible();
    await expect(
      page.getByText("You changed some of these yourself. What should happen to them?"),
    ).toBeVisible();
    expect(await levelOf(page.request, omar, "meal_split")).toBe("detailed");
    // Keep: level lowered, rows kept, shown as hidden.
    await page.getByRole("button", { name: "Keep them, just hide" }).click();
    await expect.poll(() => levelOf(page.request, omar, "meal_split")).toBe("basic");
    expect((await distributions(page.request, omar)).length).toBeGreaterThan(0);
    await expect(page.locator("#meals [data-split='basic'] [data-dl='hidden']")).toBeVisible();
    // Back up: the value is still yours.
    await control.getByRole("radio", { name: "Detailed" }).click();
    await expect(page.locator("#meals [data-slot='lunch'] [data-dl='yours']")).toBeVisible();
    // Reset: level lowered, rows gone.
    await control.getByRole("radio", { name: "Basic" }).click();
    await page.getByRole("button", { name: "Reset to automatic" }).click();
    await expect.poll(async () => (await distributions(page.request, omar)).length).toBe(0);
    await expect.poll(() => levelOf(page.request, omar, "meal_split")).toBe("basic");
    await expect(page.locator("#meals [data-split='basic'] [data-dl='auto']")).toBeVisible();
    // Without values of your own, lowering asks nothing.
    await control.getByRole("radio", { name: "Expert" }).click();
    await control.getByRole("radio", { name: "Basic" }).click();
    await expect(page.locator("[data-detail-prompt]")).toHaveCount(0);
    // The hint says what the level adds (R2-DL-2).
    await expect(page.locator("#meals [data-detail-hint]")).toContainText(
      "Detailed lets you set any meal's share",
    );
  });

  test("@G3 the level is per member and per section", async ({ page }) => {
    const { omar, zayd } = await family(page);
    await page.goto(`/family/${omar}`);
    await page
      .getByRole("radiogroup", { name: "Detail level for Omar's meals" })
      .getByRole("radio", { name: "Expert" })
      .click();
    await expect.poll(() => levelOf(page.request, omar, "meal_split")).toBe("expert");
    expect(await levelOf(page.request, omar, "targets")).toBeUndefined();
    await page.goto(`/family/${zayd}`);
    await expect(
      page
        .getByRole("radiogroup", { name: "Detail level for Zayd's meals" })
        .getByRole("radio", { name: "Basic" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("@G3 negative control: a value without its tag is reported", async ({ page }) => {
    const { omar } = await family(page);
    await page.goto(`/family/${omar}`);
    await page
      .getByRole("radiogroup", { name: "Detail level for Omar's meals" })
      .getByRole("radio", { name: "Detailed" })
      .click();
    await expect(page.locator("#meals [data-slot]").first()).toBeVisible();
    expect(await untaggedValues(page)).toEqual([]);
    await page.locator("#meals [data-slot='dinner'] [data-dl]").evaluate((el) => {
      el.remove();
    });
    expect(await untaggedValues(page)).toEqual(["dinner"]);
  });
});

// G5 ---------------------------------------------------------------------------------------------

function trace(name: string, data: unknown) {
  const dir = process.env.LEAF143_TRACE_DIR;
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}

test.describe("SC-6, SC-7", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("@G5 SC-6 the answers asked before the first plan, answered and skipped", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signup(page, "sc6a");
    const answered = await onboard(page);
    const dateA = await tomorrowIn(page);
    const plansA = await getJson<{ days: { date: string; meals: unknown[] }[] }>(
      page.request,
      `/api/v1/plans?from=${dateA}&to=${dateA}`,
    );
    await page.context().clearCookies();
    await signup(page, "sc6b");
    const skipped = await onboard(page, { skipAll: true });
    const dateB = await tomorrowIn(page);
    const plansB = await getJson<{ days: { date: string; meals: unknown[] }[] }>(
      page.request,
      `/api/v1/plans?from=${dateB}&to=${dateB}`,
    );
    trace("sc6", {
      answered: {
        steps: answered,
        planned: (plansA.days.find((d) => d.date === dateA)?.meals.length ?? 0) > 0,
      },
      skipped: {
        steps: skipped,
        planned: (plansB.days.find((d) => d.date === dateB)?.meals.length ?? 0) > 0,
      },
    });
    expect(answered.filter((s) => s.step !== "5")).toHaveLength(5);
  });

  test("@G5 SC-7 every Adjust link after confirmation resolves to its setting", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signup(page, "sc7");
    await onboard(page);
    const hrefs = await page
      .locator("[data-adjust]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    const results: { href: string; status: number; target: string; visible: boolean }[] = [];
    for (const href of hrefs) {
      // A fresh navigation each time: a hash change on the same page would not load it again.
      await page.goto("about:blank");
      const res = await page.goto(href);
      const url = new URL(href, "http://x.invalid");
      let target: string;
      if (url.hash !== "") target = url.hash;
      else if (url.pathname === "/settings/schedule")
        target = `slot:${url.searchParams.get("slot") ?? ""}`;
      else target = "h1";
      let visible: boolean;
      if (target.startsWith("#"))
        visible = await page
          .locator(target)
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(
            () => true,
            () => false,
          );
      else if (target.startsWith("slot:")) {
        const slots = await getJson<{ slots: { key: string; label: string }[] }>(
          page.request,
          "/api/v1/slots",
        );
        const label = slots.slots.find((s) => s.key === target.slice(5))?.label ?? "?";
        visible = await page
          .getByRole("heading", { name: label, exact: true })
          .waitFor({ timeout: 15_000 })
          .then(
            () => true,
            () => false,
          );
      } else
        visible = await page
          .getByRole("heading", { level: 1 })
          .first()
          .waitFor({ timeout: 15_000 })
          .then(
            () => true,
            () => false,
          );
      results.push({ href, status: res?.status() ?? 0, target, visible });
    }
    trace("sc7", { explanations: hrefs.length, results });
    expect(results.filter((r) => r.status !== 200 || !r.visible)).toEqual([]);
  });
});
