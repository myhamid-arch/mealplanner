// Leaf 1.4.8 G2 (W-6, BLD-8 R-58/R-60): a substituted copy names the substitute. Olive oil → canola
// oil on the real seed library and catalogue: every step, variant label and component name of the
// copy that named olive oil (display name or alias, case-insensitive, whole word) names canola oil
// instead; a variant with olive oil whose steps never name it gets the leading note; variants
// without olive oil are unchanged. Negative control: the same assertions fail on the pre-fix
// `replaced()` (f50c084).
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanDish } from "@mealplanner/core/planner";
import type { Executor } from "../../src/repos/index.js";
import { dish, ingredient } from "../../src/schema/index.js";
import { migrateAndSeed } from "../../src/seed/index.js";
import { loadDbCatalog, type DbCatalog } from "../../src/services/plans/catalog.js";
import { toPlanDishes } from "../../src/services/plans/load-input.js";
import {
  replaced,
  substitutedSteps,
  substitutedText,
  type IngredientNames,
} from "../../src/services/plans/substitute.js";
import { createEmptyDatabase } from "../support/db.js";
import { preFixReplaced } from "./pre-fix-replaced.js";

let drop: () => Promise<void>;
let pool: pg.Pool;
let db: Executor;
let catalog: DbCatalog;
let dishes: PlanDish[];
let olive: { id: string } & IngredientNames;
let canola: { id: string; name: string };

beforeAll(async () => {
  const empty = await createEmptyDatabase("mp_w6");
  drop = empty.drop;
  await migrateAndSeed(empty.url);
  pool = new pg.Pool({ connectionString: empty.url, max: 2 });
  db = drizzle(pool);
  catalog = await loadDbCatalog(db, null);
  dishes = await toPlanDishes(
    db,
    await db.select().from(dish).where(isNull(dish.householdId)),
    catalog,
  );
  const rows = await db.select().from(ingredient).where(isNull(ingredient.createdByHouseholdId));
  const o = rows.find((r) => r.slug === "olive-oil");
  const cn = rows.find((r) => r.slug === "canola-oil");
  if (o === undefined || cn === undefined) throw new Error("olive-oil / canola-oil not seeded");
  olive = { id: o.id, name: o.name, aliases: o.aliases };
  canola = { id: cn.id, name: cn.name };
}, 300_000);

afterAll(async () => {
  await pool.end();
  await drop();
});

const MENTION = (names: IngredientNames) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[names.name, ...names.aliases].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );

const usesOlive = (d: PlanDish) =>
  d.components.some((c) =>
    c.variants.some((v) => v.input.ingredients.some((l) => l.ingredientId === olive.id)),
  );

/**
 * What is wrong with `copy` as the olive oil → canola oil copy of `original` (empty when right).
 * Components and variants are compared by position (the copy keeps the original's order).
 */
function problems(original: PlanDish, copy: PlanDish): string[] {
  const out: string[] = [];
  const mentions = MENTION(olive);
  const note = `Use ${canola.name.toLowerCase()} wherever ${olive.name.toLowerCase()} is mentioned.`;
  original.components.forEach((c, ci) => {
    const cc = copy.components[ci];
    if (cc === undefined) return void out.push(`component ${c.name} missing`);
    const has = c.variants.some((v) =>
      v.input.ingredients.some((l) => l.ingredientId === olive.id),
    );
    if (has && mentions.test(cc.name)) out.push(`component name still names olive oil: ${cc.name}`);
    if (has && mentions.test(c.name) && !/canola oil/i.test(cc.name))
      out.push(`component name does not name canola oil: ${cc.name}`);
    c.variants.forEach((v, vi) => {
      const cv = cc.variants[vi];
      if (cv === undefined) return void out.push(`variant ${v.label} missing`);
      const vHas = v.input.ingredients.some((l) => l.ingredientId === olive.id);
      if (!vHas) {
        if (JSON.stringify(cv.steps) !== JSON.stringify(v.steps) || cv.label !== v.label)
          out.push(`variant without olive oil changed: ${v.label}`);
        return;
      }
      if (mentions.test(cv.label)) out.push(`label still names olive oil: ${cv.label}`);
      if (mentions.test(v.label) && !/canola oil/i.test(cv.label))
        out.push(`label does not name canola oil: ${cv.label}`);
      for (const step of cv.steps)
        if (step !== note && mentions.test(step)) out.push(`step names olive oil: ${step}`);
      const named = v.steps.filter((s) => mentions.test(s));
      if (named.length === 0) {
        if (cv.steps[0] !== note) out.push(`no leading note in ${v.label}: ${cv.steps[0] ?? ""}`);
      } else {
        v.steps.forEach((s, si) => {
          const after = cv.steps[si] ?? "";
          if (mentions.test(s) && !/canola oil/i.test(after))
            out.push(`step ${String(si + 1)} of ${v.label} does not name canola oil: ${after}`);
        });
      }
    });
  });
  return out;
}

