// G1 (leaf 1.3.3): every FBK-7 rule — and the FBK-6 frequency rules, FBK-5 targeted quantity rule
// and the SC-3 dish-level rule this leaf adds (SPEC-Q-12 … 14) — with triggering and
// non-triggering fixtures. Each rule is called on its own and through runRules.
import { describe, expect, it } from "vitest";
import {
  RECIPE_REVISION_OP,
  RuleContext,
  aiIngredient,
  dishDislike,
  ingredientDislike,
  moreOrLessOften,
  neverAgain,
  observedFrequency,
  plateMisses,
  recipeNotes,
  recipeRevisionProposals,
  runRules,
  shiftShare,
  targetedQuantity,
  variantDislike,
  type InsightInput,
  type ProposalDraft,
} from "../../../src/learning/rules/index.js";
import { ChangeOpSchema } from "../../../src/changes/index.js";
import {
  M,
  S,
  config,
  daysBefore,
  dish,
  ingredient,
  input,
  meal,
  plate,
  review,
  must,
} from "./helpers.js";

type Rule = (ctx: RuleContext) => ProposalDraft[];
const run = (rule: Rule, i: InsightInput) => rule(new RuleContext(i));

/** Every draft a rule makes must carry registry-valid ops (validated as the guardrails will). */
function expectValidOps(drafts: ProposalDraft[]) {
  for (const d of drafts)
    for (const op of d.ops) expect(ChangeOpSchema.safeParse(op).success).toBe(true);
}

/** The triggering assertion: exactly one draft from `rule`, whose first op has `kind`. */
function assertTriggers(drafts: ProposalDraft[], kind: string): ProposalDraft {
  if (drafts.length !== 1) throw new Error(`expected 1 draft, got ${drafts.length.toString()}`);
  const [d] = drafts;
  if (d?.ops[0]?.kind !== kind) throw new Error(`expected ${kind}, got ${String(d?.ops[0]?.kind)}`);
  expectValidOps(drafts);
  return d;
}

// Fixtures -------------------------------------------------------------------------------------

const hammour = dish("Hammour two ways", [
  {
    name: "Hammour",
    variants: [{ label: "Grilled" }, { label: "Breaded fried" }],
  },
]);
const grilled = must(must(hammour.components[0]).variants[0]);
const fried = must(must(hammour.components[0]).variants[1]);

const freekeh = ingredient("freekeh");
const chicken = ingredient("chicken_breast");
const bowl = dish("Freekeh chicken bowl", [
  { name: "Freekeh", role: "carb", variants: [{ label: "Boiled", core: [freekeh.id] }] },
  { name: "Chicken", variants: [{ label: "Grilled", core: [chicken.id] }] },
]);
const freekehComponent = must(bowl.components[0]);
const chickenComponent = must(bowl.components[1]);

const shawarma = dish("Chicken shawarma bowl", [
  { name: "Chicken", variants: [{ label: "Grilled", core: [chicken.id] }] },
]);

// ----------------------------------------------------------------------------------------------

describe("FBK-7 rule 1 — variant disliked by one member", () => {
  const ratings = (member: string, variantId: string, values: number[], daysAgo = 2) =>
    values.map((rating) => review(member, "variant", variantId, { rating, daysAgo }));

  it("G1 rule 1 triggers: mean ≤ 2.5 over 3 of one member's variant reviews → locked −0.8", () => {
    const d = assertTriggers(
      run(
        variantDislike,
        input({ dishes: [hammour], reviews: ratings(M.a, grilled.id, [2, 3, 2]) }),
      ),
      "preference.set",
    );
    expect(d.ops[0]).toEqual({
      kind: "preference.set",
      payload: {
        memberId: M.a,
        entityType: "dish",
        entityKey: `${hammour.id}#${grilled.id}`,
        score: -0.8,
        locked: true,
        source: "proposal",
      },
    });
    expect(d.evidence.count).toBe(3);
    expect(d.evidence.reviewIds).toHaveLength(3);
  });

  it("G1 rule 1 names a better-rated sibling variant in the rationale", () => {
    const reviews = [...ratings(M.a, grilled.id, [1, 2, 2]), ...ratings(M.a, fried.id, [4, 5])];
    const [d] = run(variantDislike, input({ dishes: [hammour], reviews }));
    expect(d?.rationale).toContain("Breaded fried");
  });

  it("G1 rule 1 does not trigger: only 2 reviews, a mean above 2.5, reviews split across members, or outside 30 days", () => {
    const cases = [
      ratings(M.a, grilled.id, [1, 1]),
      ratings(M.a, grilled.id, [2, 3, 3]),
      [...ratings(M.a, grilled.id, [1, 1]), ...ratings(M.b, grilled.id, [1])],
      ratings(M.a, grilled.id, [1, 1, 1], 31),
    ];
    for (const reviews of cases)
      expect(run(variantDislike, input({ dishes: [hammour], reviews }))).toEqual([]);
  });
});

