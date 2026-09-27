// Leaf 1.4.6 end-to-end tests (scripts/verify/leaf-1.4.6.mjs runs them; leaf-1.4.6 ADR-3).
//   @G1  sign-in by password, by emailed link (magic-link, SMTP stub) and by invite code; invite
//        then accept; block then 401; remove; last-admin protection; change-log undo; the R-42
//        password-removed notice; sign-out clears the offline cache (R-21 Q-8).
//   @G2  axe-core: no serious or critical violations on every screen of the leaf, at 390 and
//        1280 px, light and dark; a negative control proves the scan finds violations.
//
// Environment (set by the verify script): PLAYWRIGHT_PORT (the running `next start`), DATABASE_URL
// (the gate's own database, already migrated), MAIL_DIR (where the SMTP stub writes each message
// as JSON). Tests in a group run in order and share the logins they create.
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

const MAIL_DIR = process.env.MAIL_DIR ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 800 } as const;
const PASSWORD_REMOVED_TEXT =
  "Your password was removed because you signed in by email link; set a new one in Account";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

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

interface Mail {
  to: string;
  subject: string;
  text: string;
  at: number;
}

function mails(): Mail[] {
  if (MAIL_DIR === "") throw new Error("MAIL_DIR is not set");
  return readdirSync(MAIL_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(MAIL_DIR, f), "utf8")) as Mail)
    .sort((a, b) => a.at - b.at);
}

/** The first link in the newest message to `to` whose subject matches, sent after `since`. */
async function mailedLink(to: string, subject: RegExp, since: number): Promise<string> {
  let found: Mail | undefined;
  await expect
    .poll(
      () => {
        found = mails()
          .filter(
            (m) =>
              m.to.toLowerCase().includes(to.toLowerCase()) &&
              subject.test(m.subject) &&
              m.at >= since,
          )
          .at(-1);
        return found !== undefined;
      },
      { timeout: 15_000, message: `an email to ${to} matching ${String(subject)}` },
    )
    .toBe(true);
  const link = /https?:\/\/\S+/.exec(found?.text ?? "")?.[0];
  if (link === undefined) throw new Error(`no link in the email to ${to}`);
  return link;
}

const browserContexts: BrowserContext[] = [];

