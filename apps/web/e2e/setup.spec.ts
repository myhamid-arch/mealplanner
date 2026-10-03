// Leaf 1.4.7 (W-5, BLD-8 R-55, R-56), against a real database and worker (the verify script starts
// both and passes DATABASE_URL, AUTH_SECRET and APP_URL to `next start`):
//   @G4  at 390 and 1280 px, with axe-core (no serious or critical violation, light and dark) and
//        no horizontal scroll: the first-days page (today's follow-up card, coming up, the
//        checklist; answering it), the onboarding parse confirmation (and the page keeping its
//        own reading without a credential), and the Planning balance "Next week, if you save"
//        panel (figures, changes, Save & replan); the follow-up card on Today (admins only, R-57).
//   @G1  (also) the onboarding page without a credential: no confirmation, its own reading stays.
//   Negative controls: axe reports a known-bad page; a page wider than the viewport is reported.
// The parse route is answered in the browser by `page.route` with a typed reading (the route and
// the model client themselves are G1's); no credential is used. Screenshots for the architect's
// review (G5) go to $SETUP_SCREENSHOT_DIR.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inferSetup,
  parseNeverEat,
  parsePeople,
  parseTargets,
  type OnboardingAnswers,
} from "@mealplanner/core/onboarding";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;

const SHOTS = process.env.SETUP_SCREENSHOT_DIR ?? join(tmpdir(), "mise-setup-screenshots");

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

