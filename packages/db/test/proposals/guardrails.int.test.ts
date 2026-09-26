// G2 (leaf 1.3.3) on PostgreSQL: the FBK-8 guardrails through the real service — fingerprint
// suppression after a rejection (and its R-33 direction), the pending budget (R-33: rule and
// insights only), protected ops never proposed (AGT-5, R-10) checked against stored state,
// expiry, R-33's "a second run after accept proposes nothing", and accept/reject (FBK-9).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ProposalDraft } from "@mealplanner/core/learning/rules";
import type { SynthesisResult } from "@mealplanner/core/learning/rules";
import { createRepos } from "../../src/repos/index.js";
import { undoChangeSet } from "../../src/services/changes/index.js";
import {
  ProposalStateError,
  acceptProposal,
  createProposals,
  expireProposals,
  insightsDue,
  listProposals,
  rejectProposal,
  runInsights,
} from "../../src/services/proposals/index.js";
import type { TestDatabase } from "../support/db.js";
import { must } from "../support/must.js";
import { f1WithDish } from "../reviews/support.js";
import {
  DAY,
  dishReviews,
  preferenceDraft,
  proposals,
  reviewDatabase,
  reviewHousehold,
} from "./support.js";

let database: TestDatabase;
let n = 0;
beforeAll(async () => {
  database = await reviewDatabase();
}, 120_000);
afterAll(async () => {
  await database.drop();
});

/** A fresh household in the shared test database. */
async function household() {
  n += 1;
  return reviewHousehold(database, f1WithDish({ id: `F1G${n.toString()}` }));
}

const reasons = (dropped: { reason: string }[]) => dropped.map((d) => d.reason);

describe("R-33: rules read the whole window, so accepted and pending proposals are not repeated", () => {
  it("G2 a second run over the same reviews after accept proposes nothing", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 2);
    const first = await runInsights(database.db, ctx);
    expect(first.stored).toHaveLength(1);
    const accepted = await acceptProposal(database.db, ctx, must(first.stored[0]).id);
    expect(accepted.proposal.status).toBe("accepted");

    const second = await runInsights(database.db, ctx);
    expect(second.stored).toEqual([]);
    expect(reasons(second.dropped)).toEqual(["satisfied"]);
    expect((await listProposals(database.db, ctx, { status: "pending" })).length).toBe(0);
  });

  it("G2 a second run while the first proposal is pending proposes nothing new", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 2);
    await runInsights(database.db, ctx);
    const second = await runInsights(database.db, ctx);
    expect(second.stored).toEqual([]);
    expect(reasons(second.dropped)).toEqual(["pending"]);
    expect(await proposals(database.db, ctx)).toHaveLength(1);
  });

  it("G2 an accepted proposal suppresses its fingerprint for 30 days even when state drifts", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 2);
    const first = await runInsights(database.db, ctx);
    const accepted = await acceptProposal(database.db, ctx, must(first.stored[0]).id);
    // Undo the change: the state no longer satisfies the proposal, but it was accepted recently.
    await undoChangeSet(database.db, ctx, accepted.changeSet.changeSetId, {
      actor: "user",
      source: "ui",
    });
    const second = await runInsights(database.db, ctx);
    expect(second.stored).toEqual([]);
    expect(reasons(second.dropped)).toEqual(["recently_accepted"]);
  });
});

describe("fingerprint suppression after rejection (FBK-8)", () => {
  it("G2 a rejected proposal is not proposed again until the evidence doubles", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 2);
    const first = await runInsights(database.db, ctx);
    const rejected = await rejectProposal(
      database.db,
      ctx,
      must(first.stored[0]).id,
      "  They like it, really. ",
    );
    expect(rejected).toMatchObject({ status: "rejected", decisionNote: "They like it, really." });

    await dishReviews(database, h, 1);
    const three = await runInsights(database.db, ctx);
    expect(three.stored).toEqual([]);
    expect(reasons(three.dropped)).toEqual(["recently_rejected"]);

    await dishReviews(database, h, 1);
    const four = await runInsights(database.db, ctx);
    expect(four.stored).toHaveLength(1);
    expect(four.stored[0]?.evidence).toMatchObject({ count: 4 });
  });

  it("G2 rejecting one direction does not suppress the opposite direction (R-33)", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const a = h.member("adult_a");
    const [dislike] = (
      await createProposals(database.db, ctx, [preferenceDraft(a, h.dishId, -0.8)])
    ).stored;
    await rejectProposal(database.db, ctx, must(dislike).id);
    const like = await createProposals(database.db, ctx, [preferenceDraft(a, h.dishId, 0.8)]);
    expect(like.stored).toHaveLength(1);
    const again = await createProposals(database.db, ctx, [preferenceDraft(a, h.dishId, -0.5)]);
    expect(again.stored).toEqual([]);
    expect(reasons(again.dropped)).toEqual(["recently_rejected"]);
  });
});

