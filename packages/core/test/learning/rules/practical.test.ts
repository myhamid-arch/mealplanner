// FBK-3 practical tags (W-23, R-82, R-83; leaf-1.3.7 G1, SPEC-Q-4, SPEC-Q-5): the packing tags on
// ≥ 2 reviews of one dish eaten at packed slots give one proposal of a household `dish` exclusion
// scoped to the household's packed slots; `took_too_long` gives a digest note and no op. Triggering
// and non-triggering fixtures, as for the other FBK-7 rules, and the FBK-8 guardrails on the draft.
import { describe, expect, it } from "vitest";
import {
  fingerprintOf,
  runRules,
  selectProposals,
  type ExistingProposal,
  type InsightInput,
  type InsightMeal,
  type ProposalDraft,
} from "../../../src/learning/rules/index.js";
import type { ExclusionRow, HouseholdConfig } from "../../../src/types/index.js";
import {
  HOUSEHOLD,
  M,
  NOW,
  S,
  config,
  daysBefore,
  dish,
  input,
  meal,
  must,
  plate,
  review,
  uuid,
} from "./helpers.js";

const PACKED = ["packed_school_lunch", "packed_work_lunch"];
const DAY = 86_400_000;

const wrap = dish("Chicken shawarma wrap", [
  { name: "Chicken", variants: [{ label: "Grilled" }] },
  { name: "Flatbread", role: "carb", variants: [{ label: "Plain" }] },
]);
const pasta = dish("Pasta bake", [{ name: "Pasta", role: "carb", variants: [{ label: "Baked" }] }]);

/** A meal of the dish at a slot, with a plate for each member. */
function mealAt(slot: keyof typeof S, dishId = wrap.id, members: string[] = [M.c1, M.c2]) {
  return meal(daysBefore(3), dishId, {
    slotTypeId: S[slot],
    plates: members.map((m) => plate(m)),
  });
}

/** A whole-dish review with the meal as its context (what the quick rating sheet stores). */
function packingReview(memberId: string, m: InsightMeal, tags: string[], daysAgo = 2) {
  return review(memberId, "dish", m.dishId, { tags, planMealId: m.id, daysAgo });
}

function run(parts: Partial<InsightInput>) {
  return runRules(input({ dishes: [wrap, pasta], ...parts }));
}

const packingDrafts = (drafts: readonly ProposalDraft[]) =>
  drafts.filter((d) => d.rule === "practical_packing");

