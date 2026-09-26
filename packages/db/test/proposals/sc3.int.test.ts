// G1 (leaf 1.3.3) end to end on PostgreSQL — SC-3's proposal half: two 1★ reviews on a dish by
// one member, posted through createReview, produce a pending proposal from the insights run
// (SPEC-Q-12). With no synthesiser wired, synthesis is reported disabled with its reason.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProposalPayloadSchema } from "@mealplanner/core/learning/rules";
import { createRepos } from "../../src/repos/index.js";
import { SYNTHESIS_NOT_WIRED, runInsights } from "../../src/services/proposals/index.js";
import type { TestDatabase } from "../support/db.js";
import { f1WithDish } from "../reviews/support.js";
import { dishReviews, proposals, reviewDatabase, reviewHousehold } from "./support.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await reviewDatabase();
}, 120_000);
afterAll(async () => {
  await database.drop();
});

describe("SC-3 proposal half", () => {
  it("G1 SC-3: two 1★ reviews by one member on a dish produce a pending dish-dislike proposal", async () => {
    const h = await reviewHousehold(database);
    const ctx = h.loaded.adminContext;
    const reviewIds = await dishReviews(database, h, 2);
    const digest = await runInsights(database.db, ctx);

    const rows = await proposals(database.db, ctx);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ origin: "rule", status: "pending", kind: "preference.set" });
    const payload = ProposalPayloadSchema.parse(row?.payload);
    expect(payload.ops).toEqual([
      {
        kind: "preference.set",
        payload: {
          memberId: h.member("adult_a"),
          entityType: "dish",
          entityKey: h.dishId,
          score: -0.8,
          locked: true,
          source: "proposal",
        },
      },
    ]);
    expect(row?.evidence).toMatchObject({ reviewIds: [...reviewIds].sort(), count: 2 });
    expect(row?.expiresAt.getTime()).toBe(digest.runAt.getTime() + 14 * 86_400_000);

    expect(digest.stored.map((p) => p.id)).toEqual([row?.id]);
    expect(digest.synthesis).toEqual({ status: "disabled", reason: SYNTHESIS_NOT_WIRED });
    expect(digest.reviewsProcessed).toBe(2);
    const reviews = await createRepos(database.db, ctx).review.list();
    expect(reviews.every((r) => r.processedAt !== null)).toBe(true);
  });

  it("G1 SC-3 negative control: one 1★ review, or two reviews by different members, produce no proposal", async () => {
    const one = await reviewHousehold(database, f1WithDish({ id: "F1S1" }));
    await dishReviews(database, one, 1);
    await runInsights(database.db, one.loaded.adminContext);
    expect(await proposals(database.db, one.loaded.adminContext)).toEqual([]);

    const split = await reviewHousehold(database, f1WithDish({ id: "F1S2" }));
    await dishReviews(database, split, 1);
    await dishReviews(database, split, 1, { memberKey: "c1" });
    await runInsights(database.db, split.loaded.adminContext);
    expect(await proposals(database.db, split.loaded.adminContext)).toEqual([]);
  });
});