describe("SPEC-Q-12 (SC-3) — dish disliked by one member", () => {
  it("G1 dish rule triggers: two 1★ dish reviews by one member → locked −0.8 dish preference", () => {
    const reviews = [
      review(M.a, "dish", shawarma.id, { rating: 1 }),
      review(M.a, "dish", shawarma.id, { rating: 1, daysAgo: 3 }),
    ];
    const d = assertTriggers(
      run(dishDislike, input({ dishes: [shawarma], reviews })),
      "preference.set",
    );
    expect(d.ops[0]?.payload).toMatchObject({
      memberId: M.a,
      entityType: "dish",
      entityKey: shawarma.id,
      score: -0.8,
      locked: true,
    });
  });

  it("G1 dish rule counts plan_meal and plate reviews of the same dish", () => {
    const m = meal(daysBefore(2), shawarma.id, { plates: [plate(M.a)] });
    const reviews = [
      review(M.a, "plan_meal", m.id, { rating: 2 }),
      review(M.a, "plate", must(m.plates[0]).id, { rating: 2 }),
    ];
    expect(run(dishDislike, input({ dishes: [shawarma], meals: [m], reviews }))).toHaveLength(1);
  });

  it("G1 dish rule does not trigger: one review, a 1★ and a 5★, two members, or component reviews", () => {
    const cases = [
      [review(M.a, "dish", shawarma.id, { rating: 1 })],
      [
        review(M.a, "dish", shawarma.id, { rating: 1 }),
        review(M.a, "dish", shawarma.id, { rating: 5 }),
      ],
      [
        review(M.a, "dish", shawarma.id, { rating: 1 }),
        review(M.b, "dish", shawarma.id, { rating: 1 }),
      ],
      [
        review(M.a, "component", must(shawarma.components[0]).id, { rating: 1 }),
        review(M.a, "component", must(shawarma.components[0]).id, { rating: 1 }),
      ],
    ];
    for (const reviews of cases)
      expect(run(dishDislike, input({ dishes: [shawarma], reviews }))).toEqual([]);
  });
});

