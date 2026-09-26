// G2 (leaf 1.3.3): FBK-8 guardrails on the pure layer — fingerprint suppression (with the R-33
// direction), the pending budget (R-33: rule and insights proposals only), protected ops never
// proposed (AGT-5, R-10), expiry, and R-33's pending / accepted / already-satisfied suppression.
import { describe, expect, it } from "vitest";
import {
  PENDING_BUDGET,
  fingerprintOf,
  isExpired,
  proposalExpiry,
  selectProposals,
  type ExistingProposal,
  type GuardrailInput,
  type ProposalDraft,
} from "../../../src/learning/rules/index.js";
import type { ParsedChangeOp } from "../../../src/changes/index.js";
import type { ProposalOrigin } from "../../../src/types/index.js";
import { M, NOW, S, config, uuid } from "./helpers.js";

const DAY = 86_400_000;
const DISH = "50000000-0000-4000-8000-000000000001";
const DISH2 = "50000000-0000-4000-8000-000000000002";

function pref(score: number, entityKey = DISH, memberId: string | null = M.a) {
  return {
    kind: "preference.set" as const,
    payload: {
      memberId,
      entityType: "dish" as const,
      entityKey,
      score,
      locked: true,
      source: "proposal" as const,
    },
  };
}

function draft(
  ops: ProposalDraft["ops"],
  options: { origin?: ProposalOrigin; count?: number; priority?: number; title?: string } = {},
): ProposalDraft {
  return {
    origin: options.origin ?? "rule",
    title: options.title ?? "A proposal",
    rationale: "Because the reviews say so.",
    ops,
    evidence: { reviewIds: [], count: options.count ?? 2, metrics: {} },
    priority: options.priority ?? 3,
  };
}

function existing(
  ops: ProposalDraft["ops"],
  status: ExistingProposal["status"],
  options: {
    daysAgo?: number;
    count?: number;
    origin?: ProposalOrigin;
    expiresInDays?: number;
  } = {},
): ExistingProposal {
  const decidedAt =
    status === "pending" ? null : new Date(NOW.getTime() - (options.daysAgo ?? 1) * DAY);
  return {
    id: uuid(),
    origin: options.origin ?? "rule",
    status,
    fingerprint: fingerprintOf(ops, config()),
    evidenceCount: options.count ?? 2,
    decidedAt,
    expiresAt: new Date(NOW.getTime() + (options.expiresInDays ?? 10) * DAY),
  };
}

function select(
  drafts: ProposalDraft[],
  existingRows: ExistingProposal[] = [],
  extra: Partial<GuardrailInput> = {},
) {
  return selectProposals({
    drafts,
    existing: existingRows,
    state: { config: config(), verifiedIngredientIds: new Set() },
    now: NOW,
    ...extra,
  });
}

const reasons = (r: Awaited<ReturnType<typeof select>>) => r.dropped.map((d) => d.reason);

describe("fingerprints (SPEC-Q-10, R-33)", () => {
  it("G2 the fingerprint is the target and direction, not the exact value", () => {
    expect(fingerprintOf([pref(-0.8)])).toBe(fingerprintOf([pref(-0.6)]));
    expect(fingerprintOf([pref(-0.8)])).not.toBe(fingerprintOf([pref(0.8)]));
    expect(fingerprintOf([pref(-0.8)])).not.toBe(fingerprintOf([pref(-0.8, DISH2)]));
    expect(fingerprintOf([pref(-0.8)])).not.toBe(fingerprintOf([pref(-0.8, DISH, M.b)]));
  });

  it("G2 frequency and distribution fingerprints carry the direction", () => {
    const freq = (minGapDays: number) => ({
      kind: "frequency.set" as const,
      payload: {
        memberId: null,
        entityType: "dish" as const,
        entityKey: DISH,
        minGapDays,
        maxPerWeek: null,
      },
    });
    expect(fingerprintOf([freq(14)])).toBe(fingerprintOf([freq(10)]));
    expect(fingerprintOf([freq(14)])).not.toBe(fingerprintOf([freq(3)]));
    const cfg = config();
    const split = (dinner: number) => ({
      kind: "distribution.set" as const,
      payload: {
        memberId: M.a,
        dayKind: "default" as const,
        shares: [
          { slotTypeId: S.breakfast, share: (1 - dinner) / 2 },
          { slotTypeId: S.dinner, share: dinner },
          { slotTypeId: S.snack, share: (1 - dinner) / 2 },
        ],
      },
    });
    // Default weights for breakfast/dinner/snack put dinner well above 0.2 and below 0.9.
    expect(fingerprintOf([split(0.2)], cfg)).toContain(`away:${S.dinner}`);
    expect(fingerprintOf([split(0.9)], cfg)).toContain(`toward:${S.dinner}`);
  });

  it("G2 a multi-op fingerprint is order-independent", () => {
    expect(fingerprintOf([pref(-0.8), pref(-0.8, DISH2)])).toBe(
      fingerprintOf([pref(-0.8, DISH2), pref(-0.8)]),
    );
  });
});