describe("FBK-3 packing tags → a dish exclusion from the packed slots", () => {
  it("G1 two reviews from packed meals give one proposal scoped to every packed slot", () => {
    const school = mealAt("packed_school_lunch");
    const reviews = [
      packingReview(M.c1, school, ["hard_to_pack"]),
      packingReview(M.c2, school, ["went_soggy_in_box", "tasty"]),
    ];
    const out = run({ reviews, meals: [school] });
    const [draft, ...rest] = packingDrafts(out.candidates);
    expect(rest).toEqual([]);
    expect(must(draft, "proposal")).toMatchObject({
      origin: "rule",
      rule: "practical_packing",
      title: "Keep Chicken shawarma wrap out of Packed school lunch and Packed work lunch",
      ops: [
        {
          kind: "exclusion.add",
          payload: {
            memberId: null,
            kind: "dish",
            key: wrap.id,
            reason: "other",
            hard: false,
            slotKeys: PACKED,
          },
        },
      ],
      evidence: {
        reviewIds: reviews.map((r) => r.id).sort(),
        count: 2,
        metrics: { hard_to_pack: 1, went_soggy_in_box: 1 },
      },
    });
    expect(draft?.rationale).toContain("2 reviews of Chicken shawarma wrap from packed meals");
    expect(draft?.rationale).toContain("stays on the menu at other meals");
  });

  it("G1 plate and plan_meal targets carry the meal too, and the two packed slots count together", () => {
    const school = mealAt("packed_school_lunch", wrap.id, [M.c1]);
    const work = mealAt("packed_work_lunch", wrap.id, [M.a]);
    const reviews = [
      review(M.c1, "plate", must(school.plates[0]).id, { tags: ["cold_is_bad"] }),
      review(M.a, "plan_meal", work.id, { tags: ["hard_to_pack"] }),
    ];
    const [draft] = packingDrafts(run({ reviews, meals: [school, work] }).candidates);
    expect(draft?.evidence).toMatchObject({
      count: 2,
      metrics: { cold_is_bad: 1, hard_to_pack: 1 },
    });
  });

  it("G1 counts a component review of the dish at a packed meal", () => {
    const school = mealAt("packed_school_lunch");
    const flatbread = must(wrap.components[1]);
    const reviews = [
      review(M.c1, "component", flatbread.id, {
        tags: ["went_soggy_in_box"],
        planMealId: school.id,
      }),
      packingReview(M.c2, school, ["went_soggy_in_box"]),
    ];
    expect(packingDrafts(run({ reviews, meals: [school] }).candidates)).toHaveLength(1);
  });

  it("G1 negative control: one such review gives no proposal", () => {
    const school = mealAt("packed_school_lunch");
    const out = run({
      reviews: [packingReview(M.c1, school, ["hard_to_pack", "cold_is_bad"])],
      meals: [school],
    });
    expect(packingDrafts(out.candidates)).toEqual([]);
  });

  it("does not count the same review twice", () => {
    const school = mealAt("packed_school_lunch");
    const once = packingReview(M.c1, school, ["hard_to_pack"]);
    expect(packingDrafts(run({ reviews: [once, once], meals: [school] }).candidates)).toEqual([]);
  });

  it("ignores packing tags on meals in slots that are not packed", () => {
    const dinner = mealAt("dinner");
    const reviews = [
      packingReview(M.c1, dinner, ["hard_to_pack"]),
      packingReview(M.c2, dinner, ["cold_is_bad"]),
    ];
    expect(packingDrafts(run({ reviews, meals: [dinner] }).candidates)).toEqual([]);
  });

  it("ignores reviews without a meal (they cannot show the dish came out of a box)", () => {
    const reviews = [
      review(M.c1, "dish", wrap.id, { tags: ["hard_to_pack"] }),
      review(M.c2, "dish", wrap.id, { tags: ["went_soggy_in_box"] }),
    ];
    expect(packingDrafts(run({ reviews }).candidates)).toEqual([]);
  });

  it("ignores reviews outside the 30-day window", () => {
    const school = mealAt("packed_school_lunch");
    const reviews = [
      packingReview(M.c1, school, ["hard_to_pack"], 31),
      packingReview(M.c2, school, ["hard_to_pack"], 2),
    ];
    expect(packingDrafts(run({ reviews, meals: [school] }).candidates)).toEqual([]);
  });

  it("counts per dish: one review each on two dishes gives nothing", () => {
    const wrapMeal = mealAt("packed_school_lunch");
    const pastaMeal = mealAt("packed_school_lunch", pasta.id);
    const reviews = [
      packingReview(M.c1, wrapMeal, ["hard_to_pack"]),
      packingReview(M.c2, pastaMeal, ["hard_to_pack"]),
    ];
    expect(packingDrafts(run({ reviews, meals: [wrapMeal, pastaMeal] }).candidates)).toEqual([]);
  });

  it("ignores a review whose target dish is not the dish its meal served", () => {
    const pastaMeal = mealAt("packed_school_lunch", pasta.id);
    const reviews = [
      review(M.c1, "dish", wrap.id, { tags: ["hard_to_pack"], planMealId: pastaMeal.id }),
      review(M.c2, "dish", wrap.id, { tags: ["hard_to_pack"], planMealId: pastaMeal.id }),
    ];
    expect(packingDrafts(run({ reviews, meals: [pastaMeal] }).candidates)).toEqual([]);
  });

  it("proposes nothing when the household has no active packed slot, and scopes to active ones", () => {
    const school = mealAt("packed_school_lunch");
    const reviews = [
      packingReview(M.c1, school, ["hard_to_pack"]),
      packingReview(M.c2, school, ["hard_to_pack"]),
    ];
    const withActive = (keys: string[]): HouseholdConfig => {
      const cfg = config();
      cfg.slotTypes = cfg.slotTypes.map((s) =>
        s.isPacked ? { ...s, active: keys.includes(s.key) } : s,
      );
      return cfg;
    };
    expect(
      packingDrafts(run({ config: withActive([]), reviews, meals: [school] }).candidates),
    ).toEqual([]);
    // The school lunch was turned off since: the reviews still count; the scope is what is active.
    const [draft] = packingDrafts(
      run({ config: withActive(["packed_work_lunch"]), reviews, meals: [school] }).candidates,
    );
    expect(draft?.ops[0]?.payload).toMatchObject({ slotKeys: ["packed_work_lunch"] });
    expect(draft?.title).toBe("Keep Chicken shawarma wrap out of Packed work lunch");
  });
});

