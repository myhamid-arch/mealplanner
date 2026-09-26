// G2 — FBK-4 propagation weights as stored by the learning change sets, and locked preferences
// never changed by learning. Runs through createReview on PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variantKey } from "@mealplanner/core/learning/preferences";
import type { PreferenceRow } from "@mealplanner/core/types";
import { createRepos } from "../../src/repos/index.js";
import { applyChangeSet, undoChangeSet } from "../../src/services/changes/index.js";
import { ChangeOpError } from "../../src/services/changes/errors.js";
import { createReview } from "../../src/services/reviews/index.js";
import type { TestDatabase } from "../support/db.js";
import { must } from "../support/must.js";
import { plateOf } from "./measure.js";
import { reviewDatabase, reviewHousehold, type ReviewHousehold } from "./support.js";

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The stored-state step of FBK-4, written independently of core's accumulate(). */
function step(state: { score: number; w: number }, weight: number, signal: number) {
  const w = round3(state.w + weight);
  return { score: round3((state.score * (state.w + 2) + weight * signal) / (w + 2)), w };
}

let database: TestDatabase;
let h: ReviewHousehold;
beforeAll(async () => {
  database = await reviewDatabase();
  h = await reviewHousehold(database);
}, 120_000);
afterAll(async () => {
  await database.drop();
});

const learnedRows = async (memberId: string) =>
  await createRepos(database.db, h.as("adult_a")).preference.list({ memberId, source: "learned" });

function byKey(rows: PreferenceRow[]) {
  return new Map(rows.map((r) => [`${r.entityType}:${r.entityKey}`, r]));
}