async function newContext(browser: Browser, viewport: { width: number; height: number } = DESKTOP) {
  const baseURL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "3142"}`;
  const context = await browser.newContext({ baseURL, viewport });
  browserContexts.push(context);
  return context;
}

/**
 * Better Auth 1.7.6 rate-limits each /sign-in/* path per client address: 3 requests, and the count
 * resets only after 10 s without a request to that path (`decideConsume` in its rate limiter). The
 * tests sign in more often than a person would, from one address, so each attempt waits for the
 * count to reset instead of meeting a 429.
 */
// Kept in a file next to MAIL_DIR: Playwright restarts its worker after a failed test, and the
// server's counts do not reset with it.
const SHARED_FILE = MAIL_DIR === "" ? "" : join(MAIL_DIR, "..", "e2e-shared.json");

function readShared(): Record<string, unknown> {
  if (SHARED_FILE === "" || !existsSync(SHARED_FILE)) return {};
  return JSON.parse(readFileSync(SHARED_FILE, "utf8")) as Record<string, unknown>;
}

function writeShared(key: string, value: unknown) {
  if (SHARED_FILE === "") return;
  writeFileSync(SHARED_FILE, JSON.stringify({ ...readShared(), [key]: value }));
}

async function authSlot(path: "/sign-in/email" | "/sign-in/magic-link") {
  const quietMs = 10_500;
  const buckets = (readShared().authBuckets ?? {}) as Record<
    string,
    { count: number; last: number }
  >;
  const bucket = buckets[path] ?? { count: 0, last: 0 };
  if (Date.now() - bucket.last >= quietMs) bucket.count = 0;
  if (bucket.count >= 3) {
    await new Promise((r) => setTimeout(r, Math.max(0, bucket.last + quietMs - Date.now())));
    bucket.count = 0;
  }
  bucket.count += 1;
  bucket.last = Date.now();
  writeShared("authBuckets", { ...buckets, [path]: bucket });
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await clickSignIn(page);
}

async function clickSignIn(page: Page) {
  await authSlot("/sign-in/email");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function clickEmailLink(page: Page) {
  await authSlot("/sign-in/magic-link");
  await page.getByRole("button", { name: "Email me a one-time sign-in link" }).click();
}

/** The page's own alerts (Next's route announcer is also `role="alert"`, and empty). */
function alert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/** Asserts that the context's session is gone: its next API request is 401. */
async function expectUnauthorized(page: Page) {
  const res = await page.request.get("/api/v1/me");
  if (res.status() !== 401)
    throw new Error(`expected 401 from /api/v1/me, got ${String(res.status())}`);
}

/** Asserts the R-42 notice is on the page the emailed link landed on. */
async function expectPasswordRemovedNotice(page: Page) {
  const url = new URL(page.url());
  if (url.pathname !== "/signed-in" || url.searchParams.get("passwordRemoved") !== "1")
    throw new Error(
      `the link did not report a removed password (landed on ${url.pathname}${url.search})`,
    );
  await expect(page.getByTestId("password-removed")).toContainText(PASSWORD_REMOVED_TEXT, {
    timeout: 5_000,
  });
}

/** Asserts that change set `id` is recorded as undone and was undone by a later change set. */
async function expectUndoRestored(id: string) {
  const [row] = await sql<{ undone_at: Date | null; undone_by: string | null }>(
    `SELECT undone_at, undone_by_change_set_id AS undone_by FROM change_set WHERE id = $1`,
    [id],
  );
  if (row?.undone_at == null || row.undone_by === null)
    throw new Error(`change set ${id} is not undone`);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for a base32 secret. */
function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretBase32.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", bytes).update(counter).digest();
  const o = (h[h.length - 1] ?? 0) & 0xf;
  const n = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return n.padStart(6, "0");
}

async function createHousehold(
  page: Page,
  who: { name: string; email: string; password: string; household: string },
) {
  await page.goto("/create-household");
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByLabel("Household name").fill(who.household);
  await page.getByLabel(/^Area/).fill("Khalifa City, Abu Dhabi");
  await page.getByRole("button", { name: "Create household" }).click();
  await page.waitForURL("**/onboarding");
}

/** Creates an invite through the dialog; returns its link and code. */
async function inviteThroughDialog(
  page: Page,
  opts: { seat: string | RegExp; newName?: string; role: "Admin" | "Member" | "Kitchen" },
): Promise<{ link: string; code: string }> {
  await page.goto("/access");
  await page.getByRole("button", { name: "Invite someone" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByRole("button", { name: opts.seat, exact: true }).click();
  if (opts.newName !== undefined) await dialog.getByLabel("Their name").fill(opts.newName);
  await dialog.getByRole("radio", { name: opts.role }).check();
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const ready = page.getByRole("dialog", { name: "Invite ready" });
  await expect(ready.getByRole("img", { name: "QR code for the invite link" })).toBeVisible();
  const link = (await ready.getByTestId("invite-link").textContent()) ?? "";
  const code = ((await ready.getByTestId("invite-code").textContent()) ?? "").trim();
  await ready.getByRole("button", { name: "Done" }).click();
  return { link: link.trim(), code };
}

// ---------------------------------------------------------------------------------------------
// @G1
// ---------------------------------------------------------------------------------------------

test.describe("@G1 sign-in, people and access, change log", () => {
  test.describe.configure({ mode: "serial" });
  const run = Date.now().toString(36);
  const admin = {
    name: "Omar",
    email: `omar-${run}@example.com`,
    password: "averylongpassword",
    household: "Khalifa City home",
  };
  const layla = {
    email: `layla-${run}@example.com`,
    password: "sunnyhummus2026",
    newPassword: "anewpassword-2026",
  };
  const priya = { name: "Priya", email: `priya-${run}@example.com`, password: "kitchentablet-1" };
  // Set by the first tests; possibly unset when an earlier test failed.
  let adminCtx: BrowserContext | undefined;
  let adminPage: Page;
  let laylaCtx: BrowserContext;
  let priyaCtx: BrowserContext | undefined;
  let priyaPage: Page;
  let blockChangeSet = "";

  test.afterAll(async () => {
    // Every context the tests opened, even when an earlier test failed.
    await Promise.all(browserContexts.splice(0).map((c) => c.close()));
  });

  test("@G1 create a household: the new admin lands on set-up, signed in as its admin", async ({
    browser,
  }) => {
    adminCtx = await newContext(browser);
    adminPage = await adminCtx.newPage();
    await createHousehold(adminPage, admin);
    const me = (await (await adminPage.request.get("/api/v1/me")).json()) as {
      memberships: { role: string; householdName: string }[];
    };
    expect(me.memberships).toEqual([
      expect.objectContaining({ role: "admin", householdName: admin.household }),
    ]);
    const [h] = await sql<{ region_note: string }>(
      `SELECT region_note FROM household WHERE name = $1`,
      [admin.household],
    );
    expect(h?.region_note).toBe("Khalifa City, Abu Dhabi");
  });

  test("@G1 password sign-out clears the offline cache; password sign-in at 390 px goes home", async ({
    browser,
  }) => {
    await adminPage.goto("/account");
    await adminPage.evaluate(async () => {
      const cache = await caches.open("mise-pages-v1");
      await cache.put("/today", new Response("kept plan"));
    });
    expect(
      await adminPage.evaluate(async () =>
        (await caches.keys()).filter((k) => k.startsWith("mise-pages-")),
      ),
    ).toHaveLength(1);
    await adminPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await adminPage.waitForURL("**/sign-in?notice=signed-out");
    expect(
      await adminPage.evaluate(async () =>
        (await caches.keys()).filter((k) => k.startsWith("mise-pages-")),
      ),
    ).toEqual([]);
    await expectUnauthorized(adminPage);

    const phone = await newContext(browser, PHONE);
    const p = await phone.newPage();
    await signInWithPassword(p, admin.email, "wrong-password");
    await expect(alert(p)).toContainText("don't match");
    await p.getByLabel("Password", { exact: true }).fill(admin.password);
    await clickSignIn(p);
    await p.waitForURL("**/today");
    await phone.close();

    await signInWithPassword(adminPage, admin.email, admin.password);
    await adminPage.waitForURL("**/today");
  });

  test("@G1 invite then accept: a member invite with link and QR code, accepted at 390 px", async ({
    browser,
  }) => {
    const { link } = await inviteThroughDialog(adminPage, {
      seat: "A new person",
      newName: "Layla",
      role: "Member",
    });
    expect(link).toMatch(/\/invite\/[23456789A-HJ-NP-Z]{10}$/);
    laylaCtx = await newContext(browser, PHONE);
    const p = await laylaCtx.newPage();
    await p.goto(new URL(link).pathname);
    await expect(p.getByRole("heading", { name: admin.household })).toBeVisible();
    await expect(p.getByText("You are: Layla")).toBeVisible();
    await expect(p.getByText("Role: Member")).toBeVisible();
    await p.getByLabel("Your email").fill(layla.email);
    await p.getByLabel("Choose a password").fill(layla.password);
    await p.getByRole("button", { name: "Join the household" }).click();
    await p.waitForURL("**/family/me");
    await adminPage.goto("/access");
    const row = adminPage.getByTestId(`login-${layla.email}`);
    await expect(row).toContainText("Layla");
    await expect(row).toContainText("Active");
    // Single use: the same link now refuses.
    const again = await laylaCtx.newPage();
    await again.goto(new URL(link).pathname);
    await expect(alert(again)).toContainText("used, revoked or has expired");
    await again.close();
  });

  test("@G1 invite-code sign-in: a kitchen invite's code typed on the sign-in page", async ({
    browser,
  }) => {
    const { code } = await inviteThroughDialog(adminPage, {
      seat: /Doesn.t eat here \(staff\)/,
      role: "Kitchen",
    });
    expect(code).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{4}$/);
    priyaCtx = await newContext(browser, PHONE);
    priyaPage = await priyaCtx.newPage();
    await priyaPage.goto("/sign-in");
    await priyaPage.getByLabel("Invite code").fill(code.toLowerCase());
    await priyaPage.getByRole("button", { name: "Join" }).click();
    await priyaPage.waitForURL(`**/invite/${code.replaceAll("-", "")}`);
    await expect(priyaPage.getByText("Role: Kitchen")).toBeVisible();
    await priyaPage.getByLabel("Your name").fill(priya.name);
    await priyaPage.getByLabel("Your email").fill(priya.email);
    await priyaPage.getByLabel("Choose a password").fill(priya.password);
    await priyaPage.getByRole("button", { name: "Join the household" }).click();
    await priyaPage.waitForURL("**/kitchen");
    const me = (await (await priyaPage.request.get("/api/v1/me")).json()) as {
      memberships: { role: string }[];
    };
    expect(me.memberships.map((m) => m.role)).toEqual(["kitchen"]);
  });

  test("@G1 magic link: the first email-link sign-in of an unverified account removes its password and says so (R-42); a new one is set from Account", async ({
    browser,
  }) => {
    const ctx = await newContext(browser);
    const p = await ctx.newPage();
    const since = Date.now();
    await p.goto("/sign-in");
    await p.getByLabel("Email", { exact: true }).fill(layla.email);
    await clickEmailLink(p);
    await expect(
      p.getByRole("status").filter({ hasText: "sign-in link is on its way" }),
    ).toBeVisible();
    const link = await mailedLink(layla.email, /sign-in link/i, since);
    const header = p.waitForResponse((r) => r.url().includes("/api/auth/magic-link/verify"));
    await p.goto(link);
    expect((await header).headers()["x-password-removed"]).toBe("1");
    await expectPasswordRemovedNotice(p);
    // The library removed the credential and the other sessions.
    expect(
      await sql(
        `SELECT 1 FROM account a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1 AND a.provider_id = 'credential'`,
        [layla.email],
      ),
    ).toHaveLength(0);
    await p.getByRole("link", { name: "Set a new password in Account" }).click();
    await p.waitForURL("**/account?passwordRemoved=1*");
    await expect(p.getByTestId("password-removed-account")).toContainText(PASSWORD_REMOVED_TEXT);
    const sinceReset = Date.now();
    await p.getByRole("button", { name: "Set a new password" }).click();
    await expect(p.getByRole("status").filter({ hasText: "on its way" })).toBeVisible();
    const reset = await mailedLink(layla.email, /password/i, sinceReset);
    await p.goto(reset);
    await p.waitForURL("**/reset-password?token=*");
    await p.getByLabel("New password", { exact: true }).fill(layla.newPassword);
    await p.getByLabel("New password again").fill(layla.newPassword);
    await p.getByRole("button", { name: "Set password" }).click();
    await p.waitForURL("**/sign-in?notice=password-set");
    await signInWithPassword(p, layla.email, layla.password);
    await expect(alert(p)).toContainText("don't match");
    await signInWithPassword(p, layla.email, layla.newPassword);
    await p.waitForURL("**/today");
    await ctx.close();
    // Keep Layla signed in on her phone for the remove test.
    const lp = await laylaCtx.newPage();
    await signInWithPassword(lp, layla.email, layla.newPassword);
    await lp.waitForURL("**/today");
  });

  test("@G1 negative control: the notice check fails on a link sign-in that removed nothing (a verified account)", async ({
    browser,
  }) => {
    const ctx = await newContext(browser);
    const p = await ctx.newPage();
    const since = Date.now();
    await p.goto("/sign-in");
    await p.getByLabel("Email", { exact: true }).fill(layla.email);
    await clickEmailLink(p);
    await p.goto(await mailedLink(layla.email, /sign-in link/i, since));
    await p.waitForURL(/\/(today|signed-in)/);
    await expect(expectPasswordRemovedNotice(p)).rejects.toThrow();
    await ctx.close();
  });

  test("@G1 block: the blocked login's open session gets 401 on its next request and cannot sign in", async () => {
    await expect(priyaPage.request.get("/api/v1/me").then((r) => r.status())).resolves.toBe(200);
    await adminPage.goto("/access");
    await adminPage.getByRole("button", { name: `More actions for ${priya.name}` }).click();
    await adminPage.getByRole("menuitem", { name: "Block…" }).click();
    const dialog = adminPage.getByRole("dialog", { name: `${priya.name}'s login` });
    await dialog.getByLabel("Reason (only admins see this)").fill("Left the job");
    await dialog.getByRole("button", { name: `Block ${priya.name}` }).click();
    await expect(
      adminPage.getByRole("status").filter({ hasText: `${priya.name} is blocked` }),
    ).toContainText("Signed out of 1 device");
    await expectUnauthorized(priyaPage);
    await priyaPage.goto("/account");
    await priyaPage.waitForURL("**/sign-in?next=%2Faccount");
    await signInWithPassword(priyaPage, priya.email, priya.password);
    await expect(alert(priyaPage)).toContainText("blocked");
    await expect(adminPage.getByTestId(`login-${priya.email}`)).toContainText("Blocked");
    const [cs] = await sql<{ id: string }>(
      `SELECT id FROM change_set WHERE summary = 'Block login' ORDER BY applied_at DESC LIMIT 1`,
    );
    blockChangeSet = cs?.id ?? "";
    expect(blockChangeSet).not.toBe("");
  });

  test("@G1 negative control: the 401 check fails on a session that was not blocked", async () => {
    await expect(expectUnauthorized(adminPage)).rejects.toThrow("expected 401");
  });

  test("@G1 change-log undo: the block is undone from the log; an entry changed again later cannot be undone and says why", async () => {
    await adminPage.goto("/changelog");
    const entry = adminPage.getByTestId(`log-${blockChangeSet}`);
    await expect(entry).toContainText("Block login");
    await expect(entry).toContainText("You");
    await entry.getByRole("button", { name: "Undo: Block login" }).click();
    await expect(
      adminPage.getByRole("status").filter({ hasText: "Undone: Block login" }),
    ).toBeVisible();
    await expectUndoRestored(blockChangeSet);
    await expect(adminPage.getByTestId(`log-${blockChangeSet}`)).toContainText("Undone");
    await signInWithPassword(priyaPage, priya.email, priya.password);
    await priyaPage.waitForURL("**/kitchen");

    // Two changes to the household name: the first can no longer be undone.
    for (const name of ["Khalifa home", "Khalifa City home"]) {
      await adminPage.goto("/settings/household");
      await adminPage.getByLabel("Name", { exact: true }).fill(name);
      await adminPage.getByRole("button", { name: "Save changes" }).click();
      await expect(adminPage.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    }
    const rows = await sql<{ id: string }>(
      `SELECT id FROM change_set WHERE summary = 'Household settings' ORDER BY applied_at`,
    );
    expect(rows).toHaveLength(2);
    await adminPage.goto("/changelog");
    const first = adminPage.getByTestId(`log-${rows[0]?.id ?? ""}`);
    await expect(first.getByRole("button", { name: "Undo: Household settings" })).toBeDisabled();
    await expect(first).toContainText("A later change touched the same settings");
    await adminPage.getByRole("button", { name: "People & access", pressed: false }).click();
    await expect(adminPage.getByTestId(`log-${blockChangeSet}`)).toBeVisible();
    await expect(adminPage.getByTestId(`log-${rows[0]?.id ?? ""}`)).toHaveCount(0);
  });

  test("@G1 negative control: the undo check fails for a change set that was not undone", async () => {
    const [cs] = await sql<{ id: string }>(
      `SELECT id FROM change_set WHERE summary = 'Household settings' ORDER BY applied_at DESC LIMIT 1`,
    );
    await expect(expectUndoRestored(cs?.id ?? "")).rejects.toThrow("is not undone");
  });

  test("@G1 remove: removing a login with its member archived ends its session and takes it off the list", async () => {
    const lp = laylaCtx.pages().at(-1);
    if (lp === undefined) throw new Error("Layla's page is gone");
    await expect(lp.request.get("/api/v1/me").then((r) => r.status())).resolves.toBe(200);
    await adminPage.goto("/access");
    await adminPage.getByRole("button", { name: "More actions for Layla" }).click();
    await adminPage.getByRole("menuitem", { name: "Remove from household…" }).click();
    const dialog = adminPage.getByRole("dialog", { name: "Layla's login" });
    await expect(dialog.getByRole("radio", { name: "Remove login" })).toBeChecked();
    await dialog.getByRole("checkbox", { name: /Also stop planning meals for Layla/ }).check();
    await dialog.getByRole("button", { name: "Remove Layla" }).click();
    await expect(
      adminPage.getByRole("status").filter({ hasText: "Layla is removed" }),
    ).toBeVisible();
    await expect(adminPage.getByTestId(`login-${layla.email}`)).toHaveCount(0);
    await expectUnauthorized(lp);
    const [m] = await sql<{ archived_at: Date | null }>(
      `SELECT archived_at FROM member WHERE display_name = 'Layla'`,
    );
    expect(m?.archived_at).not.toBeNull();
    await expect(adminPage.getByText("Give Layla a login")).toHaveCount(0);
  });

  test("@G1 last-admin protection: the only admin cannot be demoted, blocked or removed, in the UI or by request", async () => {
    await adminPage.goto("/access");
    const row = adminPage.getByTestId(`login-${admin.email}`);
    await expect(row).toContainText("Admin");
    await expect(row.getByRole("combobox")).toHaveCount(0);
    await expect(row.getByRole("button", { name: /More actions/ })).toHaveCount(0);
    await expect(
      adminPage.getByText(/^1 admin\. The last admin can.t be removed, blocked or demoted\.$/),
    ).toBeVisible();
    const me = (await (await adminPage.request.get("/api/v1/me")).json()) as {
      user: { id: string };
    };
    const id = me.user.id;
    const statuses = await Promise.all([
      adminPage.request.post(`/api/v1/access/${id}/role`, { data: { role: "member" } }),
      adminPage.request.post(`/api/v1/access/${id}/block`, { data: {} }),
      adminPage.request.post(`/api/v1/access/${id}/remove`, { data: {} }),
    ]).then((rs) => rs.map((r) => r.status()));
    expect(statuses).toEqual([409, 409, 409]);
    await expect(adminPage.request.get("/api/v1/me").then((r) => r.status())).resolves.toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// @G2
// ---------------------------------------------------------------------------------------------

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  // Responsiveness (UX-1: 390 px is first-class) is checked on the same screens: a page wider
  // than the viewport makes content unreachable without horizontal scrolling.
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

/** A page flow that calls `scan(state)` at each state worth checking. */
type Flow = {
  name: string;
  run: (page: Page, scan: (state: string) => Promise<void>) => Promise<void>;
};

test.describe("@G2 axe-core on every screen of the leaf", () => {
  // In order (the set-up runs first), but one screen's failure does not skip the others.
  test.describe.configure({ mode: "default" });
  // One run id for every worker (Playwright loads this file again after a restart).
  const run =
    (readShared().g2Run as string | undefined) ??
    (() => {
      const id = `a11y${Date.now().toString(36)}`;
      writeShared("g2Run", id);
      return id;
    })();
  const admin = {
    name: "Sara",
    email: `sara-${run}@example.com`,
    password: "averylongpassword",
    household: "Al Reem apartment",
  };
  const operator = { email: `op-${run}@example.com`, password: "operator-password-1" };
  const twoStep = { email: `two-${run}@example.com`, password: "twostep-password-1", secret: "" };
  // The set-up's results, kept in the shared file so a restarted worker still has them.
  const shared = () =>
    readShared() as { g2State?: string; g2InviteCode?: string; g2OpState?: string };
  let inviteCode = "";
  let state: string | undefined;
  test.beforeEach(() => {
    inviteCode = inviteCode === "" ? (shared().g2InviteCode ?? "") : inviteCode;
    state ??= shared().g2State;
  });

  test("@G2 set-up: a household with a member invite, an operator and a two-step account", async ({
    browser,
  }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await createHousehold(page, admin);
    // Zayd joins as a member (a second login for the actions menu and block dialog); a kitchen
    // invite stays open for the accept screen.
    const zayd = await inviteThroughDialog(page, {
      seat: "A new person",
      newName: "Zayd",
      role: "Member",
    });
    inviteCode = (
      await inviteThroughDialog(page, { seat: /Doesn.t eat here \(staff\)/, role: "Kitchen" })
    ).code.replaceAll("-", "");
    await page.request.post("/api/auth/sign-out", { data: {} });
    const joined = await page.request.post("/api/v1/invites/accept", {
      data: {
        code: zayd.code.replaceAll("-", ""),
        signup: { email: `zayd-${run}@example.com`, password: "zayd-password-1", name: "Zayd" },
      },
    });
    expect(joined.status()).toBe(200);
    // Diagnostics and the console's AI and job views show rows (the worker is not running here):
    // one AI call that hit max_tokens with validation errors, and one failed plan job.
    await sql(
      `INSERT INTO ai_generation (id, household_id, purpose, model, request_summary, response_raw,
         input_tokens, output_tokens, cache_read_tokens, stop_reason, validation_errors, created_at)
       SELECT gen_random_uuid(), id, 'recipe', 'claude-test-model', '{}', '{}', 12000, 3200, 9000,
         'max_tokens', '["bad slug"]', now() FROM household WHERE name = $1`,
      [admin.household],
    );
    await sql(
      `INSERT INTO job (id, household_id, kind, payload, status, error, created_at, started_at, finished_at)
       SELECT gen_random_uuid(), id, 'plan.generate', '{}', 'failed',
         '{"message":"no feasible plate for Sara at lunch"}', now(), now(), now()
         FROM household WHERE name = $1`,
      [admin.household],
    );
    // An operator: a login from another household, made a platform operator.
    await page.request.post("/api/auth/sign-out", { data: {} });
    const op = await page.request.post("/api/v1/signup", {
      data: {
        email: operator.email,
        password: operator.password,
        name: "Operator",
        householdName: "Operator's own",
      },
    });
    expect(op.status()).toBe(201);
    await sql(
      `INSERT INTO platform_operator (user_id, created_at) SELECT id, now() FROM "user" WHERE email = $1`,
      [operator.email],
    );
    // Keep the operator's session for the console scans (no sign-in per scan, no rate limit).
    writeShared("g2OpState", JSON.stringify(await ctx.storageState()));
    await ctx.clearCookies();
    // A two-step account, for the TOTP step of the sign-in screen.
    expect(
      (
        await page.request.post("/api/v1/signup", {
          data: {
            email: twoStep.email,
            password: twoStep.password,
            name: "Adam",
            householdName: "Two-step home",
          },
        })
      ).status(),
    ).toBe(201);
    const enabled = (await (
      await page.request.post("/api/v1/account/totp/enable", {
        data: { password: twoStep.password },
      })
    ).json()) as { totpUri: string };
    twoStep.secret = new URL(enabled.totpUri).searchParams.get("secret") ?? "";
    expect(
      (
        await page.request.post("/api/v1/account/totp/verify", {
          data: { code: totp(twoStep.secret) },
        })
      ).status(),
    ).toBe(200);
    await page.request.post("/api/auth/sign-out", { data: {} });
    await signInWithPassword(page, admin.email, admin.password);
    await page.waitForURL("**/today");
    state = JSON.stringify(await ctx.storageState());
    writeShared("g2State", state);
    writeShared("g2InviteCode", inviteCode);
    await ctx.close();
  });

  // Each flow opens a page once and scans every state it passes through, in both colour schemes.
  const signedOut: Flow[] = [
    {
      name: "sign-in",
      run: async (p, scan) => {
        await p.goto("/sign-in");
        await scan("sign-in");
        await p.getByRole("button", { name: "Forgot password?" }).click();
        await expect(p.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
        await scan("sign-in, forgot password");
        await p.getByRole("button", { name: "Back to sign in" }).click();
        await p.getByLabel("Email", { exact: true }).fill("nobody@example.com");
        await p.getByLabel("Password", { exact: true }).fill("wrong-password");
        await clickSignIn(p);
        await expect(alert(p)).toBeVisible();
        await scan("sign-in with an error");
        await p.getByLabel("Email", { exact: true }).fill(twoStep.email);
        await p.getByLabel("Password", { exact: true }).fill(twoStep.password);
        await clickSignIn(p);
        await expect(p.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible();
        await scan("sign-in, two-step step");
      },
    },
    {
      name: "create household",
      run: async (p, scan) => {
        await p.goto("/create-household");
        await scan("create household");
      },
    },
    {
      name: "invite accept",
      run: async (p, scan) => {
        await p.goto(`/invite/${inviteCode}`);
        await expect(p.getByRole("button", { name: "Join the household" })).toBeVisible();
        await scan("invite accept");
        await p.goto("/invite/ABCDEFGHJK");
        await expect(alert(p)).toBeVisible();
        await scan("invite accept, invalid code");
      },
    },
    {
      name: "reset and signed-in notice",
      run: async (p, scan) => {
        await p.goto("/reset-password?token=example-token");
        await scan("reset password");
        await p.goto("/signed-in?passwordRemoved=1");
        await scan("signed in, password removed");
      },
    },
  ];

  const admins: Flow[] = [
    {
      name: "account",
      run: async (p, scan) => {
        await p.goto("/account");
        await expect(p.getByRole("heading", { name: "My account" })).toBeVisible();
        await expect(p.getByText("Two-step sign-in")).toBeVisible();
        await scan("account");
        await p.getByRole("button", { name: "Turn on" }).click();
        const d = p.getByRole("dialog", { name: "Turn on two-step sign-in" });
        await d.getByLabel("Your password").fill(admin.password);
        await d.getByRole("button", { name: "Continue" }).click();
        await expect(d.getByRole("img", { name: /QR code/ })).toBeVisible();
        await scan("account, two-step set-up");
        await p.goto("/account/diagnostics");
        await expect(p.getByRole("table", { name: "The last 50 AI calls" })).toContainText(
          "max_tokens",
        );
        await expect(p.getByRole("table", { name: "Failed jobs" })).toContainText(
          "no feasible plate",
        );
        await scan("diagnostics");
      },
    },
    {
      name: "people and access",
      run: async (p, scan) => {
        await p.goto("/access");
        await expect(p.getByText("Family members without a login")).toBeVisible();
        await scan("people and access");
        await p.getByRole("button", { name: "More actions for Zayd" }).click();
        await expect(p.getByRole("menu")).toBeVisible();
        await scan("actions menu");
        await p.getByRole("menuitem", { name: "Block…" }).click();
        await expect(p.getByRole("dialog", { name: "Zayd's login" })).toBeVisible();
        await scan("block dialog");
        await p.keyboard.press("Escape");
        await p.getByRole("button", { name: "Invite someone" }).click();
        const d = p.getByRole("dialog", { name: "Invite someone" });
        await expect(d).toBeVisible();
        await scan("invite dialog");
        await d.getByRole("button", { name: /Doesn.t eat here \(staff\)/ }).click();
        await d.getByRole("button", { name: "Create invite link" }).click();
        await expect(p.getByRole("dialog", { name: "Invite ready" })).toBeVisible();
        await scan("invite dialog, link and QR");
      },
    },
    {
      name: "settings and change log",
      run: async (p, scan) => {
        await p.goto("/settings/household");
        await expect(p.getByRole("heading", { name: "Who sees what" })).toBeVisible();
        await scan("household settings");
        await p.goto("/changelog");
        await expect(p.getByRole("heading", { name: "Change log" })).toBeVisible();
        await scan("change log");
      },
    },
  ];

  const operators: Flow[] = [
    {
      name: "platform console",
      run: async (p, scan) => {
        await p.goto("/platform");
        for (const tab of ["Households", "Users", "AI usage", "System"]) {
          await p.getByRole("tab", { name: tab }).click();
          await expect(p.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
          await expect(p.getByRole("tabpanel").getByRole("heading").first()).toBeVisible();
          await scan(`platform console, ${tab}`);
        }
      },
    },
  ];

  /** Scans the open page in light, then dark (the tokens follow prefers-color-scheme live). */
  async function scanBothSchemes(page: Page, state: string, failures: string[]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // Finite colour transitions (buttons' `transition-colors`) would be caught half-way.
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

  const base = () => `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "3142"}`;
  const storage = (json: string | undefined) =>
    JSON.parse(json ?? "{}") as { cookies: []; origins: [] };

  async function runFlows(
    browser: Browser,
    viewport: { width: number; height: number },
    flows: readonly Flow[],
    session: string | undefined,
  ) {
    const failures: string[] = [];
    for (const flow of flows) {
      const ctx = await browser.newContext({
        baseURL: base(),
        viewport,
        ...(session === undefined ? {} : { storageState: storage(session) }),
      });
      const page = await ctx.newPage();
      await flow.run(page, (state) => scanBothSchemes(page, state, failures));
      await ctx.close();
    }
    expect(failures).toEqual([]);
  }

  for (const viewport of [PHONE, DESKTOP]) {
    const label = `${String(viewport.width)} px, light and dark`;
    test(`@G2 signed-out screens at ${label}`, async ({ browser }) => {
      await runFlows(browser, viewport, signedOut, undefined);
    });
    test(`@G2 admin screens at ${label}`, async ({ browser }) => {
      await runFlows(browser, viewport, admins, state);
    });
    test(`@G2 platform console at ${label}`, async ({ browser }) => {
      await runFlows(browser, viewport, operators, shared().g2OpState);
    });
  }

  test("@G2 negative control: the scan reports an unnamed button, low-contrast text and a page wider than the screen", async ({
    browser,
  }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto("/sign-in");
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