describe("FBK-3 took_too_long → a digest note, no op", () => {
  it("G1 two reviews give one note and no proposal, whatever the slot", () => {
    const dinner = mealAt("dinner");
    const reviews = [
      packingReview(M.a, dinner, ["took_too_long"]),
      review(M.b, "dish", wrap.id, { tags: ["took_too_long"] }),
    ];
    const out = run({ reviews, meals: [dinner] });
    expect(out.notes.filter((n) => n.rule === "practical_time")).toEqual([
      {
        rule: "practical_time",
        title: "Chicken shawarma wrap takes too long",
        rationale:
          "2 reviews said Chicken shawarma wrap took too long to make. Keep it for days with more time, or ask for a quicker version.",
        subject: { dishId: wrap.id, tags: { took_too_long: 2 } },
        evidence: { reviewIds: reviews.map((r) => r.id).sort(), count: 2, metrics: {} },
      },
    ]);
    expect(out.candidates).toEqual([]);
  });

  it("gives nothing for a single review, and packing tags never make a time note", () => {
    const school = mealAt("packed_school_lunch");
    const out = run({
      reviews: [
        packingReview(M.a, school, ["took_too_long"]),
        packingReview(M.c1, school, ["hard_to_pack"]),
        packingReview(M.c2, school, ["cold_is_bad"]),
      ],
      meals: [school],
    });
    expect(out.notes.filter((n) => n.rule === "practical_time")).toEqual([]);
    // The packing proposal counts only the two packing reviews.
    expect(packingDrafts(out.candidates)[0]?.evidence.count).toBe(2);
  });
});

describe("FBK-8 guardrails on the packing proposal", () => {
  const school = mealAt("packed_school_lunch");
  const reviews = [
    packingReview(M.c1, school, ["hard_to_pack"]),
    packingReview(M.c2, school, ["went_soggy_in_box"]),
  ];
  const drafts = packingDrafts(run({ reviews, meals: [school] }).candidates);
  const ops = must(drafts[0], "proposal").ops;

  const exclusion = (
    slotKeys: string[] | null,
    over: Partial<ExclusionRow> = {},
  ): ExclusionRow => ({
    id: uuid(),
    householdId: HOUSEHOLD,
    memberId: null,
    kind: "dish",
    key: wrap.id,
    reason: "other",
    hard: false,
    slotKeys,
    ...over,
  });
  const stored = (status: ExistingProposal["status"], daysAgo = 5): ExistingProposal => ({
    id: uuid(),
    origin: "rule",
    status,
    fingerprint: fingerprintOf(ops, config()),
    evidenceCount: 2,
    decidedAt: status === "pending" ? null : new Date(NOW.getTime() - daysAgo * DAY),
    expiresAt: new Date(NOW.getTime() + 10 * DAY),
  });
  const select = (existing: ExistingProposal[] = [], rows: ExclusionRow[] = []) => {
    const cfg = config();
    cfg.exclusions = [...cfg.exclusions, ...rows];
    return selectProposals({
      drafts,
      existing,
      state: { config: cfg, verifiedIngredientIds: new Set() },
      now: NOW,
    });
  };

  it("G1 passes validation as one pending proposal (the op is not protected)", async () => {
    const r = await select();
    expect(r.dropped).toEqual([]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.fingerprint).toBe(`exclusion.add|household|dish|${wrap.id}`);
  });

  it("G1 is deduplicated by fingerprint: pending, or rejected in the last 30 days", async () => {
    expect((await select([stored("pending")])).dropped.map((d) => d.reason)).toEqual(["pending"]);
    expect((await select([stored("rejected", 5)])).dropped.map((d) => d.reason)).toEqual([
      "recently_rejected",
    ]);
    expect((await select([stored("rejected", 31)])).kept).toHaveLength(1);
  });

  it("is satisfied by an exclusion whose scope covers both packed slots, not by a narrower one", async () => {
    expect((await select([], [exclusion(PACKED)])).dropped.map((d) => d.reason)).toEqual([
      "satisfied",
    ]);
    expect(
      (await select([], [exclusion(null, { reason: "dislike", hard: true })])).dropped,
    ).toHaveLength(1);
    expect((await select([], [exclusion(["packed_school_lunch"])])).kept).toHaveLength(1);
    // A member's own row does not cover the household.
    expect((await select([], [exclusion(PACKED, { memberId: M.c1 })])).kept).toHaveLength(1);
  });
});
