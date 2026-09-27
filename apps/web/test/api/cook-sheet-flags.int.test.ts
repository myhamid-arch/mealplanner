// BLD-8 R-52 (leaf 1.4.4 SPEC-Q-1, R2-UX-1): `GET /cook-sheets/{date}/flags` lists the kitchen
// flags of a date with their `plates.substitute` job and its result, for admins; kitchen users see
// their own flags; members are refused; nothing crosses households. The substitution runs through
// the real worker handler on a real generated plan.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { generatePlan } from "@mealplanner/db/services/plans";
import { createWorkerRuntime, type WorkerRuntime } from "../../../worker/src/runtime";
import { HANDLERS } from "../../../worker/src/jobs/handlers";
import { runJob } from "../../../worker/src/runner";
import { callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { acceptWithSignup, addMembers, invite, ok, signupAdmin, type Login } from "./support/world";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DATE = "2026-12-14";
const NEXT = "2026-12-15";

type Flag = {
  reviewId: string;
  kind: string;
  ingredientId: string | null;
  ingredientName: string | null;
  variantId: string | null;
  planMealId: string | null;
  note: string | null;
  authorName: string;
  job: { id: string; status: string } | null;
  result: {
    substituteId: string | null;
    substituteName: string | null;
    changeSetId: string | null;
    meals: Array<{
      planMealId: string;
      date: string;
      slotLabel: string;
      fromDishName: string;
      toDishName: string;
    }>;
    unresolved: string[];
  } | null;
};

let db: TestDatabase;
let app: TestApp;
let rt: WorkerRuntime;
let a: Login & { householdId: string };
let b: Login & { householdId: string };
let member: Login;
let kitchen: Login;
let target: { id: string; name: string };
let variantId: string;
let flaggedMealId: string;
let jobId: string;
let unavailableId: string;

const flags = async (caller: Caller, date = DATE) =>
  ok<{ flags: Flag[] }>(await callJson(c.cookSheetsFlags, { params: { date } }, caller), "flags")
    .flags;

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  rt = await createWorkerRuntime({
    databaseUrl: db.url,
    dataDir: join(ROOT, "data"),
    aiRecipeDailyLimit: 0,
    concurrency: 1,
  });
  a = await signupAdmin("Flags A");
  b = await signupAdmin("Flags B");
  const { adultId } = await addMembers(a);
  member = await acceptWithSignup(await invite(a, "member", adultId), "Sara");
  kitchen = await acceptWithSignup(await invite(a, "kitchen", null), "Priya");
  // The catalogue graph (SUBSTITUTES_FOR edges), as the worker builds it at start.
  const sync = HANDLERS["kg.sync"];
  if (sync === undefined) throw new Error("no kg.sync handler");
  const graphJob = await rt.enqueue("kg.sync", null, { request: { kind: "catalogue" } });
  await runJob(rt, graphJob, sync);
  await generatePlan(
    app.rt.db,
    { householdId: a.householdId, userId: a.userId, role: "admin" },
    { dates: [DATE, NEXT], seed: 5, by: { actor: "user", source: "ui" } },
  );
  // The ingredient on the most plates of the date that has a catalogue substitute.
  const used = await app.rt.db.execute<{ id: string; name: string; pair: string }>(
    sql`SELECT i.id, i.name, min(pm.id::text || '|' || vi.variant_id::text) AS pair
        FROM plan_meal pm JOIN plan_day pd ON pd.id = pm.plan_day_id
        JOIN plate p ON p.plan_meal_id = pm.id JOIN plate_item pi ON pi.plate_id = p.id
        JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id JOIN ingredient i ON i.id = vi.ingredient_id
        WHERE pd.household_id = ${a.householdId} AND pd.date = ${DATE}
          AND EXISTS (SELECT 1 FROM kg_edge e JOIN kg_node s ON s.id = e.src_id
                      WHERE e.type = 'SUBSTITUTES_FOR' AND s.key = i.id::text)
        GROUP BY i.id, i.name ORDER BY count(*) DESC, i.name LIMIT 1`,
  );
  const row = used.rows[0];
  if (row === undefined) throw new Error("no planned ingredient has a substitute");
  target = { id: row.id, name: row.name };
  // A meal of the date and a variant served at it that uses the ingredient.
  [flaggedMealId = "", variantId = ""] = row.pair.split("|");
}, 600_000);