describe("FBK-7 rule 2 — ingredient in negative component reviews", () => {
  const negative = (
    member: string,
    componentId: string,
    opts: { rating?: number; tags?: string[] },
  ) => review(member, "component", componentId, opts);

  it("G1 rule 2 triggers: an ingredient in 3 negative component reviews by one member → dislike exclusion (hard: false)", () => {
    const reviews = [
      negative(M.b, freekehComponent.id, { rating: 1 }),
      negative(M.b, freekehComponent.id, { rating: 2 }),
      negative(M.b, freekehComponent.id, { tags: ["bland"] }),
    ];
    const d = assertTriggers(
      run(ingredientDislike, input({ dishes: [bowl], ingredients: [freekeh, chicken], reviews })),
      "exclusion.add",
    );
    expect(d.ops[0]?.payload).toEqual({
      memberId: M.b,
      kind: "ingredient",
      key: "freekeh",
      reason: "dislike",
      hard: false,
    });
  });

  it("G1 rule 2 uses the variant on the member's plate when the review has a meal", () => {
    const other = ingredient("bulgur");
    const twoWays = dish("Grain bowl", [
      {
        name: "Grain",
        role: "carb",
        variants: [
          { label: "Freekeh", core: [freekeh.id] },
          { label: "Bulgur", core: [other.id] },
        ],
      },
    ]);
    const component = must(twoWays.components[0]);
    const bulgurVariant = must(component.variants[1]);
    const meals = [0, 1, 2].map((i) =>
      meal(daysBefore(i + 1), twoWays.id, {
        plates: [
          plate(M.b, { items: [{ componentId: component.id, variantId: bulgurVariant.id }] }),
        ],
      }),
    );
    const reviews = meals.map((m) => ({
      ...negative(M.b, component.id, { rating: 1 }),
      planMealId: m.id,
    }));
    const [d] = run(
      ingredientDislike,
      input({ dishes: [twoWays], ingredients: [freekeh, other], meals, reviews }),
    );
    expect(d?.ops[0]?.payload).toMatchObject({ key: "bulgur" });
  });

  it("G1 rule 2 does not trigger: 2 negative reviews, positive reviews, or reviews by different members", () => {
    const cases = [
      [
        negative(M.b, freekehComponent.id, { rating: 1 }),
        negative(M.b, freekehComponent.id, { rating: 1 }),
      ],
      [0, 1, 2].map(() => negative(M.b, freekehComponent.id, { rating: 4, tags: ["tasty"] })),
      [M.a, M.b, M.c1].map((m) => negative(m, freekehComponent.id, { rating: 1 })),
    ];
    for (const reviews of cases)
      expect(
        run(ingredientDislike, input({ dishes: [bowl], ingredients: [freekeh, chicken], reviews })),
      ).toEqual([]);
  });

  it("G1 rule 2 does not count a negative review of another component", () => {
    const reviews = [0, 1, 2].map(() => negative(M.b, chickenComponent.id, { rating: 1 }));
    const drafts = run(
      ingredientDislike,
      input({ dishes: [bowl], ingredients: [freekeh, chicken], reviews }),
    );
    expect(drafts.map((d) => d.ops[0]?.payload)).toEqual([
      expect.objectContaining({ key: "chicken_breast" }),
    ]);
  });
});

describe("FBK-7 rule 3 — repeated recipe notes", () => {
  it("G1 rule 3 triggers: a note tag repeated twice on one dish → a revise-recipe note", () => {
    const reviews = [
      review(M.a, "dish", shawarma.id, { tags: ["too_salty"] }),
      review(M.b, "dish", shawarma.id, { tags: ["too_salty", "dry"] }),
    ];
    const notes = recipeNotes(new RuleContext(input({ dishes: [shawarma], reviews })));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.subject).toEqual({
      dishId: shawarma.id,
      variantId: null,
      tags: { too_salty: 2 },
    });
    expect(notes[0]?.evidence.count).toBe(2);
  });

  it("G1 rule 3 keys variant reviews by the variant", () => {
    const reviews = [0, 1].map(() => review(M.a, "variant", grilled.id, { tags: ["dry"] }));
    const [note] = recipeNotes(new RuleContext(input({ dishes: [hammour], reviews })));
    expect(note?.subject).toMatchObject({ dishId: hammour.id, variantId: grilled.id });
  });

  it("G1 rule 3 does not trigger: different tags once each, or non-note tags", () => {
    const cases = [
      [
        review(M.a, "dish", shawarma.id, { tags: ["too_salty"] }),
        review(M.b, "dish", shawarma.id, { tags: ["dry"] }),
      ],
      [0, 1].map(() => review(M.a, "dish", shawarma.id, { tags: ["loved_it", "more_often"] })),
    ];
    for (const reviews of cases)
      expect(recipeNotes(new RuleContext(input({ dishes: [shawarma], reviews })))).toEqual([]);
  });

  it("G1 rule 3 stays a note while no revision op exists (R-33), and the switch turns it into a proposal", () => {
    expect(RECIPE_REVISION_OP).toBeNull();
    const reviews = [0, 1].map(() => review(M.a, "dish", shawarma.id, { tags: ["too_oily"] }));
    const i = input({ dishes: [shawarma], reviews });
    const out = runRules(i);
    expect(out.candidates.filter((c) => c.rule === "recipe_notes")).toEqual([]);
    expect(out.notes).toHaveLength(1);
    const proposals = recipeRevisionProposals(new RuleContext(i), "recipe.revise");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.ops[0]).toEqual({
      kind: "recipe.revise",
      payload: { dishId: shawarma.id, variantId: null, notes: ["too_oily"] },
    });
  });
});

