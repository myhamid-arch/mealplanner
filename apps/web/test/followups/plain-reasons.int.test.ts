// Leaf 1.4.10 G1 (W-12, PLN-9 reasons, UX-7) through the real stack: a plan generated from the
// database loader has reasons that name ingredients by catalogue display name, and after the
// kitchen flags an ingredient unavailable and the real `plates.substitute` job runs, no reason on
// the re-solved days names the replaced ingredient (except meals the run could not re-solve, which
// still serve it). The ingredient chosen is one that a served dish is named after, when there is
// one, since dish names are where it used to leak ("… (with <substitute>)").
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { generatePlan } from "@mealplanner/db/services/plans";
import { HANDLERS } from "../../../worker/src/jobs/handlers";
import { runJob } from "../../../worker/src/runner";
import { createWorkerRuntime, type WorkerRuntime } from "../../../worker/src/runtime";
import { callJson, startTestApp, type TestApp } from "../api/support/app";
import { createTestDatabase, type TestDatabase } from "../api/support/db";
import {
  acceptWithSignup,
  addMembers,
  invite,
  ok,
  signupAdmin,
  type Login,
} from "../api/support/world";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DATES = ["2026-12-14", "2026-12-15", "2026-12-16"];

type Meal = {
  id: string;
  dishName: string;
  slotLabel: string;
  scoreBreakdown: { reasons?: string[] } | null;
};

let db: TestDatabase;
let app: TestApp;
let rt: WorkerRuntime;
let admin: Login & { householdId: string };
let kitchen: Login;
let target: { id: string; name: string; slug: string; mealId: string };
let catalogue: { names: Set<string>; slugs: Set<string> };

async function meals(): Promise<Meal[]> {
  const days = ok<{ days: Array<{ meals: Meal[] }> }>(
    await callJson(c.plansList, { query: { from: DATES[0] ?? "", to: DATES.at(-1) ?? "" } }, admin),
    "plans",
  ).days;
  return days.flatMap((d) => d.meals);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names joined with ", " (names may contain ", "): true when every piece is a catalogue name. */
function tiled(list: string): boolean {
  const parts = list.split(", ");
  const ok2: boolean[] = [true];
  for (let end = 1; end <= parts.length; end++) {
    ok2[end] = false;
    for (let start = 0; start < end && !ok2[end]; start++)
      ok2[end] = ok2[start] === true && catalogue.names.has(parts.slice(start, end).join(", "));
  }
  return ok2[parts.length] === true;
}

function problemsOf(reason: string): string[] {
  const out: string[] = [];
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(reason))
    out.push("uuid");
  if (/\b[a-z0-9]+_[a-z0-9_]+\b/.test(reason)) out.push("snake_case key");
  for (const t of reason.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) ?? [])
    if (catalogue.slugs.has(t)) out.push(`slug ${t}`);
  const list =
    /^Reuses (.+) from other meals (?:this week|in these \d+ days)$/.exec(reason) ??
    /^New (?:this week|in these \d+ days): (.+)$/.exec(reason);
  if (list !== null && !tiled(list[1] ?? "")) out.push("not display names");
  return out;
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  rt = await createWorkerRuntime({
    databaseUrl: db.url,
    dataDir: join(ROOT, "data"),
    aiRecipeDailyLimit: 0,
    concurrency: 1,
  });
  admin = await signupAdmin("Plain reasons");
  await addMembers(admin);
  kitchen = await acceptWithSignup(await invite(admin, "kitchen", null), "Priya");
  const sync = HANDLERS["kg.sync"];
  if (sync === undefined) throw new Error("no kg.sync handler");
  await runJob(rt, await rt.enqueue("kg.sync", null, { request: { kind: "catalogue" } }), sync);
  await generatePlan(
    app.rt.db,
    { householdId: admin.householdId, userId: admin.userId, role: "admin" },
    { dates: DATES, seed: 3, by: { actor: "user", source: "ui" } },
  );
  const rows = await app.rt.db.execute<{ name: string; slug: string }>(
    sql`SELECT name, slug FROM ingredient WHERE created_by_household_id IS NULL`,
  );
  catalogue = {
    names: new Set(rows.rows.map((r) => r.name)),
    slugs: new Set(rows.rows.map((r) => r.slug)),
  };
  // Served ingredients of the first date that have a substitute; prefer one a dish is named after.
  const used = await app.rt.db.execute<{
    id: string;
    name: string;
    slug: string;
    meal: string;
    dishes: string;
    n: number;
  }>(
    sql`SELECT i.id, i.name, i.slug, min(pm.id::text) AS meal, string_agg(DISTINCT d.name, '|') AS dishes,
               count(*)::int AS n
        FROM plan_meal pm JOIN plan_day pd ON pd.id = pm.plan_day_id JOIN dish d ON d.id = pm.dish_id
        JOIN plate p ON p.plan_meal_id = pm.id JOIN plate_item pi ON pi.plate_id = p.id
        JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id JOIN ingredient i ON i.id = vi.ingredient_id
        WHERE pd.household_id = ${admin.householdId} AND pd.date = ${DATES[0] ?? ""}
          AND EXISTS (SELECT 1 FROM kg_edge e JOIN kg_node s ON s.id = e.src_id
                      WHERE e.type = 'SUBSTITUTES_FOR' AND s.key = i.id::text)
        GROUP BY i.id, i.name, i.slug ORDER BY count(*) DESC, i.name`,
  );
  const named = used.rows.find((r) => {
    const head = (r.name.split(",")[0] ?? r.name).toLowerCase();
    return r.dishes
      .toLowerCase()
      .split("|")
      .some((d) => new RegExp(`\\b${escape(head)}\\b`).test(d));
  });
  const row = named ?? used.rows[0];
  if (row === undefined) throw new Error("no served ingredient has a substitute");
  target = { id: row.id, name: row.name, slug: row.slug, mealId: row.meal };
  process.stdout.write(
    `W-12 substitution: ${row.name}${named === undefined ? "" : " (a served dish is named after it)"}\n`,
  );
}, 600_000);

