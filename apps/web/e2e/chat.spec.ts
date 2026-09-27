// Leaf 1.4.5 end-to-end tests (scripts/verify/leaf-1.4.5.mjs runs them; leaf-1.4.5 ADR-1).
//   @G1  a quick rating (390 px) and detailed reviews (1280 px) → the insights run finds proposals
//        → accept in the chat, undo; reject with a reason on Insights (with the stubbed model).
//   @G2  axe-core: no serious or critical violations on every screen of the leaf, at 390 and
//        1280 px, light and dark; a negative control proves the scan finds violations.
//   @G3  the chat draws every AGT-7 card type from recorded tool results, live and replayed, and
//        each chat problem (409, 429, 503) as its own state.
//
// Environment (set by the verify script): PLAYWRIGHT_PORT (the running `next start`, with the
// scripted model preloaded: e2e/chat/agent-stub.mjs), PLAYWRIGHT_PORT_NO_MODEL (the same build
// without the stub, for 503), DATABASE_URL (the gate's database, migrated and seeded), WORLD_FILE
// (where the set-up test keeps what later tests need; the worker restarts after a failure).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { recordedRows } from "./chat/recorded";
import {
  BASE_URL,
  contextFor,
  createWorld,
  DESKTOP,
  PHONE,
  waitForJob,
  type World,
} from "./chat/world";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const WORLD_FILE = process.env.WORLD_FILE ?? "";

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

function readShared(): Record<string, unknown> {
  if (WORLD_FILE === "" || !existsSync(WORLD_FILE)) return {};
  return JSON.parse(readFileSync(WORLD_FILE, "utf8")) as Record<string, unknown>;
}

function writeShared(key: string, value: unknown) {
  if (WORLD_FILE === "") throw new Error("WORLD_FILE is not set");
  writeFileSync(WORLD_FILE, JSON.stringify({ ...readShared(), [key]: value }));
}

function world(key: string): World {
  const w = readShared()[key] as World | undefined;
  if (w === undefined) throw new Error(`the set-up for ${key} did not run`);
  return w;
}

// ---------------------------------------------------------------------------------------------
// @G1 — review with tags → proposal appears → accept → undo (stubbed model)
// ---------------------------------------------------------------------------------------------