describe("FBK-7 rule 4 — repeated plate misses", () => {
  const misses = (
    days: number[],
    kcal: number,
    fitStatus: "infeasible" | "flexible_miss" = "infeasible",
  ) =>
    days.map((d) =>
      meal(daysBefore(d), shawarma.id, {
        slotTypeId: S.dinner,
        plates: [plate(M.a, { fitStatus, kcalDeviation: kcal })],
      }),
    );

  it("G1 rule 4 triggers: ≥ 3 miss days in 14 under the kcal target → share moves away from the slot", () => {
    // Sun 20, Thu 24 and Sat 26 Sep: default days for adult A, who trains Mon/Wed/Fri.
    const meals = misses([6, 2, 0], -120);
    const d = assertTriggers(
      run(plateMisses, input({ dishes: [shawarma], meals })),
      "distribution.set",
    );
    const payload = d.ops[0]?.payload as { shares: { slotTypeId: string; share: number }[] };
    const dinner = must(payload.shares.find((s) => s.slotTypeId === S.dinner));
    const shift = must(shiftShare(new RuleContext(input()), M.a, daysBefore(0), S.dinner, "away"));
    expect(dinner.share).toBeCloseTo(shift.from - 0.05, 4);
    expect(payload.shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 6);
    expect(d.evidence.count).toBe(3);
  });

  it("G1 rule 4 moves share toward the slot when the misses overshoot", () => {
    const [d] = run(
      plateMisses,
      input({ dishes: [shawarma], meals: misses([6, 2, 0], 90, "flexible_miss") }),
    );
    const shares = (d?.ops[0]?.payload as { shares: { slotTypeId: string; share: number }[] })
      .shares;
    const shift = must(
      shiftShare(new RuleContext(input()), M.a, daysBefore(0), S.dinner, "toward"),
    );
    expect(shares.find((s) => s.slotTypeId === S.dinner)?.share).toBeCloseTo(shift.to, 4);
    expect(shift.to).toBeCloseTo(shift.from + 0.05, 4);
  });

  it("G1 rule 4 does not trigger: 2 miss days, mixed directions, in-tolerance plates, untargeted members, misses older than 14 days, or misses split across day kinds", () => {
    const untargeted = [6, 2, 0].map((d) =>
      meal(daysBefore(d), shawarma.id, {
        plates: [plate(M.c1, { fitStatus: "infeasible", kcalDeviation: -100 })],
      }),
    );
    const mixed = [...misses([5, 2], -100), ...misses([0], 100)];
    const inTolerance = [6, 2, 0].map((d) =>
      meal(daysBefore(d), shawarma.id, {
        plates: [plate(M.a, { fitStatus: "in_tolerance", kcalDeviation: -10 })],
      }),
    );
    // [5, 3, 0]: Mon and Wed are adult A's training days, so the misses split across day kinds.
    const cases = [
      misses([5, 2], -100),
      mixed,
      inTolerance,
      untargeted,
      misses([19, 16, 14], -100),
      misses([5, 3, 0], -100),
    ];
    for (const meals of cases)
      expect(run(plateMisses, input({ dishes: [shawarma], meals }))).toEqual([]);
  });
});