afterAll(async () => {
  await rt.close();
  await app.close();
  await db.drop();
}, 60_000);

describe("GET /cook-sheets/{date}/flags (R-52, R2-UX-1)", () => {
  it("a kitchen flag is listed for admins at once, with its queued job and no result yet", async () => {
    const r = await callJson(
      c.cookSheetsFlag,
      {
        params: { date: DATE },
        body: {
          kind: "unavailable",
          ingredientId: target.id,
          planMealId: flaggedMealId,
          note: "none at the market",
        },
      },
      kitchen,
    );
    expect(r.status, r.text).toBe(202);
    const posted = r.json as { reviewId: string; jobId: string };
    jobId = posted.jobId;
    unavailableId = posted.reviewId;
    const unclear = await callJson(
      c.cookSheetsFlag,
      { params: { date: DATE }, body: { kind: "unclear", variantId, planMealId: flaggedMealId } },
      a,
    );
    expect(unclear.status, unclear.text).toBe(202);

    const listed = await flags(a);
    expect(listed.map((f) => f.kind).sort()).toEqual(["unavailable", "unclear"]);
    const f = listed.find((x) => x.reviewId === unavailableId);
    expect(f).toMatchObject({
      kind: "unavailable",
      ingredientId: target.id,
      ingredientName: target.name,
      planMealId: flaggedMealId,
      note: "none at the market",
      authorName: "Priya",
      job: { id: jobId, status: "queued" },
      result: null,
    });
    expect(listed.find((x) => x.kind === "unclear")).toMatchObject({
      variantId,
      ingredientId: null,
      job: null,
      result: null,
    });
  });

  it("after the job runs, the result names the substitute and every re-solved meal", async () => {
    const handler = HANDLERS["plates.substitute"];
    if (handler === undefined) throw new Error("no plates.substitute handler");
    await runJob(rt, jobId, handler);
    const f = (await flags(a)).find((x) => x.reviewId === unavailableId);
    expect(f?.job?.status).toBe("succeeded");
    const result = f?.result;
    expect(result?.substituteId).toBeTruthy();
    expect(result?.substituteName).toBeTruthy();
    expect(result?.changeSetId).toBeTruthy();
    expect(result?.meals.length).toBeGreaterThan(0);
    // Independently of the listing: every listed meal now serves the named copy, and the copy
    // is the original with the substitute ("X (with Y)").
    const days = ok<{ days: Array<{ meals: Array<{ id: string; dishName: string }> }> }>(
      await callJson(c.plansList, { query: { from: DATE, to: NEXT } }, a),
      "plans",
    ).days;
    const dishOf = new Map(days.flatMap((d) => d.meals).map((m) => [m.id, m.dishName]));
    for (const m of result?.meals ?? []) {
      expect(dishOf.get(m.planMealId)).toBe(m.toDishName);
      expect(m.toDishName).toBe(`${m.fromDishName} (with ${result?.substituteName ?? ""})`);
      expect([DATE, NEXT]).toContain(m.date);
    }
    const still = await app.rt.db.execute<{ id: string }>(
      sql`SELECT DISTINCT pm.id::text AS id FROM plan_meal pm JOIN plan_day pd ON pd.id = pm.plan_day_id
          JOIN plate p ON p.plan_meal_id = pm.id JOIN plate_item pi ON pi.plate_id = p.id
          JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id
          WHERE pd.household_id = ${a.householdId} AND pd.date >= ${DATE}
            AND vi.ingredient_id = ${target.id}`,
    );
    // No meal still serves the ingredient, except those the run reported as unresolved.
    expect(still.rows.map((x) => x.id).filter((id) => !result?.unresolved.includes(id))).toEqual(
      [],
    );
    const log = ok<{ entries: Array<{ id: string; actor: string }> }>(
      await callJson(c.changeSetsList, { query: { limit: 20 } }, a),
      "log",
    ).entries;
    expect(log.find((e) => e.id === result?.changeSetId)?.actor).toBe("system");
  });

  // Leaf 1.4.8 G2 (W-6, R-58/R-60): the substituted copy's cook sheet names the substitute. The
  // copy is compared with its original variant by variant (the copy keeps the original's order):
  // wherever the original named the flagged ingredient (display name or alias, whole word), the
  // copy names the substitute; a variant that used it without naming it starts with the note.
  // Longer names of other ingredients of the variant ("red onion" when onion is flagged) and the
  // substitute's own name are not mentions.
  it("the substituted cook sheet names the substitute in steps, labels and component names", async () => {
    const f = (await flags(a)).find((x) => x.reviewId === unavailableId);
    const result = f?.result;
    const sub = result?.substituteName ?? "";
    expect(sub).not.toBe("");
    const [row] = (
      await app.rt.db.execute<{ name: string; aliases: string[] }>(
        sql`SELECT name, aliases FROM ingredient WHERE id = ${target.id}`,
      )
    ).rows;
    const names = [row?.name ?? target.name, ...(row?.aliases ?? [])];
    const escape = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentions = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${names.map(escape).join("|")})(?![\\p{L}\\p{N}])`,
      "iu",
    );
    const nameOf = new Map(
      (
        await app.rt.db.execute<{ id: string; name: string }>(
          sql`SELECT id::text, name FROM ingredient`,
        )
      ).rows.map((r) => [r.id, r.name]),
    );
    const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
    const note = `Use ${lower(sub)} wherever ${lower(target.name)} is mentioned.`;
    type Tree = {
      components: Array<{
        name: string;
        variants: Array<{
          label: string;
          steps: string[];
          ingredients: Array<{ ingredientId: string }>;
        }>;
      }>;
    };
    const tree = async (id: string) =>
      ok<Tree>(await callJson(c.dishesGet, { params: { id } }, a), "dish");
    let checked = 0;
    for (const m of result?.meals ?? []) {
      const [pair] = (
        await app.rt.db.execute<{ copy: string; original: string }>(
          sql`SELECT pm.dish_id::text AS copy,
                (SELECT d.id::text FROM dish d WHERE d.name = ${m.fromDishName}
                   AND (d.household_id IS NULL OR d.household_id = ${a.householdId})
                 ORDER BY d.household_id NULLS FIRST LIMIT 1) AS original
              FROM plan_meal pm WHERE pm.id = ${m.planMealId}`,
        )
      ).rows;
      if (pair === undefined) throw new Error(`meal ${m.planMealId} not found`);
      const [copy, original] = [await tree(pair.copy), await tree(pair.original)];
      original.components.forEach((oc, ci) => {
        const cc = copy.components[ci];
        oc.variants.forEach((ov, vi) => {
          const cv = cc?.variants[vi];
          if (!ov.ingredients.some((l) => l.ingredientId === target.id)) return;
          checked += 1;
          // Other ingredients' longer names and the substitute's name are masked before matching.
          const keep = [
            sub,
            ...ov.ingredients
              .filter((l) => l.ingredientId !== target.id)
              .map((l) => nameOf.get(l.ingredientId) ?? ""),
          ]
            .filter((k) => k !== "" && mentions.test(k))
            .sort((x, y) => y.length - x.length);
          const bare = (x: string) =>
            keep.reduce((t, k) => t.replace(new RegExp(escape(k), "giu"), "§"), x);
          expect(bare(cv?.label ?? ""), `label of ${m.toDishName}`).not.toMatch(mentions);
          expect(bare(cc?.name ?? ""), `component of ${m.toDishName}`).not.toMatch(mentions);
          const steps = (cv?.steps ?? []).filter((x) => x !== note);
          for (const step of steps) expect(bare(step), m.toDishName).not.toMatch(mentions);
          const named = ov.steps.some((x) => mentions.test(bare(x)));
          if (named)
            expect(
              (cv?.steps ?? []).some((x) => x.toLowerCase().includes(sub.toLowerCase())),
              `${m.toDishName}: a step names ${sub}`,
            ).toBe(true);
          else expect(cv?.steps[0], `${m.toDishName}: the leading note`).toBe(note);
        });
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the kitchen sees only its own flags; members are refused; another date or household has none", async () => {
    const own = await flags(kitchen);
    expect(own.map((f) => f.reviewId)).toEqual([unavailableId]);
    expect((await callJson(c.cookSheetsFlags, { params: { date: DATE } }, member)).status).toBe(
      403,
    );
    expect(await flags(a, "2026-12-01")).toEqual([]);
    expect(await flags(b)).toEqual([]);
  });
});