describe("pending budget (FBK-8, R-33)", () => {
  it("G2 at most 5 rule/insights proposals are pending; agent_chat ones are neither blocked nor counted", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const members = ["adult_a", "adult_b", "c1", "c2", "c3", "adult_a"].map(h.member);
    const priorities = [1, 2, 3, 4, 5, 3];
    const drafts: ProposalDraft[] = members.map((m, i) =>
      preferenceDraft(m, h.dishId, i === 5 ? 0.6 : -0.6, { priority: priorities[i] ?? 3 }),
    );
    const result = await createProposals(database.db, ctx, drafts);
    expect(result.stored).toHaveLength(5);
    expect(reasons(result.dropped)).toEqual(["budget"]);
    // The dropped one is the lowest priority (1).
    expect(result.dropped[0]?.title).toBe(drafts[0]?.title);

    const chat = await createProposals(
      database.db,
      ctx,
      [preferenceDraft(h.member("c1"), h.dishId, 0.9, { origin: "agent_chat" })],
      { now: new Date() },
    );
    expect(chat.stored).toHaveLength(1);
    const pending = await listProposals(database.db, ctx, { status: "pending" });
    expect(pending.filter((p) => p.origin !== "agent_chat")).toHaveLength(5);
    expect(pending).toHaveLength(6);
  });
});

describe("protected ops are never proposed (FBK-8, AGT-5, R-10)", () => {
  it("G2 relaxing or removing C3's sesame allergy is never proposed by the engine, checked against stored state", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const c3 = h.member("c3");
    const [allergy] = await createRepos(database.db, ctx).exclusion.list({ memberId: c3 });
    const relax: ProposalDraft = {
      origin: "insights",
      title: "Relax the sesame rule",
      rationale: "Test.",
      ops: [
        {
          kind: "exclusion.add",
          payload: {
            memberId: c3,
            kind: "dietary_flag",
            key: "contains_sesame",
            reason: "dislike",
            hard: false,
          },
        },
      ],
      evidence: { reviewIds: [], count: 9, metrics: {} },
      priority: 5,
    };
    const remove: ProposalDraft = {
      ...relax,
      origin: "rule",
      title: "Remove the sesame rule",
      ops: [{ kind: "exclusion.remove", payload: { exclusionId: must(allergy).id } }],
    };
    const tolerance: ProposalDraft = {
      ...relax,
      title: "Loosen protein",
      ops: [{ kind: "tolerance.set", payload: { memberId: h.member("adult_a"), proteinG: 25 } }],
    };
    const engine = await createProposals(database.db, ctx, [relax, remove, tolerance]);
    expect(engine.stored).toEqual([]);
    expect(reasons(engine.dropped)).toEqual(["protected", "protected", "protected"]);
    // The admin may ask for it in chat: AGT-5 turns the protected op into a proposal.
    const chat = await createProposals(database.db, ctx, [{ ...remove, origin: "agent_chat" }]);
    expect(chat.stored).toHaveLength(1);
  });

  it("G2 R-10 ops are never proposed, even from chat", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const userId = must(h.loaded.users.adult_b);
    const drafts: ProposalDraft[] = [
      { kind: "access.block" as const, payload: { userId } },
      { kind: "access.remove" as const, payload: { userId } },
      { kind: "access.link_member" as const, payload: { userId, memberId: null } },
      {
        kind: "support.grant" as const,
        payload: { operatorUserId: userId, expiresAt: "2027-01-01T00:00:00Z" },
      },
    ].map((op) => ({
      origin: "agent_chat" as const,
      title: op.kind,
      rationale: "Test.",
      ops: [op],
      evidence: { reviewIds: [], count: 1, metrics: {} },
      priority: 3,
    }));
    const result = await createProposals(database.db, ctx, drafts);
    expect(result.stored).toEqual([]);
    expect(reasons(result.dropped)).toEqual(["protected", "protected", "protected", "protected"]);
  });

  it("G2 a synthesised proposal with a protected op is dropped by the service's guardrails", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const c3 = h.member("c3");
    const synthesize = (): Promise<SynthesisResult> =>
      Promise.resolve({
        status: "ok",
        generationId: "70000000-0000-4000-8000-000000000001",
        model: "stub",
        dropped: [],
        proposals: [
          {
            origin: "insights",
            title: "Let Child C3 have sesame",
            rationale: "Test.",
            ops: [
              {
                kind: "exclusion.add",
                payload: {
                  memberId: c3,
                  kind: "dietary_flag",
                  key: "contains_sesame",
                  reason: "other",
                  hard: false,
                },
              },
            ],
            evidence: { reviewIds: [], count: 5, metrics: {} },
            priority: 5,
          },
        ],
      });
    const digest = await runInsights(database.db, ctx, { synthesize });
    expect(digest.synthesis).toMatchObject({ status: "ok", proposals: 1 });
    expect(digest.stored).toEqual([]);
    expect(reasons(digest.dropped)).toEqual(["protected"]);
  });
});