describe("FBK-7 rule 5 — AI-estimated ingredient in planned meals", () => {
  const estimated = ingredient("za_atar_blend", {
    nutritionSource: "ai_estimate",
    householdPrivate: true,
  });
  const flatbread = dish("Za'atar flatbread", [
    {
      name: "Flatbread",
      role: "carb",
      variants: [{ label: "Baked", ingredients: [estimated.id] }],
    },
  ]);
  const planned = (days: number[], status: "planned" | "cooked" = "planned") =>
    days.map((d) => meal(daysBefore(d), flatbread.id, { status }));

  it("G1 rule 5 triggers: an unverified AI-estimated ingredient in 3 upcoming planned meals → ingredient.verify", () => {
    const d = assertTriggers(
      run(
        aiIngredient,
        input({ dishes: [flatbread], ingredients: [estimated], meals: planned([0, -1, -3]) }),
      ),
      "ingredient.verify",
    );
    expect(d.ops[0]?.payload).toEqual({ ingredientId: estimated.id });
    expect(d.evidence.count).toBe(3);
  });

  it("G1 rule 5 does not trigger: 2 meals, past or cooked meals, a verified ingredient, or a catalogue source", () => {
    const cases: InsightInput[] = [
      input({ dishes: [flatbread], ingredients: [estimated], meals: planned([0, -1]) }),
      input({ dishes: [flatbread], ingredients: [estimated], meals: planned([1, 2, 3]) }),
      input({
        dishes: [flatbread],
        ingredients: [estimated],
        meals: planned([0, -1, -2], "cooked"),
      }),
      input({
        dishes: [flatbread],
        ingredients: [{ ...estimated, verified: true }],
        meals: planned([0, -1, -2]),
      }),
      input({
        dishes: [flatbread],
        ingredients: [{ ...estimated, nutritionSource: "usda_fdc:1" }],
        meals: planned([0, -1, -2]),
      }),
    ];
    for (const i of cases) expect(run(aiIngredient, i)).toEqual([]);
  });
});