describe("fingerprint suppression (FBK-8)", () => {
  it("G2 a draft matching a proposal rejected in the last 30 days is suppressed", async () => {
    const r = await select(
      [draft([pref(-0.8)], { count: 3 })],
      [existing([pref(-0.8)], "rejected", { count: 2, daysAgo: 5 })],
    );
    expect(r.kept).toEqual([]);
    expect(reasons(r)).toEqual(["recently_rejected"]);
  });

  it("G2 it passes once the new evidence has doubled", async () => {
    const r = await select(
      [draft([pref(-0.8)], { count: 4 })],
      [existing([pref(-0.8)], "rejected", { count: 2, daysAgo: 5 })],
    );
    expect(r.kept).toHaveLength(1);
  });

  it("G2 a rejection older than 30 days no longer suppresses", async () => {
    const r = await select(
      [draft([pref(-0.8)])],
      [existing([pref(-0.8)], "rejected", { daysAgo: 31 })],
    );
    expect(r.kept).toHaveLength(1);
  });

  it("G2 rejecting one direction does not suppress the opposite one (R-33)", async () => {
    const r = await select(
      [draft([pref(0.8)])],
      [existing([pref(-0.8)], "rejected", { daysAgo: 1 })],
    );
    expect(r.kept).toHaveLength(1);
  });

  it("G2 a draft matching a pending proposal, or one accepted in the last 30 days, is suppressed (R-33)", async () => {
    const pending = await select([draft([pref(-0.8)])], [existing([pref(-0.8)], "pending")]);
    expect(reasons(pending)).toEqual(["pending"]);
    const accepted = await select(
      [draft([pref(-0.8)], { count: 99 })],
      [existing([pref(-0.8)], "accepted", { daysAgo: 10 })],
    );
    expect(reasons(accepted)).toEqual(["recently_accepted"]);
    const old = await select(
      [draft([pref(-0.8)])],
      [existing([pref(-0.8)], "accepted", { daysAgo: 31 })],
    );
    expect(old.kept).toHaveLength(1);
  });

  it("G2 a draft whose ops the current state already satisfies is suppressed (R-33)", async () => {
    const cfg = config();
    const row = {
      id: uuid(),
      householdId: cfg.household.id,
      memberId: M.a,
      entityType: "dish" as const,
      entityKey: DISH,
      score: -0.8,
      evidenceWeight: 0,
      source: "proposal" as const,
      locked: true,
      hard: "none" as const,
      updatedAt: NOW,
    };
    const r = await select([draft([pref(-0.8)])], [], {
      state: { config: { ...cfg, preferences: [row] }, verifiedIngredientIds: new Set() },
    });
    expect(reasons(r)).toEqual(["satisfied"]);
    const unlocked = await select([draft([pref(-0.8)])], [], {
      state: {
        config: { ...cfg, preferences: [{ ...row, locked: false }] },
        verifiedIngredientIds: new Set(),
      },
    });
    expect(unlocked.kept).toHaveLength(1);
  });

  it("G2 two drafts with one fingerprint in a run keep the stronger", async () => {
    const r = await select([
      draft([pref(-0.8)], { count: 2, title: "weak" }),
      draft([pref(-0.6)], { count: 5, title: "strong" }),
    ]);
    expect(r.kept.map((k) => k.title)).toEqual(["strong"]);
    expect(reasons(r)).toEqual(["duplicate"]);
  });
});

describe("pending budget (FBK-8, R-33)", () => {
  const drafts = (n: number, origin: ProposalOrigin = "rule") =>
    Array.from({ length: n }, (_, i) =>
      draft([pref(-0.8, `50000000-0000-4000-8000-${(100 + i).toString().padStart(12, "0")}`)], {
        origin,
        priority: 1 + (i % 5),
        title: `draft ${i.toString()}`,
      }),
    );

  it("G2 at most 5 pending: with 4 pending, 1 of 3 drafts is kept — the highest priority", async () => {
    const pending = [0, 1, 2, 3].map((i) =>
      existing(
        [pref(-0.8, `50000000-0000-4000-8000-${(900 + i).toString().padStart(12, "0")}`)],
        "pending",
      ),
    );
    const r = await select(drafts(3), pending);
    expect(r.kept.map((k) => k.priority)).toEqual([3]);
    expect(reasons(r)).toEqual(["budget", "budget"]);
    expect(r.kept.length + pending.length).toBe(PENDING_BUDGET);
  });

  it("G2 with no room nothing more is stored; expired pending rows free their place", async () => {
    const full = [0, 1, 2, 3, 4].map((i) =>
      existing(
        [pref(-0.8, `50000000-0000-4000-8000-${(900 + i).toString().padStart(12, "0")}`)],
        "pending",
      ),
    );
    expect((await select(drafts(2), full)).kept).toEqual([]);
    const expired = full.map((p, i) =>
      i < 2 ? { ...p, expiresAt: new Date(NOW.getTime() - DAY) } : p,
    );
    expect((await select(drafts(2), expired)).kept).toHaveLength(2);
  });

  it("G2 agent_chat proposals are neither blocked by nor counted against the budget (R-33)", async () => {
    const chatPending = [0, 1, 2, 3, 4].map((i) =>
      existing(
        [pref(-0.8, `50000000-0000-4000-8000-${(900 + i).toString().padStart(12, "0")}`)],
        "pending",
        {
          origin: "agent_chat",
        },
      ),
    );
    expect((await select(drafts(5), chatPending)).kept).toHaveLength(5);
    const enginePending = chatPending.map((p) => ({ ...p, origin: "rule" as const }));
    expect((await select(drafts(3, "agent_chat"), enginePending)).kept).toHaveLength(3);
  });

  it("G2 over-budget drafts are kept highest priority first", async () => {
    const r = await select(drafts(8));
    expect(r.kept.map((k) => k.priority)).toEqual([5, 4, 3, 3, 2]);
  });
});