describe("expiry (FBK-8)", () => {
  it("G2 pending proposals expire after 14 days and can no longer be accepted", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const now = new Date();
    const { stored } = await createProposals(
      database.db,
      ctx,
      [preferenceDraft(h.member("adult_b"), h.dishId, -0.8)],
      { now },
    );
    const id = must(stored[0]).id;
    const day13 = new Date(now.getTime() + 13 * DAY);
    const day14 = new Date(now.getTime() + 14 * DAY);
    expect(await expireProposals(database.db, ctx, day13)).toBe(0);
    expect(await listProposals(database.db, ctx, { status: "pending", now: day13 })).toHaveLength(
      1,
    );
    expect(await listProposals(database.db, ctx, { status: "pending", now: day14 })).toHaveLength(
      0,
    );
    await expect(acceptProposal(database.db, ctx, id, { now: day14 })).rejects.toBeInstanceOf(
      ProposalStateError,
    );
    expect(await expireProposals(database.db, ctx, day14)).toBe(1);
    const [row] = await proposals(database.db, ctx);
    expect(row?.status).toBe("expired");
    await expect(rejectProposal(database.db, ctx, id)).rejects.toBeInstanceOf(ProposalStateError);
  });
});

describe("accept and reject (FBK-9)", () => {
  it("G2 accepting applies one proposal_accept change set by the admin, and undo restores the prior state", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const r = createRepos(database.db, ctx);
    const b = h.member("adult_b");
    const before = JSON.stringify(await r.preference.list({ memberId: b }));
    const { stored } = await createProposals(database.db, ctx, [
      preferenceDraft(b, h.dishId, -0.8),
    ]);
    const result = await acceptProposal(database.db, ctx, must(stored[0]).id);
    const cs = await r.change_set.get({ id: result.changeSet.changeSetId });
    expect(cs).toMatchObject({ actor: "user", source: "proposal_accept", actorUserId: ctx.userId });
    expect(result.proposal).toMatchObject({
      status: "accepted",
      changeSetId: result.changeSet.changeSetId,
      decidedByUserId: ctx.userId,
    });
    const rows = await r.preference.list({ memberId: b, entityKey: h.dishId });
    expect(rows).toEqual([
      expect.objectContaining({ score: -0.8, locked: true, source: "proposal" }),
    ]);
    await undoChangeSet(database.db, ctx, result.changeSet.changeSetId, {
      actor: "user",
      source: "ui",
    });
    expect(JSON.stringify(await r.preference.list({ memberId: b }))).toBe(before);
    await expect(acceptProposal(database.db, ctx, must(stored[0]).id)).rejects.toBeInstanceOf(
      ProposalStateError,
    );
  });

  it("G2 rejection notes are fed back to synthesis", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const { stored } = await createProposals(database.db, ctx, [
      preferenceDraft(h.member("adult_a"), h.dishId, -0.8),
    ]);
    await rejectProposal(database.db, ctx, must(stored[0]).id, "Adult A just had a bad day");
    let seen: string[] = [];
    await runInsights(database.db, ctx, {
      synthesize: (input) => {
        seen = input.rejected.map((r) => r.decisionNote ?? "");
        return Promise.resolve({
          status: "disabled",
          reason: "test",
          proposals: [],
          dropped: [],
          generationId: null,
        });
      },
    });
    expect(seen).toEqual(["Adult A just had a bad day"]);
  });
});