describe("FBK-6 — more_often, less_often, never_again, observed frequency", () => {
  const tagged = (tags: string[], member: string = M.a, daysAgo = 2) =>
    review(member, "dish", shawarma.id, { tags, daysAgo });

  it("G1 more_often triggers after 2 signals in 30 days → household min_gap_days 3", () => {
    const d = assertTriggers(
      run(
        moreOrLessOften,
        input({
          dishes: [shawarma],
          reviews: [tagged(["more_often"]), tagged(["more_often"], M.b)],
        }),
      ),
      "frequency.set",
    );
    expect(d.ops[0]?.payload).toMatchObject({
      memberId: null,
      entityKey: shawarma.id,
      minGapDays: 3,
    });
  });

  it("G1 less_often triggers after 2 signals → min_gap_days 14", () => {
    const [d] = run(
      moreOrLessOften,
      input({ dishes: [shawarma], reviews: [tagged(["less_often"]), tagged(["less_often"])] }),
    );
    expect(d?.ops[0]?.payload).toMatchObject({ minGapDays: 14 });
  });

  it("G1 more_often/less_often do not trigger: one signal, signals older than 30 days, or both directions at once", () => {
    const cases = [
      [tagged(["more_often"])],
      [tagged(["less_often"], M.a, 31), tagged(["less_often"], M.b, 40)],
      [
        tagged(["more_often"]),
        tagged(["more_often"]),
        tagged(["less_often"]),
        tagged(["less_often"]),
      ],
    ];
    for (const reviews of cases)
      expect(run(moreOrLessOften, input({ dishes: [shawarma], reviews }))).toEqual([]);
  });

  it("G1 more_often/less_often keep an existing max-per-week cap and never override a locked rule", () => {
    const base = config();
    const rule = {
      id: "40000000-0000-4000-8000-000000000001",
      householdId: base.household.id,
      memberId: null,
      entityType: "dish" as const,
      entityKey: shawarma.id,
      minGapDays: 6,
      maxPerWeek: 2,
      source: "explicit" as const,
      locked: false,
    };
    const reviews = [tagged(["more_often"]), tagged(["more_often"])];
    const [d] = run(
      moreOrLessOften,
      input({ dishes: [shawarma], reviews, config: { ...base, frequencyRules: [rule] } }),
    );
    expect(d?.ops[0]?.payload).toMatchObject({ maxPerWeek: 2 });
    const locked = { ...base, frequencyRules: [{ ...rule, locked: true }] };
    expect(run(moreOrLessOften, input({ dishes: [shawarma], reviews, config: locked }))).toEqual(
      [],
    );
  });

  it("G1 never_again triggers on a single review → hard never for that member", () => {
    const d = assertTriggers(
      run(neverAgain, input({ dishes: [shawarma], reviews: [tagged(["never_again"], M.c2)] })),
      "preference.set",
    );
    expect(d.ops[0]?.payload).toMatchObject({
      memberId: M.c2,
      entityKey: shawarma.id,
      hard: "never",
      score: -1,
      locked: true,
    });
    expect(d.priority).toBe(5);
  });

  it("G1 never_again does not trigger without the tag, or for a dish the review does not resolve to", () => {
    expect(
      run(neverAgain, input({ dishes: [shawarma], reviews: [tagged(["less_often"])] })),
    ).toEqual([]);
    expect(run(neverAgain, input({ dishes: [], reviews: [tagged(["never_again"])] }))).toEqual([]);
  });

  it("G1 observed frequency triggers: served 3× in 7 days with a mean rating below 3 → min_gap_days 14", () => {
    const meals = [0, 2, 4].map((d) => meal(daysBefore(d), shawarma.id));
    const reviews = [
      review(M.a, "dish", shawarma.id, { rating: 2 }),
      review(M.b, "dish", shawarma.id, { rating: 3 }),
    ];
    const d = assertTriggers(
      run(observedFrequency, input({ dishes: [shawarma], meals, reviews })),
      "frequency.set",
    );
    expect(d.ops[0]?.payload).toMatchObject({ memberId: null, minGapDays: 14 });
    expect(d.evidence.metrics).toMatchObject({ servings: 3, meanRating: 2.5 });
  });

  it("G1 observed frequency does not trigger: served twice, rated ≥ 3, no ratings, or servings spread over more than 7 days", () => {
    const low = [review(M.a, "dish", shawarma.id, { rating: 2 })];
    const cases = [
      { meals: [0, 2].map((d) => meal(daysBefore(d), shawarma.id)), reviews: low },
      {
        meals: [0, 2, 4].map((d) => meal(daysBefore(d), shawarma.id)),
        reviews: [review(M.a, "dish", shawarma.id, { rating: 3 })],
      },
      { meals: [0, 2, 4].map((d) => meal(daysBefore(d), shawarma.id)), reviews: [] },
      { meals: [0, 4, 8].map((d) => meal(daysBefore(d), shawarma.id)), reviews: low },
    ];
    for (const c of cases)
      expect(run(observedFrequency, input({ dishes: [shawarma], ...c }))).toEqual([]);
  });
});

describe("FBK-5 — quantity feedback from targeted members", () => {
  it("G1 targeted quantity triggers: 2 too_little/still_hungry in 14 days → vegetable-role boost", () => {
    const reviews = [
      review(M.a, "dish", shawarma.id, { tags: ["still_hungry"] }),
      review(M.a, "dish", shawarma.id, { tags: ["too_little"], daysAgo: 5 }),
    ];
    const d = assertTriggers(
      run(targetedQuantity, input({ dishes: [shawarma], reviews })),
      "preference.set",
    );
    expect(d.ops[0]?.payload).toMatchObject({
      memberId: M.a,
      entityType: "component_role",
      entityKey: "vegetable",
      score: 0.5,
    });
  });

  it("G1 targeted quantity triggers: 2 too_much at one slot → share moves away from that slot", () => {
    const meals = [5, 2].map((d) => meal(daysBefore(d), shawarma.id, { slotTypeId: S.dinner }));
    const reviews = meals.map((m) => review(M.a, "plan_meal", m.id, { tags: ["too_much"] }));
    const d = assertTriggers(
      run(targetedQuantity, input({ dishes: [shawarma], meals, reviews })),
      "distribution.set",
    );
    expect(d.title).toContain("away");
  });

  it("G1 targeted quantity does not trigger: untargeted members (FBK-5 portion bias handles them), one signal, or older than 14 days", () => {
    const cases = [
      [0, 1].map(() => review(M.c1, "dish", shawarma.id, { tags: ["still_hungry"] })),
      [review(M.a, "dish", shawarma.id, { tags: ["still_hungry"] })],
      [15, 20].map((d) => review(M.a, "dish", shawarma.id, { tags: ["still_hungry"], daysAgo: d })),
    ];
    for (const reviews of cases)
      expect(run(targetedQuantity, input({ dishes: [shawarma], reviews }))).toEqual([]);
  });
});