describe("protected ops are never proposed (FBK-8, AGT-5, R-10)", () => {
  const block = { kind: "access.block" as const, payload: { userId: M.a } };
  const role = { kind: "role.set" as const, payload: { userId: M.a, role: "member" as const } };
  const removeExclusion = { kind: "exclusion.remove" as const, payload: { exclusionId: uuid() } };

  it("G2 R-10 ops are never proposed, whatever the origin", async () => {
    for (const origin of ["rule", "insights", "agent_chat"] as const) {
      const r = await select([draft([block], { origin })]);
      expect(r.kept).toEqual([]);
      expect(reasons(r)).toEqual(["protected"]);
    }
  });

  it("G2 the engine never proposes a registry-protected op; the agent may (AGT-5)", async () => {
    expect(reasons(await select([draft([role], { origin: "insights" })]))).toEqual(["protected"]);
    expect(reasons(await select([draft([role], { origin: "rule" })]))).toEqual(["protected"]);
    expect((await select([draft([role], { origin: "agent_chat" })])).kept).toHaveLength(1);
  });

  it("G2 conditionally protected ops are checked against current state", async () => {
    const isProtected = (op: ParsedChangeOp) => Promise.resolve(op.kind === "exclusion.remove");
    const r = await select([draft([removeExclusion]), draft([pref(-0.8)])], [], { isProtected });
    expect(reasons(r)).toEqual(["protected"]);
    expect(r.kept.map((k) => k.ops[0]?.kind)).toEqual(["preference.set"]);
  });

  it("G2 a proposal with one protected op among others is dropped whole", async () => {
    expect((await select([draft([pref(-0.8), block])])).kept).toEqual([]);
  });

  it("G2 drafts whose ops fail the registry's Zod schemas are dropped as invalid", async () => {
    const bad = {
      kind: "preference.set",
      payload: { memberId: "not-a-uuid", score: 7 },
    } as unknown as ProposalDraft["ops"][number];
    const unknown = {
      kind: "recipe.teleport",
      payload: {},
    } as unknown as ProposalDraft["ops"][number];
    const r = await select([draft([bad]), draft([unknown]), draft([])]);
    expect(reasons(r)).toEqual(["invalid", "invalid", "invalid"]);
  });
});

describe("expiry (FBK-8)", () => {
  it("G2 pending proposals expire after 14 days", () => {
    const created = new Date("2026-09-01T00:00:00Z");
    expect(proposalExpiry(created).toISOString()).toBe("2026-09-15T00:00:00.000Z");
    const row = { status: "pending" as const, expiresAt: proposalExpiry(created) };
    expect(isExpired(row, new Date("2026-09-14T23:59:59Z"))).toBe(false);
    expect(isExpired(row, new Date("2026-09-15T00:00:00Z"))).toBe(true);
    expect(isExpired({ ...row, status: "accepted" }, new Date("2026-10-01T00:00:00Z"))).toBe(false);
  });

  it("G2 an expired pending proposal no longer suppresses its fingerprint", async () => {
    const stale = { ...existing([pref(-0.8)], "pending"), expiresAt: new Date(NOW.getTime() - 1) };
    expect((await select([draft([pref(-0.8)])], [stale])).kept).toHaveLength(1);
  });
});

describe("negative controls", () => {
  it("G2 negative control: the same draft without the rejection record is kept, so the suppression test measures the rejection", async () => {
    expect((await select([draft([pref(-0.8)], { count: 3 })])).kept).toHaveLength(1);
  });

  it("G2 negative control: without the pending rows the same drafts all fit, so the budget test measures the budget", async () => {
    const three = [0, 1, 2].map((i) =>
      draft([pref(-0.8, `50000000-0000-4000-8000-${(100 + i).toString().padStart(12, "0")}`)]),
    );
    expect((await select(three)).kept).toHaveLength(3);
  });

  it("G2 negative control: the same op kind unprotected is kept, so the protection test measures protection", async () => {
    const unblock = { kind: "access.unblock" as const, payload: { userId: M.a } };
    expect((await select([draft([unblock])])).kept).toHaveLength(1);
  });
});