afterAll(async () => {
  await rt.close();
  await app.close();
  await db.drop();
}, 60_000);

describe("W-12 plain reasons through the database loader", () => {
  it("the generated plan's reasons use display names: no slug, snake_case key or id", async () => {
    const all = (await meals()).flatMap((m) =>
      (m.scoreBreakdown?.reasons ?? []).map((r) => ({ meal: m.dishName, r })),
    );
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(({ r }) => r.startsWith("Reuses ") || r.startsWith("New "))).toBe(true);
    expect(
      all.flatMap(({ meal, r }) => problemsOf(r).map((p) => `${meal}: ${p} in "${r}"`)),
    ).toEqual([]);
  });

  it("negative control: a reason with today's slug labels fails the same check", () => {
    const slug = [...catalogue.slugs].find((s) => s.includes("-")) ?? "";
    expect(problemsOf(`Reuses ${slug} from other meals this week`).length).toBeGreaterThan(0);
  });

  it("after the kitchen flags it unavailable and plates.substitute runs, no reason names it", async () => {
    const r = await callJson(
      c.cookSheetsFlag,
      {
        params: { date: DATES[0] ?? "" },
        body: { kind: "unavailable", ingredientId: target.id, planMealId: target.mealId },
      },
      kitchen,
    );
    expect(r.status, r.text).toBe(202);
    const handler = HANDLERS["plates.substitute"];
    if (handler === undefined) throw new Error("no plates.substitute handler");
    await runJob(rt, (r.json as { jobId: string }).jobId, handler);
    const job = await app.rt.db.execute<{ status: string; result: unknown }>(
      sql`SELECT status FROM job WHERE id = ${(r.json as { jobId: string }).jobId}`,
    );
    expect(job.rows[0]?.status).toBe("succeeded");
    const unresolved = await app.rt.db.execute<{ id: string }>(
      sql`SELECT DISTINCT pm.id::text AS id FROM plan_meal pm JOIN plan_day pd ON pd.id = pm.plan_day_id
          JOIN plate p ON p.plan_meal_id = pm.id JOIN plate_item pi ON pi.plate_id = p.id
          JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id
          WHERE pd.household_id = ${admin.householdId} AND vi.ingredient_id = ${target.id}`,
    );
    const still = new Set(unresolved.rows.map((x) => x.id));
    // Meals whose own ingredients share the name's head (another salmon product, say) may say it.
    const headWord = (target.name.split(",")[0] ?? target.name).trim();
    const sharing = await app.rt.db.execute<{ id: string }>(
      sql`SELECT DISTINCT pm.id::text AS id FROM plan_meal pm JOIN plan_day pd ON pd.id = pm.plan_day_id
          JOIN plate p ON p.plan_meal_id = pm.id JOIN plate_item pi ON pi.plate_id = p.id
          JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id
          JOIN ingredient i ON i.id = vi.ingredient_id
          WHERE pd.household_id = ${admin.householdId} AND i.name ILIKE ${`%${headWord}%`}`,
    );
    for (const x of sharing.rows) still.add(x.id);
    const after = await meals();
    const copies = after.filter((m) => / \(with .+\)$/.test(m.dishName));
    expect(copies.length).toBeGreaterThan(0);
    // The name as dishes and steps say it: its head ("Salmon" for "Salmon, Atlantic, farmed").
    const head = `\\b${escape(headWord)}\\b`;
    const naming = after
      .filter((m) => !still.has(m.id))
      .flatMap((m) =>
        (m.scoreBreakdown?.reasons ?? []).map((reason) => ({ dish: m.dishName, reason })),
      )
      .filter(({ reason }) => new RegExp(`${head}|\\b${escape(target.slug)}\\b`, "i").test(reason));
    expect(naming).toEqual([]);
    const all = after.flatMap((m) => m.scoreBreakdown?.reasons ?? []);
    expect(all.flatMap((x) => problemsOf(x))).toEqual([]);
  }, 300_000);
});