test.describe.serial("@G1 reviews to proposals", () => {
  test.setTimeout(240_000);

  test("@G1 set-up: a household of four with a member login and today's plan", async ({
    browser,
  }) => {
    writeShared("g1", await createWorld(browser, "g1"));
  });

  test("@G1 quick rating at 390 px: Layla rates the meal with stars and one-tap tags", async ({
    browser,
  }) => {
    const w = world("g1");
    const ctx = await contextFor(browser, w.memberState, PHONE);
    const page = await ctx.newPage();
    await page.goto(`/reviews/rate?planMealId=${w.meal.id}`);
    const sheet = page.getByRole("dialog", { name: w.meal.dishName });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radio", { name: "4 of 5" }).check({ force: true });
    await sheet.getByRole("button", { name: "Loved it" }).click();
    await sheet.getByRole("button", { name: "More often" }).click();
    await expect(sheet.getByRole("button", { name: "More often" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sheet.getByRole("button", { name: "Done" }).click();
    await page.waitForURL("**/reviews");
    const card = page.locator("article", { hasText: "Layla" }).first();
    await expect(card).toContainText("4 stars");
    await expect(card).toContainText("Loved it");
    await expect(card).toContainText("More often");
    const rows = await sql<{ rating: number; tags: string[]; on_behalf_of_member_id: string }>(
      `SELECT rating, tags, on_behalf_of_member_id FROM review WHERE target_type = 'plan_meal' AND target_id = $1`,
      [w.meal.id],
    );
    expect(rows).toEqual([
      { rating: 4, tags: ["loved_it", "more_often"], on_behalf_of_member_id: w.members.layla },
    ]);
    await ctx.close();
  });

  test("@G1 detailed review at 1280 px: Sara reviews for Omar and for Zayd, part by part", async ({
    browser,
  }) => {
    const w = world("g1");
    const ctx = await contextFor(browser, w.adminState, DESKTOP);
    const page = await ctx.newPage();
    // For Omar: five stars and "more often" (the second such signal for this dish, FBK-6).
    await page.goto(`/reviews/new?planMealId=${w.meal.id}&for=${w.members.omar}`);
    await expect(page.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Reviewing for")).toHaveValue(w.members.omar);
    await page
      .getByRole("radiogroup", { name: "Rating for the whole meal" })
      .getByRole("radio", { name: "5 of 5" })
      .check({ force: true });
    await page
      .getByRole("group", { name: "How often?" })
      .getByRole("button", { name: "More often" })
      .click();
    await page.getByRole("button", { name: "Post review" }).click();
    await page.waitForURL("**/reviews");
    // For Zayd: two stars, a part tagged, never again, a comment.
    await page.goto(`/reviews/new?planMealId=${w.meal.id}`);
    await page.getByLabel("Reviewing for").selectOption(w.members.zayd);
    await page
      .getByRole("radiogroup", { name: "Rating for the whole meal" })
      .getByRole("radio", { name: "2 of 5" })
      .check({ force: true });
    const parts = page.getByRole("region", { name: "Each part (optional)" });
    await expect(parts).toBeVisible();
    const firstPart = parts.getByRole("group").first();
    const partName = (await firstPart.getAttribute("aria-label")) ?? "";
    const firstChip = firstPart.getByRole("button").first();
    const chipTag = (await firstChip.getAttribute("data-tag")) ?? "";
    await firstChip.click();
    await page
      .getByRole("group", { name: "How often?" })
      .getByRole("button", { name: "Never again" })
      .click();
    await page.getByLabel("Comment").fill("Zayd picked it all out. Not again, please.");
    await page.getByRole("button", { name: "Post review" }).click();
    await page.waitForURL("**/reviews");
    const card = page.locator("article", { hasText: "Zayd" }).first();
    await expect(card).toContainText("posted by Sara");
    await expect(card).toContainText("2 stars");
    await expect(card).toContainText("Never again");
    await expect(card).toContainText("Zayd picked it all out");
    expect(partName).not.toBe("");
    const zayd = await sql<{ target_type: string; tags: string[] }>(
      `SELECT target_type, tags FROM review WHERE on_behalf_of_member_id = $1 ORDER BY target_type`,
      [w.members.zayd],
    );
    expect(zayd).toEqual([
      { target_type: "component", tags: [chipTag] },
      { target_type: "plan_meal", tags: ["never_again"] },
    ]);
    await ctx.close();
  });

  test("@G1 the proposals appear in the chat at 390 px; accept one, then undo it", async ({
    browser,
  }) => {
    const w = world("g1");
    const ctx = await contextFor(browser, w.adminState, PHONE);
    const page = await ctx.newPage();
    await page.goto("/insights");
    await page.getByRole("link", { name: "Ask: what changed this week?" }).click();
    await page.waitForURL(/\/chat\?prompt=/);
    const box = page.getByRole("textbox", { name: "Message" });
    await expect(box).toHaveValue("What have you learned this week?");
    // Prefilled, not sent.
    await expect(page.locator("[data-role=user]")).toHaveCount(0);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("[data-role=user]")).toHaveText("What have you learned this week?");
    await expect(page.locator("[data-card=job_progress]")).toBeVisible();
    const digest = page.locator("[data-card=insight_digest]");
    await expect(digest).toBeVisible({ timeout: 90_000 });
    const never = digest.locator("[data-proposal-id]", { hasText: "Zayd" });
    await expect(never).toBeVisible();
    const proposalId = (await never.getAttribute("data-proposal-id")) ?? "";
    writeShared("g1Accepted", proposalId);
    await never.getByRole("button", { name: /^Accept/ }).click();
    await expect(never.getByText("Accepted", { exact: true })).toBeVisible();
    await never.getByRole("button", { name: /^Undo/ }).click();
    await expect(never.getByText("Accepted, then undone")).toBeVisible();
    // After a reload the stored card shows the decision (accepted, then undone), not the buttons.
    await page.reload();
    const again = page.locator("[data-card=insight_digest] [data-proposal-id]", {
      hasText: "Zayd",
    });
    await expect(again.getByText("Accepted, then undone")).toBeVisible();
    await expect(again.getByRole("button")).toHaveCount(0);
    await ctx.close();
  });

  test("@G1 Insights at 1280 px: the other proposal shows what changes and is rejected with a reason", async ({
    browser,
  }) => {
    const w = world("g1");
    const ctx = await contextFor(browser, w.adminState, DESKTOP);
    const page = await ctx.newPage();
    await page.goto("/insights");
    const waiting = page.locator("#waiting");
    await expect(waiting).toContainText("of max 5");
    const row = waiting.locator("[data-proposal-id]").first();
    await expect(row).toBeVisible();
    const proposalId = (await row.getAttribute("data-proposal-id")) ?? "";
    writeShared("g1Rejected", proposalId);
    await row.getByRole("button", { name: "What changes" }).click();
    await expect(row.locator("dl")).toBeVisible();
    await row.getByRole("button", { name: /^Reject/ }).click();
    await row.getByLabel(/Why not/).fill("we have it often enough");
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    await page.reload();
    await expect(page.getByText(/Rejected.*we have it often enough/)).toBeVisible();
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------------------------
// @G3 — every AGT-7 card from recorded tool results; the chat's problem states
// ---------------------------------------------------------------------------------------------

/** A proposal card as drawn: its badge, a before → after diff and Accept / Reject. */
async function isProposalCard(card: Locator): Promise<boolean> {
  return (
    (await card.getAttribute("data-card")) === "proposal" &&
    (await card.getByText("PROPOSAL", { exact: true }).count()) === 1 &&
    (await card.locator("dl").count()) > 0 &&
    (await card.getByRole("button", { name: /^Accept/ }).count()) === 1
  );
}

/** A macro table as drawn: a table with a row per member × slot and fit badges in words. */
async function isMacroTable(card: Locator): Promise<boolean> {
  return (
    (await card.getAttribute("data-card")) === "macro_table" &&
    (await card.locator("tbody tr").count()) >= 2 &&
    (await card.getByText("on target").count()) > 0
  );
}

async function newConversation(
  w: World,
  title: string,
  rows: { role: string; content: unknown }[],
) {
  const [conv] = await sql<{ id: string }>(
    `INSERT INTO conversation (id, household_id, user_id, title, created_at, archived_at)
     VALUES (gen_random_uuid(), $1, $2, $3, now() - interval '1 minute', NULL) RETURNING id`,
    [w.householdId, w.adminUserId, title],
  );
  if (conv === undefined) throw new Error("no conversation");
  for (const [i, r] of rows.entries())
    await sql(
      `INSERT INTO chat_message (id, household_id, conversation_id, role, content, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now() - interval '1 minute' + ($5 || ' seconds')::interval)`,
      [w.householdId, conv.id, r.role, JSON.stringify(r.content), String(i)],
    );
  return conv.id;
}

test.describe.serial("@G3 chat cards", () => {
  test.setTimeout(180_000);

  test("@G3 set-up: a household with today's plan", async ({ browser }) => {
    writeShared("g3", await createWorld(browser, "g3"));
  });

  test("@G3 live and replayed: a stubbed turn draws proposal, applied_change, plan_day and job_progress cards", async ({
    browser,
  }) => {
    const w = world("g3");
    const ctx = await contextFor(browser, w.adminState, DESKTOP);
    const page = await ctx.newPage();
    await page.goto("/chat?new=1");
    await page.getByRole("textbox", { name: "Message" }).fill("Show me every card, please");
    await page.getByRole("button", { name: "Send" }).click();
    const log = page.getByRole("log", { name: "Conversation" });
    // Live: the activity chips, then the cards as each tool finishes.
    await expect(log.locator("[data-card=proposal]")).toBeVisible();
    await expect(log.locator("[data-card=applied_change]")).toBeVisible();
    await expect(log.locator("[data-card=plan_day]")).toBeVisible();
    await expect(log.locator("[data-card=job_progress]")).toBeVisible();
    await expect(log.locator("table:not([data-comparison])")).toContainText("waiting for you");
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    const check = async () => {
      const proposal = log.locator("[data-card=proposal]");
      expect(await isProposalCard(proposal)).toBe(true);
      // R-34: a soft exclusion still means "never serve", never "may be served".
      // The slug "mushrooms" by its catalogue name ("Mushrooms, white"), R-36.
      await expect(proposal).toContainText(/Never serve mushrooms, white to (Layla|Zayd)/);
      await expect(proposal).not.toContainText(/may be served/i);
      // CP3 finding 1: labels, not stored values; defaults of a new row are not listed.
      await expect(proposal).toContainText("Ingredient");
      await expect(proposal).toContainText("Dislike");
      await expect(proposal).not.toContainText("dislike");
      await expect(proposal).not.toContainText("Protected from automatic change");
      const applied = log.locator("[data-card=applied_change]");
      await expect(applied).toContainText("APPLIED · you asked");
      await expect(applied).toContainText("More Italian for everyone");
      await expect(applied).not.toContainText(/"italian"|Locked|Rule/);
      await expect(applied.getByRole("button", { name: /^Undo/ })).toBeVisible();
      const day = log.locator("[data-card=plan_day]");
      await expect(day.locator("li").first()).toBeVisible();
      await expect(day).toContainText(/on target|close|off target|no targets/);
      await expect(log.locator("[data-card=job_progress]")).toContainText("Planning");
      await expect(log.getByText(/^Details · 5 steps$/)).toBeVisible();
    };
    await check();
    // Replayed from the stored rows (AGT-8).
    await page.reload();
    await check();
    // The cards act: undo the applied change, accept the proposal.
    await log.locator("[data-card=applied_change]").getByRole("button", { name: /^Undo/ }).click();
    await expect(log.locator("[data-card=applied_change]").getByText("Undone")).toBeVisible();
    await log
      .locator("[data-card=proposal]")
      .getByRole("button", { name: /^Accept/ })
      .click();
    await expect(
      log.locator("[data-card=proposal]").getByText("Accepted", { exact: true }),
    ).toBeVisible();
    // "New conversation" starts an empty one, twice in a row too.
    for (let i = 0; i < 2; i++) {
      await page.getByRole("link", { name: "New conversation" }).click();
      await expect(page.getByRole("heading", { name: "Ask the assistant" })).toBeVisible();
      await expect(log.locator("[data-role]")).toHaveCount(0);
    }
    await ctx.close();
  });

  test("@G3 recorded: recipe (Save, Discard), insight_digest, failed job_progress, macro_table and iteration_limit", async ({
    browser,
  }) => {
    const w = world("g3");
    const recorded = await recordedRows(DATABASE_URL, w.householdId);
    const id = await newConversation(w, "Recorded cards", recorded.rows);
    writeShared("g3Recorded", id);
    for (const width of [PHONE, DESKTOP]) {
      const ctx = await contextFor(browser, w.adminState, width);
      const page = await ctx.newPage();
      await page.goto(`/chat/${id}`);
      const log = page.getByRole("log", { name: "Conversation" });
      const recipe = log.locator("[data-card=recipe]");
      await expect(recipe.locator("[data-draft]")).toHaveCount(2);
      const first = recipe.locator("[data-draft]").first();
      await expect(first).toContainText(recorded.draftNames[0] ?? "?");
      await expect(first).toContainText("NEW");
      await expect(first).toContainText("Omar");
      await expect(first).toContainText("on target");
      await expect(recipe.locator("[data-draft]").nth(1)).toContainText("Not every target fits");
      await expect(recipe).toContainText("1 idea didn't pass the checks");
      const digest = log.locator("[data-card=insight_digest]");
      await expect(digest).toContainText("Tahini sauce too thick");
      await expect(digest).toContainText("2 more ideas were held back");
      await expect(
        log.locator("[data-card=job_progress]", { hasText: "Writing recipe ideas" }),
      ).toContainText("Finished");
      await expect(log.locator("[data-card=job_progress]", { hasText: "Planning" })).toContainText(
        "Did not finish: no feasible plate for Sara at lunch",
      );
      expect(await isMacroTable(log.locator("[data-card=macro_table]"))).toBe(true);
      await expect(log.locator("[data-card=macro_table] tbody tr")).toHaveCount(3);
      await expect(log.locator("[data-card=iteration_limit]")).toContainText(
        "Stopped after 12 steps",
      );
      await expect(log.locator("[data-card=iteration_limit]")).toContainText(
        "Not done yet: apply change",
      );
      // The unknown and the malformed card say so, and nothing else breaks.
      await expect(log.locator("[data-card=unreadable]")).toHaveCount(2);
      await ctx.close();
    }
    // Save the first draft (R-53: its own ops through POST /change-sets), discard the second.
    const ctx = await contextFor(browser, w.adminState, DESKTOP);
    const page = await ctx.newPage();
    await page.goto(`/chat/${id}`);
    const drafts = page.locator("[data-card=recipe] [data-draft]");
    await drafts.first().getByRole("button", { name: /^Save/ }).click();
    await expect(drafts.first().getByText("SAVED TO RECIPES")).toBeVisible();
    await drafts
      .nth(1)
      .getByRole("button", { name: /^Discard/ })
      .click();
    await expect(page.getByText(/^Discarded “/)).toBeVisible();
    const saved = await sql<{ source: string; name: string }>(
      `SELECT source, name FROM dish WHERE id = $1 AND household_id = $2`,
      [recorded.draftDishIds[0], w.householdId],
    );
    expect(saved).toEqual([{ source: "ai", name: recorded.draftNames[0] }]);
    const notSaved = await sql(`SELECT 1 FROM dish WHERE id = $1`, [recorded.draftDishIds[1]]);
    expect(notSaved).toHaveLength(0);
    // After a reload the saved draft reads as saved; the discarded one stays discarded.
    await page.reload();
    await expect(drafts.first()).toContainText("Saved to recipes.");
    await expect(page.getByText(/^Discarded “/)).toBeVisible();
    await ctx.close();
  });

  test("@G3 negative control: the card checks fail on the malformed proposal and on another card type", async ({
    browser,
  }) => {
    const w = world("g3");
    const id = readShared().g3Recorded as string;
    const ctx = await contextFor(browser, w.adminState, DESKTOP);
    const page = await ctx.newPage();
    await page.goto(`/chat/${id}`);
    const bad = page.locator("[data-card=unreadable][data-card-type=proposal]");
    await expect(bad).toHaveCount(1);
    expect(await isProposalCard(bad)).toBe(false);
    expect(await isMacroTable(page.locator("[data-card=iteration_limit]"))).toBe(false);
    await ctx.close();
  });

  test("@G3 problem states: 409 while another reply runs, 429 over the hourly limit, 503 without a model", async ({
    browser,
  }) => {
    const w = world("g3");
    const ctx = await contextFor(browser, w.adminState, PHONE);
    const page = await ctx.newPage();
    // 409: a slow reply is running in this conversation (another tab), then the admin sends.
    const busyId = await newConversation(w, "Busy", []);
    await page.goto(`/chat/${busyId}`);
    const slow = page.request.post(`/api/v1/conversations/${busyId}/messages`, {
      data: { text: "Take your time with this one" },
    });
    await expect
      .poll(
        async () =>
          (await sql(`SELECT 1 FROM chat_message WHERE conversation_id = $1`, [busyId])).length,
      )
      .toBeGreaterThan(0);
    await page.getByRole("textbox", { name: "Message" }).fill("And another thing");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("[data-problem=busy]")).toContainText("still running");
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("And another thing");
    await slow;
    // 429: the household has used this hour's turns (CHAT_TURNS_PER_HOUR, default 30).
    const limitId = await newConversation(
      w,
      "Limit",
      Array.from({ length: 30 }, (_, i) => ({
        role: "user",
        content: [{ type: "text", text: `turn ${String(i)}` }],
      })),
    );
    await page.goto(`/chat/${limitId}`);
    await page.getByRole("textbox", { name: "Message" }).fill("One more");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("[data-problem=limit]")).toContainText("this hour");
    await sql(`DELETE FROM chat_message WHERE conversation_id = $1`, [limitId]);
    // 503: the same app without a model.
    const port = process.env.PLAYWRIGHT_PORT_NO_MODEL ?? "";
    expect(port).not.toBe("");
    const bare = await browser.newContext({
      baseURL: `http://localhost:${port}`,
      viewport: PHONE,
      storageState: JSON.parse(w.adminState) as { cookies: []; origins: [] },
    });
    const p2 = await bare.newPage();
    await p2.goto("/chat?new=1");
    await p2.getByRole("textbox", { name: "Message" }).fill("Plan tomorrow");
    await p2.getByRole("button", { name: "Send" }).click();
    await expect(p2.locator("[data-problem=unavailable]")).toContainText(
      "isn't set up on this server",
    );
    await expect(p2.getByRole("textbox", { name: "Message" })).toBeDisabled();
    await bare.close();
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------------------------
// @G2 — axe-core on every screen of the leaf
// ---------------------------------------------------------------------------------------------

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  // UX-1: 390 px is first-class; a page wider than the screen hides content.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const layout =
    overflow > 0 ? [`horizontal-scroll (serious): page is ${String(overflow)} px too wide`] : [];
  return layout.concat(
    result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) =>
          `${v.id} (${String(v.impact)}): ${v.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 5)
            .join(", ")}`,
      ),
  );
}

/** Scans the open page in light, then dark (the tokens follow prefers-color-scheme live). */
async function scanBothSchemes(page: Page, state: string, failures: string[]) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
    for (const v of await seriousViolations(page)) failures.push(`${state} (${scheme}): ${v}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

type Flow = {
  name: string;
  session: "admin" | "member" | "fresh";
  run: (page: Page, scan: (state: string) => Promise<void>, w: World) => Promise<void>;
};

const FLOWS: readonly Flow[] = [
  {
    name: "reviews feed",
    session: "admin",
    run: async (p, scan) => {
      await p.goto("/reviews");
      await expect(p.locator("article").first()).toBeVisible();
      await scan("reviews feed");
      await p
        .locator("article")
        .first()
        .getByRole("button", { name: /^Reply/ })
        .click();
      await scan("reviews feed, replying");
      await p.getByRole("button", { name: "Kitchen" }).click();
      await scan("reviews feed, nothing matches");
    },
  },
  {
    name: "quick rating",
    session: "member",
    run: async (p, scan, w) => {
      await p.goto(`/reviews/rate?planMealId=${w.meal.id}`);
      const sheet = p.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await scan("quick rating");
      await sheet.getByRole("radio", { name: "5 of 5" }).check({ force: true });
      await sheet.getByRole("button", { name: "Loved it" }).click();
      await scan("quick rating, chosen");
    },
  },
  {
    name: "detailed review",
    session: "admin",
    run: async (p, scan, w) => {
      await p.goto(`/reviews/new?planMealId=${w.meal.id}&for=${w.members.zayd}`);
      await expect(p.getByRole("region", { name: "Each part (optional)" })).toBeVisible();
      await scan("detailed review");
      await p
        .getByRole("region", { name: "Each part (optional)" })
        .getByRole("button")
        .first()
        .click();
      await p
        .getByRole("group", { name: "How often?" })
        .getByRole("button", { name: "Never again" })
        .click();
      await scan("detailed review, tagged");
      await p.goto(`/reviews/new?targetType=dish&targetId=${w.meal.dishId}`);
      await expect(p.getByRole("button", { name: "Post review" })).toBeVisible();
      await scan("review of a dish");
    },
  },
  {
    name: "insights",
    session: "admin",
    run: async (p, scan) => {
      await p.goto("/insights");
      await expect(p.getByRole("heading", { name: "What the app has learned" })).toBeVisible();
      await expect(p.locator("#waiting [data-proposal-id]").first()).toBeVisible();
      await scan("insights");
      const row = p.locator("#waiting [data-proposal-id]").first();
      await row.getByRole("button", { name: "What changes" }).click();
      await expect(row.locator("dl")).toBeVisible();
      await row.getByRole("button", { name: /^Reject/ }).click();
      await scan("insights, a proposal opened and rejecting");
      await p.getByRole("button", { name: "Zayd", exact: true }).click();
      await scan("insights, another person");
    },
  },
  {
    name: "chat",
    session: "admin",
    run: async (p, scan) => {
      const cards = readShared().g2Cards as string;
      const recorded = readShared().g2Recorded as string;
      await p.goto(`/chat/${cards}`);
      await expect(p.locator("[data-card=proposal]")).toBeVisible();
      await scan("chat with live cards");
      await p.getByText(/^Details · /).click();
      await p.locator("[data-card=proposal]").getByRole("button", { name: /^Edit/ }).click();
      await expect(p.getByRole("button", { name: "Apply edited" })).toBeVisible();
      await scan("chat, editing a proposal");
      await p.goto(`/chat/${recorded}`);
      await expect(p.locator("[data-card=recipe]")).toBeVisible();
      await scan("chat with recorded cards");
      await p.goto("/chat?prompt=Plan%20tomorrow");
      await expect(p.getByRole("textbox", { name: "Message" })).toHaveValue("Plan tomorrow");
      await scan("chat, new with a prompt");
      const list = p.getByRole("button", { name: "Conversations" });
      if (await list.isVisible()) {
        await list.click();
        await scan("chat, conversation list (phone)");
      }
    },
  },
  {
    name: "side panel",
    session: "admin",
    run: async (p, scan) => {
      await p.goto("/insights");
      const open = p.getByRole("button", { name: "Open the assistant panel" });
      if (!(await open.isVisible())) return; // phones: the chat is a full-screen page instead
      await open.click();
      await expect(p.getByRole("complementary", { name: "Assistant" })).toBeVisible();
      await expect(p.getByRole("textbox", { name: "Message" })).toBeVisible();
      await scan("side panel");
    },
  },
  {
    name: "set up by conversation",
    session: "fresh",
    run: async (p, scan) => {
      await p.goto("/chat/setup");
      const answer = p.getByRole("textbox", { name: "Your answer" });
      await expect(answer).toBeVisible();
      await scan("chat set-up, first question");
      await answer.fill("Omar 41, Sara 39, Layla 18, Zayd 10");
      await p.getByRole("button", { name: "Send" }).click();
      await answer.fill("Omar 2150 cal, 180p 200c 70f; Sara 1655 / 130 / 160 / 55");
      await p.getByRole("button", { name: "Send" }).click();
      await p
        .getByRole("group", { name: "Packed school lunch, Mon–Fri" })
        .getByRole("button", { name: "Zayd" })
        .click();
      await p.getByRole("group", { name: "Trains" }).getByRole("button", { name: "Omar" }).click();
      await scan("chat set-up, the week");
      await p.getByRole("button", { name: "Done" }).click();
      await p
        .getByRole("group", { name: "Cuisines the family loves" })
        .getByRole("button")
        .first()
        .click();
      await p.getByRole("button", { name: "Done" }).click();
      await answer.fill("Zayd is allergic to sesame");
      await p.getByRole("button", { name: "Send" }).click();
      await expect(p.locator("[data-card=setup_proposal]")).toBeVisible();
      await expect(p.locator("[data-card=setup_proposal]")).toContainText("2150 · P180 C200 F70");
      await scan("chat set-up, the proposal");
    },
  },
];

test.describe("@G2 axe-core on every screen of the leaf", () => {
  test.describe.configure({ mode: "default" });
  test.setTimeout(300_000);

  test("@G2 set-up: reviews, proposals, a conversation with cards and a household to set up", async ({
    browser,
  }) => {
    const w = await createWorld(browser, "g2");
    writeShared("g2", w);
    const admin = await contextFor(browser, w.adminState, DESKTOP);
    const member = await contextFor(browser, w.memberState, DESKTOP);
    const post = async (ctx: typeof admin, data: unknown) => {
      const r = await ctx.request.post("/api/v1/reviews", { data });
      expect(r.status()).toBe(201);
    };
    await post(member, {
      targetType: "plan_meal",
      targetId: w.meal.id,
      planMealId: w.meal.id,
      rating: 4,
      tags: ["loved_it", "more_often"],
      comment: "Lovely, more of this.",
    });
    await post(admin, {
      targetType: "plan_meal",
      targetId: w.meal.id,
      planMealId: w.meal.id,
      onBehalfOfMemberId: w.members.omar,
      rating: 5,
      tags: ["more_often"],
    });
    await post(admin, {
      targetType: "plan_meal",
      targetId: w.meal.id,
      planMealId: w.meal.id,
      onBehalfOfMemberId: w.members.zayd,
      rating: 1,
      tags: ["never_again"],
      comment: "No thanks.",
    });
    const run = (await (await admin.request.post("/api/v1/insights/run", { data: {} })).json()) as {
      jobId: string;
    };
    await waitForJob(admin.request, run.jobId);
    // A conversation with live cards (the scripted model), and one with recorded cards.
    const conv = (await (
      await admin.request.post("/api/v1/conversations", { data: { title: "Every card" } })
    ).json()) as { id: string };
    const turn = await admin.request.post(`/api/v1/conversations/${conv.id}/messages`, {
      data: { text: "Show me every card" },
    });
    expect(turn.status()).toBe(200);
    await turn.text();
    writeShared("g2Cards", conv.id);
    const recorded = await recordedRows(DATABASE_URL, w.householdId);
    writeShared("g2Recorded", await newConversation(w, "Recorded cards", recorded.rows));
    // A household with nobody in it yet, for the set-up conversation.
    const fresh = await browser.newContext({ baseURL: BASE_URL });
    const signup = await fresh.request.post("/api/v1/signup", {
      data: {
        email: `omar-${w.run}@example.com`,
        password: "omar-password-1",
        name: "Omar",
        householdName: "New home",
      },
    });
    expect(signup.status()).toBe(201);
    writeShared("g2Fresh", JSON.stringify(await fresh.storageState()));
    await Promise.all([admin.close(), member.close(), fresh.close()]);
  });

  for (const viewport of [PHONE, DESKTOP]) {
    test(`@G2 every screen at ${String(viewport.width)} px, light and dark`, async ({
      browser,
    }) => {
      const w = world("g2");
      const sessions = {
        admin: w.adminState,
        member: w.memberState,
        fresh: readShared().g2Fresh as string,
      };
      const failures: string[] = [];
      for (const flow of FLOWS) {
        const ctx = await contextFor(browser, sessions[flow.session], viewport);
        const page = await ctx.newPage();
        await flow.run(page, (state) => scanBothSchemes(page, state, failures), w);
        await ctx.close();
      }
      expect(failures).toEqual([]);
    });
  }

  test("@G2 negative control: the scan reports an unnamed button, low-contrast text and a page wider than the screen", async ({
    browser,
  }) => {
    const w = world("g2");
    const ctx = await contextFor(browser, w.adminState, DESKTOP);
    const page = await ctx.newPage();
    await page.goto("/reviews");
    await expect(page.locator("article").first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.innerHTML = '<svg width="20" height="20" aria-hidden="true"></svg>';
      const t = document.createElement("p");
      t.textContent = "Faint text nobody can read";
      t.style.cssText = "color:#B8A791;background:#FFF8EE;font-size:14px";
      const wide = document.createElement("div");
      wide.style.cssText = "width:2000px;height:1px";
      document.querySelector("main")?.append(b, t, wide);
    });
    const found = await seriousViolations(page);
    expect(found.some((v) => v.startsWith("button-name"))).toBe(true);
    expect(found.some((v) => v.startsWith("color-contrast"))).toBe(true);
    expect(found.some((v) => v.startsWith("horizontal-scroll"))).toBe(true);
    await ctx.close();
  });
});