describe("substitutedText (W-6 rule)", () => {
  const names = { name: "Olive oil", aliases: ["zeit zaitoun"] };
  const to = { name: "Canola oil" };
  it("replaces the display name and aliases, case-insensitive, keeping capitalisation", () => {
    expect(substitutedText("Heat the olive oil in a pan.", names, to)).toEqual({
      text: "Heat the canola oil in a pan.",
      matched: true,
    });
    expect(substitutedText("Olive oil and lemon", names, to).text).toBe("Canola oil and lemon");
    expect(substitutedText("Drizzle with OLIVE OIL, then zeit zaitoun.", names, to).text).toBe(
      "Drizzle with Canola oil, then canola oil.",
    );
  });
  it("matches whole words only and leaves other text alone", () => {
    expect(substitutedText("Brush with oil; add olive oils later.", names, to)).toEqual({
      text: "Brush with oil; add olive oils later.",
      matched: false,
    });
    expect(substitutedText("unolive oil", names, to).matched).toBe(false);
  });
  it("adds the leading note when no step names the ingredient", () => {
    expect(substitutedSteps(["Toss the salad.", "Serve."], names, to)).toEqual([
      "Use canola oil wherever olive oil is mentioned.",
      "Toss the salad.",
      "Serve.",
    ]);
    expect(substitutedSteps(["Heat the olive oil.", "Serve."], names, to)).toEqual([
      "Heat the canola oil.",
      "Serve.",
    ]);
  });
});

describe("substituted copies of the seed library: olive oil → canola oil (G2)", () => {
  it("every seed dish with olive oil: steps, labels and component names name canola oil", () => {
    const withOlive = dishes.filter(usesOlive);
    expect(withOlive.length).toBeGreaterThan(5);
    // The library has both cases the rule covers: a step naming olive oil and a label naming it.
    const variants = withOlive.flatMap((d) => d.components.flatMap((c) => c.variants));
    expect(variants.some((v) => v.steps.some((s) => MENTION(olive).test(s)))).toBe(true);
    expect(variants.some((v) => MENTION(olive).test(v.label))).toBe(true);
    for (const d of withOlive) {
      const copy = replaced(d, olive.id, canola.id, catalog, olive);
      expect(problems(d, copy), d.name).toEqual([]);
      expect(copy.name).toBe(`${d.name} (with ${canola.name})`);
    }
  });

  it("a variant with olive oil that never names it gets the leading note", () => {
    const d = dishes.filter(usesOlive)[0];
    if (d === undefined) throw new Error("no dish with olive oil");
    const silent: PlanDish = {
      ...d,
      components: d.components.map((c) => ({
        ...c,
        variants: c.variants.map((v) => ({
          ...v,
          steps: v.steps.map((s) => s.replace(MENTION(olive), "the fat")),
        })),
      })),
    };
    const copy = replaced(silent, olive.id, canola.id, catalog, olive);
    expect(problems(silent, copy)).toEqual([]);
    const first = copy.components
      .flatMap((c) => c.variants)
      .find((v) => v.input.ingredients.some((l) => l.ingredientId === canola.id));
    expect(first?.steps[0]).toBe("Use canola oil wherever olive oil is mentioned.");
  });

  it("negative control: the pre-fix replaced() leaves olive oil in the copy's text", () => {
    const withOlive = dishes.filter(usesOlive);
    const found = withOlive.flatMap((d) =>
      problems(d, preFixReplaced(d, olive.id, canola.id, catalog)),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((p) => p.startsWith("step names olive oil"))).toBe(true);
    expect(found.some((p) => p.startsWith("label still names olive oil"))).toBe(true);
  });
});