describe("FBK-7 synthesis input", () => {
  it("G2 synthesis is shown only rule candidates that can still become proposals", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 2);
    const shown: number[] = [];
    const synthesize = (input: { candidates: readonly unknown[] }): Promise<SynthesisResult> => {
      shown.push(input.candidates.length);
      return Promise.resolve({
        status: "disabled",
        reason: "test",
        proposals: [],
        dropped: [],
        generationId: null,
      });
    };
    await runInsights(database.db, ctx, { synthesize });
    await runInsights(database.db, ctx, { synthesize });
    // First run: the dish dislike is new. Second run: it is pending, so synthesis is not shown it.
    expect(shown).toEqual([1, 0]);
  });
});

describe("FBK-7 trigger and synthesis failure", () => {
  it("G2 insightsDue after 10 unprocessed reviews; the run marks them processed", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 9, { rating: 4 });
    expect(await insightsDue(database.db, ctx)).toBe(false);
    await dishReviews(database, h, 1, { rating: 4 });
    expect(await insightsDue(database.db, ctx)).toBe(true);
    const digest = await runInsights(database.db, ctx);
    expect(digest.reviewsProcessed).toBe(10);
    expect(await insightsDue(database.db, ctx)).toBe(false);
  });

  it("G2 a synthesis failure is reported and the rule candidates are still stored", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 2);
    const digest = await runInsights(database.db, ctx, {
      synthesize: () => Promise.reject(new Error("model unavailable")),
    });
    expect(digest.synthesis).toMatchObject({ status: "failed", message: "model unavailable" });
    expect(digest.stored).toHaveLength(1);
  });
});

describe("negative controls", () => {
  it("G2 negative control: when the first proposal expired instead of being accepted, the second run proposes it again", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    await dishReviews(database, h, 2);
    const first = await runInsights(database.db, ctx);
    expect(first.stored).toHaveLength(1);
    const later = new Date(Date.now() + 15 * DAY);
    const second = await runInsights(database.db, ctx, { now: later });
    // 15 days on, the reviews are still inside the 30-day window and the old proposal has expired.
    expect(second.stored).toHaveLength(1);
  });

  it("G2 negative control: the same six drafts all fit when the budget is not reached, so the budget test measures the budget", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const drafts = ["adult_a", "adult_b", "c1"].map((k) =>
      preferenceDraft(h.member(k), h.dishId, -0.6),
    );
    expect((await createProposals(database.db, ctx, drafts)).stored).toHaveLength(3);
  });

  it("G2 negative control: an unprotected exclusion op from the engine is stored, so the protection test measures protection", async () => {
    const h = await household();
    const ctx = h.loaded.adminContext;
    const draft: ProposalDraft = {
      origin: "rule",
      title: "Adult B dislikes freekeh",
      rationale: "Test.",
      ops: [
        {
          kind: "exclusion.add",
          payload: {
            memberId: h.member("adult_b"),
            kind: "ingredient",
            key: "freekeh",
            reason: "dislike",
            hard: false,
          },
        },
      ],
      evidence: { reviewIds: [], count: 3, metrics: {} },
      priority: 2,
    };
    expect((await createProposals(database.db, ctx, [draft])).stored).toHaveLength(1);
  });
});