async function postJson<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  status: number,
) {
  const res = await request.post(path, { data });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

/** The mockup's household through the five answers and 1.4.3's `inferSetup`, as onboarding saves it. */
async function onboardMockupFamily(page: Page): Promise<void> {
  await signup(page, "firstdays");
  const people = parsePeople("Omar 41, Sara 39, Layla 18 F, Adam 15 M, Zayd 10 M");
  const omar = parseTargets("2150 cal, 180p 200c 70f");
  const sara = parseTargets("1655 / 130 / 160 / 55");
  if (!omar.ok || !sara.ok) throw new Error("targets did not parse");
  const answers: OnboardingAnswers = {
    people,
    targets: [
      { person: "Omar", numbers: omar.value },
      { person: "Sara", numbers: sara.value },
    ],
    week: {
      school: { people: ["Layla", "Adam", "Zayd"], weekdays: [0, 1, 2, 3, 4] },
      work: { people: ["Omar"], weekdays: [0, 1, 2, 3, 4] },
      training: [{ person: "Omar", weekdays: [0, 2, 4], time: "evening" }],
      snacks: true,
    },
    cuisines: ["levantine", "italian"],
    neverEat: parseNeverEat(
      "Zayd is allergic to sesame.",
      people.map((p) => p.name),
    ),
  };
  const [slots, cuisines, ingredients, household] = await Promise.all([
    getJson<{ slots: never[] }>(page.request, "/api/v1/slots"),
    getJson<{ cuisines: never[] }>(page.request, "/api/v1/cuisines"),
    getJson<{ ingredients: never[] }>(page.request, "/api/v1/ingredients?limit=500"),
    getJson<{ satFatDefaultPct: number }>(page.request, "/api/v1/households/current"),
  ]);
  const setup = inferSetup(answers, {
    referenceYear: new Date().getFullYear(),
    adminName: "Omar",
    slots: slots.slots,
    cuisines: cuisines.cuisines,
    ingredients: ingredients.ingredients,
    satFatDefaultPct: household.satFatDefaultPct,
    newId: () => crypto.randomUUID(),
  });
  await postJson(
    page.request,
    "/api/v1/change-sets",
    { summary: "Household set up from onboarding", ops: setup.changeOps },
    201,
  );
}

/** Waits for a job to finish through the API. */
async function jobDone(request: APIRequestContext, jobId: string): Promise<void> {
  await expect
    .poll(
      async () => (await getJson<{ status: string }>(request, `/api/v1/jobs/${jobId}`)).status,
      {
        timeout: 240_000,
        intervals: [500],
      },
    )
    .toBe("succeeded");
}

async function tomorrow(page: Page): Promise<string> {
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

async function scrollProblems(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth
      ? [
          `page is ${String(document.documentElement.scrollWidth)} px wide at ${String(window.innerWidth)} px`,
        ]
      : [],
  );
}

async function expectFits(page: Page, where: string) {
  expect(await scrollProblems(page), `${where}: horizontal scroll`).toEqual([]);
}

/** Waits for running CSS transitions to end, so axe measures the final colours. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

async function seriousViolations(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include !== undefined) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) => `${v.id} (${v.impact ?? ""}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
}

/** axe in light and dark; returns every serious or critical violation found. */
async function axeBoth(page: Page, where: string, include?: string): Promise<string[]> {
  const found: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await settled(page);
    for (const v of await seriousViolations(page, include))
      found.push(`${where} [${scheme}]: ${v}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await settled(page);
  return found;
}

async function shot(page: Page, name: string, selector?: string) {
  mkdirSync(SHOTS, { recursive: true });
  if (selector === undefined)
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  else await page.locator(selector).screenshot({ path: join(SHOTS, `${name}.png`) });
}

for (const vp of VIEWPORTS) {
  test(`@G4 first days at ${vp.name} px: today's card, coming up, the checklist; one answer a day`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await onboardMockupFamily(page);
    // Like the mockup's day: the first plan is made and the kitchen is invited.
    const job = await postJson<{ jobId: string }>(
      page.request,
      "/api/v1/plans/generate",
      { dates: [await tomorrow(page)] },
      202,
    );
    await jobDone(page.request, job.jobId);
    await postJson(
      page.request,
      "/api/v1/invites",
      { role: "kitchen", memberId: null, expiresIn: "7d", channel: "link" },
      201,
    );

    await page.goto("/getting-started");
    await expect(
      page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Omar$/ }),
    ).toBeVisible();
    await expect(
      page.getByText(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) · day 1$/),
    ).toBeVisible();
    const card = page.locator("[data-followup]");
    await expect(card).toHaveAttribute("data-followup", "school_nut_free");
    await expect(card.getByText("QUICK QUESTION · 1 OF 3")).toBeVisible();
    await expect(
      card.getByRole("heading", {
        // 1.2.6 (R-62): lunch boxes only (OQ-9).
        name: "Is the school nut-free? I'll keep nuts out of the lunch boxes.",
      }),
    ).toBeVisible();
    for (const label of ["Yes, nut-free", "No", "Not sure · Ask me later"])
      await expect(card.getByRole("button", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coming up, one per day" })).toBeVisible();
    await expect(page.getByText("Dinner at 19:30 — is that about right?")).toBeVisible();
    await expect(
      page.getByText("On training days, should Omar's total calories go up, or stay the same?"),
    ).toBeVisible();
    const checklist = page.getByRole("region", { name: "Getting set up" });
    await expect(checklist.getByText("3 / 6")).toBeVisible();
    await expect(checklist.getByRole("progressbar", { name: "Getting set up" })).toHaveAttribute(
      "aria-valuenow",
      "3",
    );
    for (const [label, done] of [
      ["Family added", true],
      ["First plan made", true],
      ["Kitchen invited", true],
      ["Rate your first 3 meals (takes 2 taps each)", false],
      ["Invite the family", false],
      ["Answer 3 optional questions", false],
    ] as const)
      await expect(checklist.locator("li", { hasText: label })).toHaveAttribute(
        "data-done",
        String(done),
      );
    await expectFits(page, "first days");
    expect(await axeBoth(page, "first days")).toEqual([]);
    await shot(page, `first-days-${vp.name}`);

    // One tap answers; no second question today; the answer is kept.
    await card.getByRole("button", { name: "Yes, nut-free" }).click();
    await expect(page.getByRole("heading", { name: "That's today's question done" })).toBeVisible();
    await expect(page.locator("[data-followup]")).toHaveCount(0);
    const exclusions = await getJson<{ exclusions: { key: string; slotKeys: string[] | null }[] }>(
      page.request,
      "/api/v1/exclusions",
    );
    const nuts = exclusions.exclusions.filter((e) => e.key === "contains_nuts");
    expect(nuts).toHaveLength(3);
    // 1.2.6 (R-62): scoped to the packed school lunch (OQ-9).
    expect(nuts.every((e) => e.slotKeys?.join() === "packed_school_lunch")).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "That's today's question done" })).toBeVisible();
    await expect(page.getByText("Dinner at 19:30 — is that about right?")).toBeVisible();
    await expectFits(page, "first days, answered");
    expect(await axeBoth(page, "first days, answered")).toEqual([]);
  });

  test(`@G4 parse confirmation at ${vp.name} px: the assistant's reading is shown, and used on request`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signup(page, "parse");
    const calls: unknown[] = [];
    await page.route("**/api/v1/onboarding/parse", async (route) => {
      calls.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          people: [
            { name: "Sara", age: 39, sex: "female" },
            { name: "Layla", age: 18, sex: "female" },
            { name: "Adam", age: 15, sex: "male" },
            { name: "Zayd", age: 10, sex: "male" },
          ],
        }),
      });
    });
    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "Household members" });
    await input.fill("my wife Sara 39 and our three kids Layla 18, Adam 15 and Zayd 10");
    const confirm = page.getByRole("region", { name: "The assistant's reading of the people" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText("The assistant read this as")).toBeVisible();
    await expect(confirm.getByText("Layla, 18, female")).toBeVisible();
    expect(calls).toEqual([
      { field: "people", text: "my wife Sara 39 and our three kids Layla 18, Adam 15 and Zayd 10" },
    ]);
    await expectFits(page, "parse confirmation");
    expect(await axeBoth(page, "parse confirmation")).toEqual([]);
    await shot(page, `parse-confirmation-${vp.name}`);
    await confirm.getByRole("button", { name: "Use this reading" }).click();
    await expect(confirm).toHaveCount(0);
    // The confirmed reading is the answer now: the next question offers exactly these people.
    await page.getByRole("button", { name: /^Next/ }).click();
    for (const name of ["Sara", "Layla", "Adam", "Zayd"])
      await expect(
        page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first(),
      ).toBeVisible();
    await expect(page.getByRole("button", { name: /^my wife/ })).toHaveCount(0);
  });

  test(`@G4 never-eat at ${vp.name} px (R-88): statements are read one by one, answers lock, nothing is tappable while reading`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signup(page, "nevereat");
    const rule = (who: string, keys: string[], reason = "other", keeps?: string) => ({
      who,
      term: "x",
      reason,
      target: { kind: "ingredient", keys },
      ...(keeps === undefined ? {} : { keeps }),
    });
    // One reading per statement; each answer is held until the test releases it.
    const readings: Record<string, unknown> = {
      "no lamb for Manal": {
        neverEat: [],
        questions: [
          {
            who: "Manal",
            said: "no lamb for manal",
            question: "Why does Manal avoid lamb?",
            options: [
              { label: "Allergy or medical", items: [rule("Manal", ["lamb-leg"], "medical")] },
              { label: "She doesn't like it", items: [rule("Manal", ["lamb-leg"], "dislike")] },
            ],
          },
        ],
        unclear: [],
      },
      "no bone in chicken for Yousif": {
        neverEat: [
          rule(
            "Yousif",
            ["chicken-drumstick", "chicken-wing", "chicken-whole"],
            "other",
            "boneless breast and mince",
          ),
        ],
        questions: [],
        unclear: [],
      },
      "Omar doesn't like cheese": {
        neverEat: [rule("Omar", ["cheddar", "feta"], "dislike")],
        questions: [],
        unclear: [],
      },
    };
    const sent: { field: string; text: string; context?: string; ages?: unknown }[] = [];
    let release: () => void = () => undefined;
    let gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/v1/onboarding/parse", async (route) => {
      const body = route.request().postDataJSON() as (typeof sent)[number];
      sent.push(body);
      if (body.field === "people")
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            people: [
              { name: "Yousif", age: 44, sex: null },
              { name: "Manal", age: 40, sex: null },
              { name: "Omar", age: 17, sex: null },
            ],
          }),
        });
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(readings[body.text]),
      });
    });
    await page.goto("/onboarding");
    await page
      .getByRole("textbox", { name: "Household members" })
      .fill("Yousif 44, Manal 40, Omar 17");
    await page.getByRole("button", { name: /^Next/ }).click();
    for (let i = 0; i < 3; i += 1) await page.getByRole("button", { name: "Skip" }).click();
    await expect(
      page.getByRole("heading", { name: "Anything anyone must never eat?" }),
    ).toBeVisible();
    const next = page.getByRole("button", { name: "See what I worked out" });
    await page.getByLabel("Never eat").fill("no lamb for Manal, no bone in chicken for Yousif");
    const cards = page.locator("[data-statement]");
    await expect(cards).toHaveCount(2);
    // While the assistant reads: each card says so, nothing to tap, and the step cannot be left.
    await expect(page.locator("[data-statement=reading]")).toHaveCount(2);
    await expect(page.locator("[data-never-question] button")).toHaveCount(0);
    await expect(next).toBeDisabled();
    await expect(page.getByText("Reading 2 statements…")).toBeVisible();
    await expectFits(page, "never-eat reading");
    expect(await axeBoth(page, "never-eat reading")).toEqual([]);
    await shot(page, `never-eat-reading-${vp.name}`);
    release();
    await expect(page.locator("[data-statement=needs-answer]")).toHaveCount(1);
    await expect(
      page.getByText("Yousif: never chicken drumstick, chicken wing and whole chicken"),
    ).toBeVisible();
    await expect(page.getByText("Still fine: boneless breast and mince")).toBeVisible();
    await expect(next).toBeDisabled();
    await expect(page.getByText("Answer 1 question to continue.")).toBeVisible();
    // Each statement went alone, with the whole answer and the ages for context.
    expect(
      sent
        .filter((b) => b.field === "never_eat")
        .map((b) => b.text)
        .sort(),
    ).toEqual(["no bone in chicken for Yousif", "no lamb for Manal"]);
    expect(sent.at(-1)).toMatchObject({
      context: "no lamb for Manal, no bone in chicken for Yousif",
      ages: [44, 40, 17],
    });
    await expectFits(page, "never-eat question");
    expect(await axeBoth(page, "never-eat question")).toEqual([]);
    await shot(page, `never-eat-question-${vp.name}`);
    await page
      .getByRole("group", { name: "Why does Manal avoid lamb?" })
      .getByRole("button", { name: "She doesn't like it" })
      .click();
    await expect(page.locator("[data-statement=settled]")).toHaveCount(2);
    await expect(page.getByText("✓ She doesn't like it")).toBeVisible();
    await expect(next).toBeEnabled();
    // More text: only the new statement is read; the answered one keeps its answer.
    gate = new Promise<void>((r) => (release = r));
    const before = sent.length;
    await page
      .getByLabel("Never eat")
      .fill("no lamb for Manal, no bone in chicken for Yousif, Omar doesn't like cheese");
    await expect(page.locator("[data-statement=reading]")).toHaveCount(1);
    await expect(page.getByText("✓ She doesn't like it")).toBeVisible();
    await expect(next).toBeDisabled();
    release();
    await expect(page.locator("[data-statement=settled]")).toHaveCount(3);
    expect(sent.slice(before).map((b) => b.text)).toEqual(["Omar doesn't like cheese"]);
    await next.click();
    for (const line of [
      "Manal: never lamb leg. Never planned for them.",
      "Yousif: never chicken drumstick, chicken wing and whole chicken. Never planned for them.",
      "Omar: never cheddar and feta (white cheese). Never planned for them.",
    ])
      await expect(page.getByText(line)).toBeVisible();
  });

  test(`@G1 @G4 without a credential at ${vp.name} px: no confirmation, the page keeps its own reading`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signup(page, "noparse");
    let calls = 0;
    await page.route("**/api/v1/onboarding/parse", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Service unavailable",
          status: 503,
          code: "model_unavailable",
        }),
      });
    });
    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "Household members" });
    await input.fill("Omar 41, Sara 39");
    await expect.poll(() => calls, { timeout: 10_000 }).toBe(1);
    // A later edit does not ask again (no credential for this page view).
    await input.fill("Omar 41, Sara 39, Zayd 10");
    await page.waitForTimeout(1500);
    expect(calls).toBe(1);
    await expect(page.getByRole("region", { name: /The assistant's reading/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Next/ }).click();
    for (const name of ["Omar", "Sara", "Zayd"])
      await expect(
        page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first(),
      ).toBeVisible();
  });

  test(`@G4 next-week preview at ${vp.name} px: figures, the meals that change, Save & replan`, async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await onboardMockupFamily(page);
    await page.goto("/settings/planning");
    await page
      .getByRole("radiogroup", { name: "Detail level for planning balance" })
      .getByRole("radio", { name: "Detailed" })
      .click();
    const panel = page.getByRole("region", { name: "Next week, if you save" });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-preview", "ready", { timeout: 300_000 });
    await expect(panel.getByText("No meals would change")).toBeVisible();
    await expect(panel.getByText("Different ingredients")).toBeVisible();
    await expect(panel.getByText("Meals on target")).toBeVisible();
    await expect(panel.locator("[data-metric=on-target]")).toHaveText(/^\d+(\.\d)?%$/);
    // A different balance: the panel works it out again and lists what would change.
    await page.getByRole("slider", { name: "Ingredient economy" }).fill("9");
    await page.getByRole("slider", { name: "Appeal" }).fill("2");
    await expect(panel).toHaveAttribute("data-preview", "working");
    await expect(panel).toHaveAttribute("data-preview", "ready", { timeout: 300_000 });
    await expect(panel.locator("[data-changes]")).toHaveText(
      /^(\d+ meals? would change|No meals would change)$/,
    );
    await expectFits(page, "planning balance with the preview");
    expect(await axeBoth(page, "planning preview")).toEqual([]);
    await shot(page, `planning-preview-${vp.name}`);
    await shot(page, `planning-preview-panel-${vp.name}`, "[data-preview]");
    await panel.getByRole("button", { name: "Save & replan" }).click();
    await expect(
      page.getByRole("link", { name: "Replanning next week: open the plan" }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(
        async () =>
          (await getJson<{ ingredientEconomy: number }>(page.request, "/api/v1/weights"))
            .ingredientEconomy,
      )
      .toBe(0.9);
  });
}

for (const vp of VIEWPORTS)
  test(`@G4 today card at ${vp.name} px: the admin answers today's question on Today; a member sees none`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await onboardMockupFamily(page);
    const members = await getJson<{ members: { id: string; displayName: string }[] }>(
      page.request,
      "/api/v1/members",
    );
    const sara = members.members.find((m) => m.displayName === "Sara");
    if (sara === undefined) throw new Error("no Sara");
    const code = (
      await postJson<{ code: string }>(
        page.request,
        "/api/v1/invites",
        { role: "member", memberId: sara.id, expiresIn: "7d", channel: "link" },
        201,
      )
    ).code;
    await page.goto("/today");
    const card = page.locator("[data-today-followup] [data-followup]");
    await expect(card).toHaveAttribute("data-followup", "school_nut_free");
    await expect(card.getByText("QUICK QUESTION · 1 OF 3")).toBeVisible();
    await expectFits(page, "today with the card");
    expect(await axeBoth(page, "today card", "[data-today-followup]")).toEqual([]);
    await shot(page, `today-card-${vp.name}`);
    await card.getByRole("button", { name: "Not sure · Ask me later", exact: true }).click();
    await expect(page.getByText("I'll ask again another day.")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Getting set up · \d+ \/ \d+$/ })).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-today-followup]")).toHaveCount(0);
    // A member of the household sees no follow-up card.
    const other = await browser.newContext();
    try {
      const memberPage = await other.newPage();
      await memberPage.setViewportSize({ width: vp.width, height: vp.height });
      const accept = await memberPage.request.post("/api/v1/invites/accept", {
        data: {
          code,
          signup: {
            email: `sara-${Math.random().toString(36).slice(2, 8)}@example.test`,
            password: "another horse battery",
            name: "Sara",
          },
        },
      });
      expect(accept.status(), await accept.text()).toBe(200);
      await memberPage.goto("/today");
      await expect(memberPage.getByRole("main")).toBeVisible();
      await expect(memberPage.locator("[data-today-followup]")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

test("@G4 negative control: axe reports an unlabelled button on a bad page", async ({ page }) => {
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>bad</title></head><body><main><section data-preview="bad" style="background:#2B2118;color:#3A2E23"><p>low contrast</p><button></button></section></main></body></html>`,
  );
  const v = await seriousViolations(page);
  expect(v.some((x) => x.startsWith("button-name"))).toBe(true);
  expect(v.some((x) => x.startsWith("color-contrast"))).toBe(true);
});

test("@G4 negative control: a page wider than the viewport is reported", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    `<!doctype html><body style="margin:0"><div style="width:1600px;height:10px"></div></body>`,
  );
  expect(await scrollProblems(page)).not.toEqual([]);
});