describe("runRules", () => {
  it("G1 runRules runs every rule and every draft is registry-valid", () => {
    const meals = [6, 2, 0].map((d) =>
      meal(daysBefore(d), shawarma.id, {
        plates: [plate(M.a, { fitStatus: "infeasible", kcalDeviation: -150 })],
      }),
    );
    const reviews = [
      review(M.a, "dish", shawarma.id, { rating: 1 }),
      review(M.a, "dish", shawarma.id, { rating: 1, tags: ["never_again"] }),
      review(M.b, "dish", shawarma.id, { tags: ["less_often"] }),
      review(M.c1, "dish", shawarma.id, { tags: ["less_often"] }),
    ];
    const out = runRules(input({ dishes: [shawarma], meals, reviews }));
    const rules = new Set(out.candidates.map((c) => c.rule));
    expect(rules).toEqual(
      new Set(["dish_dislike", "never_again", "less_often", "observed_frequency", "plate_misses"]),
    );
    expectValidOps(out.candidates);
    expect(out.candidates.every((c) => c.origin === "rule")).toBe(true);
  });

  it("G1 an empty household produces nothing", () => {
    expect(runRules(input())).toEqual({ candidates: [], notes: [] });
  });

  it("G1 archived members get no proposals", () => {
    const base = config();
    const archived = {
      ...base,
      members: base.members.map((m) =>
        m.id === M.a ? { ...m, archivedAt: new Date("2026-09-01") } : m,
      ),
    };
    const reviews = [0, 1].map(() => review(M.a, "dish", shawarma.id, { rating: 1 }));
    expect(runRules(input({ config: archived, dishes: [shawarma], reviews })).candidates).toEqual(
      [],
    );
  });
});

describe("negative controls", () => {
  it("G1 negative control: the triggering assertion rejects each rule's non-triggering fixture", () => {
    const below = [review(M.a, "dish", shawarma.id, { rating: 1 })];
    expect(() =>
      assertTriggers(
        run(dishDislike, input({ dishes: [shawarma], reviews: below })),
        "preference.set",
      ),
    ).toThrow();
    const oneTag = [review(M.a, "dish", shawarma.id, { tags: ["less_often"] })];
    expect(() =>
      assertTriggers(
        run(moreOrLessOften, input({ dishes: [shawarma], reviews: oneTag })),
        "frequency.set",
      ),
    ).toThrow();
    const twoMisses = [5, 2].map((d) =>
      meal(daysBefore(d), shawarma.id, {
        plates: [plate(M.a, { fitStatus: "infeasible", kcalDeviation: -100 })],
      }),
    );
    expect(() =>
      assertTriggers(
        run(plateMisses, input({ dishes: [shawarma], meals: twoMisses })),
        "distribution.set",
      ),
    ).toThrow();
  });

  it("G1 negative control: a rule with the threshold lowered by one fires on the non-triggering fixture", () => {
    // The fixture is non-triggering only because of the threshold: with one review fewer needed,
    // the same reviews make a proposal. This proves the non-triggering tests test the threshold.
    const two = [1, 1].map((rating) => review(M.a, "variant", grilled.id, { rating }));
    const i = input({ dishes: [hammour], reviews: two });
    expect(run(variantDislike, i)).toEqual([]);
    const lowered = run(
      dishDislike,
      input({
        dishes: [hammour],
        reviews: two.map((r) => ({ ...r, targetType: "dish" as const, targetId: hammour.id })),
      }),
    );
    expect(lowered).toHaveLength(1);
  });
});