describe("G2 FBK-4 weights as stored (PostgreSQL)", { timeout: 120_000 }, () => {
  it("G2 dish reviews store the FBK-4 weights: dish 1.0, cuisine 0.3, each method 0.3, each core ingredient 0.15/√n", async () => {
    const ctx = h.as("adult_a");
    const c1 = h.member("c1");
    const plate = await plateOf(database.db, ctx, h.planMealId, c1);
    const methods = [...new Set(plate.variants.map((v) => v.methodKey))];
    const ingredients = [...new Set(plate.variants.flatMap((v) => v.coreIngredientIds))];
    expect(ingredients.length).toBeGreaterThan(1);
    const expectedWeights: Record<string, number> = {
      [`dish:${h.dishId}`]: 1,
      [`cuisine:${plate.cuisineKey}`]: 0.3,
      ...Object.fromEntries(methods.map((m) => [`method:${m}`, 0.3])),
      ...Object.fromEntries(
        ingredients.map((i) => [`ingredient:${i}`, round3(0.15 / Math.sqrt(ingredients.length))]),
      ),
    };
    const ratings = [5, 2, 4];
    for (const rating of ratings)
      await createReview(database.db, ctx, {
        targetType: "dish",
        targetId: h.dishId,
        planMealId: h.planMealId,
        onBehalfOfMemberId: c1,
        rating,
      });
    const stored = byKey(await learnedRows(c1));
    expect([...stored.keys()].sort()).toEqual(Object.keys(expectedWeights).sort());
    for (const [key, weight] of Object.entries(expectedWeights)) {
      let state = { score: 0, w: 0 };
      for (const rating of ratings) state = step(state, weight, (rating - 3) / 2);
      const row = must(stored.get(key), key);
      expect({ key, w: row.evidenceWeight, score: row.score }).toEqual({
        key,
        w: state.w,
        score: state.score,
      });
      expect(row.evidenceWeight).toBeCloseTo(weight * ratings.length, 3);
    }
  });

  it("G2 variant, component, ingredient, cuisine and method reviews store their FBK-4 weights", async () => {
    const ctx = h.as("adult_a");
    const c2 = h.member("c2");
    const r = createRepos(database.db, ctx);
    const components = await r.component.list({ dishId: h.dishId });
    const protein = must(
      components.find((c) => c.role === "protein"),
      "protein component",
    );
    const variants = await r.variant.list({ componentId: protein.id });
    const fried = must(
      variants.find((v) => !v.isDefault),
      "non-default variant",
    );
    const method = must(await r.preparation_method.get({ id: fried.methodId }), "method");
    const carb = must(
      components.find((c) => c.role === "carb"),
      "carb component",
    );
    const plate = await plateOf(database.db, ctx, h.planMealId, c2);
    const carbVariant = must(
      (await r.plate_item.list()).find((i) => i.componentId === carb.id),
      "carb item",
    ).variantId;
    const carbCore = must(
      plate.variants.find((v) => v.variantId === carbVariant),
      "carb",
    ).coreIngredientIds;
    const ingredient = must(
      (await r.ingredient.list({ slug: "chickpeas_cooked" }))[0],
      "chickpeas",
    );

    const post = (
      targetType: "variant" | "component" | "ingredient" | "cuisine" | "method",
      targetId: string,
      extra = {},
    ) =>
      createReview(database.db, ctx, {
        targetType,
        targetId,
        onBehalfOfMemberId: c2,
        rating: 1,
        ...extra,
      });
    await post("variant", fried.id);
    await post("component", carb.id, { planMealId: h.planMealId });
    await post("ingredient", ingredient.id);
    await post("cuisine", "japanese");
    await post("method", "stewed");

    const stored = byKey(await learnedRows(c2));
    const w = (key: string) => stored.get(key)?.evidenceWeight;
    expect(w(`dish:${variantKey(h.dishId, fried.id)}`)).toBe(1);
    expect(w(`method:${method.key}`)).toBe(0.5);
    expect(w(`dish:${h.dishId}`)).toBe(0.3);
    expect(w(`dish:${variantKey(h.dishId, carbVariant)}`)).toBe(0.8);
    for (const id of carbCore)
      expect(w(`ingredient:${id}`)).toBe(round3(0.2 / Math.sqrt(carbCore.length)));
    expect(w(`ingredient:${ingredient.id}`)).toBe(1);
    expect(w("cuisine:japanese")).toBe(1);
    expect(w("method:stewed")).toBe(1);
  });

  it("G2 learning is applied as learning change sets by the system actor, and undo restores the prior state", async () => {
    const ctx = h.as("adult_a");
    const c3 = h.member("c3");
    const before = JSON.stringify(await learnedRows(c3));
    const result = await createReview(database.db, ctx, {
      targetType: "cuisine",
      targetId: "italian",
      onBehalfOfMemberId: c3,
      rating: 5,
      tags: ["loved_it"],
    });
    const cs = must(
      await createRepos(database.db, ctx).change_set.get({ id: must(result.learningChangeSetId) }),
      "cs",
    );
    expect({ actor: cs.actor, source: cs.source, actorUserId: cs.actorUserId }).toEqual({
      actor: "system",
      source: "learning",
      actorUserId: null,
    });
    expect(cs.summary).toBe("Learned from Child C3's review of italian");
    expect(JSON.stringify(await learnedRows(c3))).not.toBe(before);
    await undoChangeSet(database.db, ctx, cs.id, { actor: "user", source: "ui" });
    expect(JSON.stringify(await learnedRows(c3))).toBe(before);
  });

  it("G2 locked preferences are never changed by learning", async () => {
    const ctx = h.as("adult_a");
    const b = h.member("adult_b");
    await applyChangeSet(database.db, ctx, {
      actor: "user",
      source: "ui",
      summary: "Lock two preferences",
      ops: [
        {
          kind: "preference.set",
          payload: {
            memberId: b,
            entityType: "dish",
            entityKey: h.dishId,
            score: 0.8,
            source: "learned",
            evidenceWeight: 3,
            locked: true,
          },
        },
        {
          kind: "preference.set",
          payload: {
            memberId: b,
            entityType: "cuisine",
            entityKey: "levantine",
            score: 0.9,
            source: "explicit",
            locked: true,
          },
        },
      ],
    });
    const locked = async () =>
      JSON.stringify(
        await createRepos(database.db, ctx).preference.list({ memberId: b, locked: true }),
      );
    const before = await locked();
    for (let i = 0; i < 10; i += 1)
      await createReview(database.db, ctx, {
        targetType: "dish",
        targetId: h.dishId,
        onBehalfOfMemberId: b,
        rating: 1,
        tags: ["dry"],
      });
    expect(await locked()).toBe(before);
    // Learning still ran for the unlocked keys, including the learned row beside a locked explicit one.
    const learned = byKey(await learnedRows(b));
    expect(learned.get("cuisine:levantine")?.score).toBeLessThan(0);
    expect(learned.get(`dish:${h.dishId}`)?.score).toBe(0.8);
  });

  it("G2 negative control: without the lock the same reviews change the row, and a direct learned write to a locked row is refused", async () => {
    const ctx = h.as("adult_a");
    const b = h.member("adult_b");
    const r = createRepos(database.db, ctx);
    const row = must(
      (
        await r.preference.list({
          memberId: b,
          entityType: "dish",
          entityKey: h.dishId,
          source: "learned",
        })
      )[0],
      "row",
    );
    await expect(
      applyChangeSet(
        database.db,
        { householdId: ctx.householdId, userId: null, role: "system" },
        {
          actor: "system",
          source: "learning",
          summary: "bypass",
          ops: [
            {
              kind: "preference.set",
              payload: {
                memberId: b,
                entityType: "dish",
                entityKey: h.dishId,
                score: -1,
                source: "learned",
              },
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(ChangeOpError);
    await applyChangeSet(database.db, ctx, {
      actor: "user",
      source: "ui",
      summary: "Unlock",
      ops: [
        {
          kind: "preference.set",
          payload: {
            memberId: b,
            entityType: "dish",
            entityKey: h.dishId,
            score: row.score,
            source: "learned",
            locked: false,
          },
        },
      ],
    });
    await createReview(database.db, ctx, {
      targetType: "dish",
      targetId: h.dishId,
      onBehalfOfMemberId: b,
      rating: 1,
    });
    const after = must(await r.preference.get({ id: row.id }), "after");
    expect(after.score).toBeLessThan(row.score);
  });
});
