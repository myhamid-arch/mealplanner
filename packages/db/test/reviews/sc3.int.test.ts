// G1 — SC-3 (R-26): two 1★ reviews by one member lower that member's dish preference score by
// ≥ 0.3 and plate appeal by a measured amount > 0; every other member's appeal and preference rows
// are unchanged. Runs through createReview on PostgreSQL, the real write path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveScore } from "@mealplanner/core/learning/preferences";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos } from "../../src/repos/index.js";
import { createReview } from "../../src/services/reviews/index.js";
import type { TestDatabase } from "../support/db.js";
import { appealOf, recordMeasurement } from "./measure.js";
import { f1WithDish, reviewDatabase, reviewHousehold, type ReviewHousehold } from "./support.js";

const MEMBER_KEYS = ["adult_a", "adult_b", "c1", "c2", "c3"];
const PLATED = ["adult_a", "c1", "c2"];

let database: TestDatabase;
beforeAll(async () => {
  database = await reviewDatabase();
}, 120_000);
afterAll(async () => {
  await database.drop();
});

interface Sc3 {
  dishScoreDrop: number;
  appealDrop: number;
  othersUnchanged: boolean;
  changeSets: { actor: string; source: string }[];
}

/**
 * Posts two 1★ dish reviews as `author` on behalf of `onBehalfOf` (undefined: the author's own
 * member), and measures SC-3 for member adult_a.
 */
async function runSc3(
  h: ReviewHousehold,
  author: string,
  onBehalfOf?: string | null,
): Promise<Sc3> {
  const ctx: HouseholdContext = h.as(author);
  const db = database.db;
  const r = createRepos(db, ctx);
  const a = h.member("adult_a");
  const others = MEMBER_KEYS.filter((k) => k !== "adult_a").map(h.member);
  const appeals = async () =>
    Object.fromEntries(
      await Promise.all(
        PLATED.map(async (k) => [k, await appealOf(db, ctx, h.planMealId, h.member(k))] as const),
      ),
    );
  const othersRows = async () =>
    JSON.stringify(
      (await r.preference.list()).filter((p) => p.memberId === null || others.includes(p.memberId)),
    );
  const dishScore = async () => resolveScore(await r.preference.list(), a, "dish", h.dishId);

  const appealBefore = await appeals();
  const rowsBefore = await othersRows();
  const scoreBefore = await dishScore();
  const changeSets = [];
  for (let i = 0; i < 2; i += 1) {
    const result = await createReview(db, ctx, {
      targetType: "dish",
      targetId: h.dishId,
      planMealId: h.planMealId,
      rating: 1,
      ...(onBehalfOf === undefined ? {} : { onBehalfOfMemberId: onBehalfOf }),
    });
    if (result.learningChangeSetId !== null) {
      const cs = await r.change_set.get({ id: result.learningChangeSetId });
      if (cs !== null) changeSets.push({ actor: cs.actor, source: cs.source });
    }
  }
  const appealAfter = await appeals();
  return {
    dishScoreDrop: scoreBefore - (await dishScore()),
    appealDrop: (appealBefore.adult_a ?? 0) - (appealAfter.adult_a ?? 0),
    othersUnchanged:
      PLATED.filter((k) => k !== "adult_a").every((k) => appealBefore[k] === appealAfter[k]) &&
      rowsBefore === (await othersRows()),
    changeSets,
  };
}

const holds = (m: Sc3) => m.dishScoreDrop >= 0.3 && m.appealDrop > 0 && m.othersUnchanged;

describe("G1 SC-3 through createReview (PostgreSQL)", { timeout: 120_000 }, () => {
  it("G1 on F1 (liked cuisines): two 1★ reviews lower adult A's dish score by ≥ 0.3 and appeal by > 0; others unchanged", async () => {
    const h = await reviewHousehold(database, f1WithDish({ id: "F1-liked" }));
    const m = await runSc3(h, "adult_a");
    recordMeasurement("F1 liked cuisines", { ...m, changeSets: m.changeSets.length });
    expect(m.dishScoreDrop).toBeGreaterThanOrEqual(0.3);
    expect(m.appealDrop).toBeGreaterThan(0);
    expect(m.othersUnchanged).toBe(true);
    expect(m.changeSets).toEqual([
      { actor: "system", source: "learning" },
      { actor: "system", source: "learning" },
    ]);
  });

  it("G1 on a household with no preferences: the same holds", async () => {
    const h = await reviewHousehold(database, f1WithDish({ id: "F1-plain", likedCuisines: false }));
    const m = await runSc3(h, "adult_a");
    recordMeasurement("F1 without preferences", { ...m, changeSets: m.changeSets.length });
    expect(holds(m)).toBe(true);
  });

  it("G1 negative control: reviews learned for another member, or by a login with no member, fail SC-3", async () => {
    const h1 = await reviewHousehold(database, f1WithDish({ id: "F1-neg-1" }));
    const wrong = await runSc3(h1, "adult_a", h1.member("adult_b"));
    expect(holds(wrong)).toBe(false);
    const h2 = await reviewHousehold(database, f1WithDish({ id: "F1-neg-2" }));
    const none = await runSc3(h2, "kitchen");
    expect(none.changeSets).toEqual([]);
    expect(holds(none)).toBe(false);
  });
});
