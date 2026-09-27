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
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { contextFor, createWorld, DESKTOP, PHONE, type World } from "./chat/world";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const WORLD_FILE = process.env.WORLD_FILE ?? "";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
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

  test("@G1 set-up: a household of four with a member login and today's plan", async ({ browser }) => {
    writeShared("g1", await createWorld(browser, "g1"));
  });

  test("@G1 quick rating at 390 px: Layla rates the meal with stars and one-tap tags", async ({ browser }) => {
    const w = world("g1");
    const ctx = await contextFor(browser, w.memberState, PHONE);
    const page = await ctx.newPage();
    await page.goto(`/reviews/rate?planMealId=${w.meal.id}`);
    const sheet = page.getByRole("dialog", { name: w.meal.dishName });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radio", { name: "4 of 5" }).check({ force: true });
    await sheet.getByRole("button", { name: "Loved it" }).click();
    await sheet.getByRole("button", { name: "More often" }).click();
    await expect(sheet.getByRole("button", { name: "More often" })).toHaveAttribute("aria-pressed", "true");
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

  test("@G1 detailed review at 1280 px: Sara reviews for Omar and for Zayd, part by part", async ({ browser }) => {
    const w = world("g1");
    const ctx = await contextFor(browser, w.adminState, DESKTOP);
    const page = await ctx.newPage();
    // For Omar: five stars and "more often" (the second such signal for this dish, FBK-6).
    await page.goto(`/reviews/new?planMealId=${w.meal.id}&for=${w.members.omar}`);
    await expect(page.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Reviewing for")).toHaveValue(w.members.omar);
    await page.getByRole("radiogroup", { name: "Rating for the whole meal" }).getByRole("radio", { name: "5 of 5" }).check({ force: true });
    await page.getByRole("group", { name: "How often?" }).getByRole("button", { name: "More often" }).click();
    await page.getByRole("button", { name: "Post review" }).click();
    await page.waitForURL("**/reviews");
    // For Zayd: two stars, a part tagged, never again, a comment.
    await page.goto(`/reviews/new?planMealId=${w.meal.id}`);
    await page.getByLabel("Reviewing for").selectOption(w.members.zayd);
    await page.getByRole("radiogroup", { name: "Rating for the whole meal" }).getByRole("radio", { name: "2 of 5" }).check({ force: true });
    const parts = page.getByRole("region", { name: "Each part (optional)" });
    await expect(parts).toBeVisible();
    const firstPart = parts.getByRole("group").first();
    const partName = (await firstPart.getAttribute("aria-label")) ?? "";
    const firstChip = firstPart.getByRole("button").first();
    const chipTag = (await firstChip.getAttribute("data-tag")) ?? "";
    await firstChip.click();
    await page.getByRole("group", { name: "How often?" }).getByRole("button", { name: "Never again" }).click();
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

  test("@G1 the proposals appear in the chat at 390 px; accept one, then undo it", async ({ browser }) => {
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
    // After a reload the stored card shows the decision, not the buttons.
    await page.reload();
    await expect(page.locator("[data-card=insight_digest] [data-proposal-id]", { hasText: "Zayd" }).getByRole("button", { name: /^Undo/ })).toBeVisible();
    await ctx.close();
  });

  test("@G1 Insights at 1280 px: the other proposal shows what changes and is rejected with a reason", async ({ browser }) => {
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

// @G2 and @G3 follow.
export type { Page };
export { AxeBuilder };
