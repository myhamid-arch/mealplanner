// AGT-7 card payloads: every type parses from the shape its producer writes; anything else is
// reported as unreadable (drawn as "can't be shown"), never thrown.
import { describe, expect, it } from "vitest";
import { macroRow, parseCard } from "../../components/chat/cards/parse";
import type { DraftDish } from "../../components/chat/cards/parse";
import { draftDishId, remapOps } from "../../components/chat/cards/recipe-card";

const DESC = [{ kind: "preference.set", area: "taste", title: "t", changes: [] }];
const MEAL = {
  id: "0192f1c2-7a3b-7c4d-8e5f-000000000001",
  date: "2026-09-27",
  slotTypeId: "0192f1c2-7a3b-7c4d-8e5f-000000000002",
  slotKey: "dinner",
  slotLabel: "Dinner",
  time: "19:00:00",
  kind: "shared",
  memberScope: "shared",
  attendees: [],
  splitMembers: [],
  dishId: "0192f1c2-7a3b-7c4d-8e5f-000000000003",
  dishName: "Pulao",
  dishVersion: 1,
  locked: false,
  status: "planned",
  scoreBreakdown: null,
  plates: [],
};
const OPS: DraftDish["ops"] = [
  { kind: "ingredient.create", payload: { id: "i-new", slug: "labneh_balls" } },
  {
    kind: "dish.create",
    payload: {
      id: "d-new",
      components: [{ variants: [{ ingredients: [{ ingredientId: "i-new" }] }] }],
    },
  },
];
const DRAFT = {
  ops: OPS,
  summary: "Add AI recipe",
  dish: {
    name: "N",
    description: "",
    cuisine: "levantine",
    slotKeys: ["dinner"],
    components: [
      {
        name: "C",
        role: "protein",
        variants: [{ method: "grilled", label: "Grilled", cookTimeMin: 10 }],
      },
    ],
  },
  newIngredients: [{ slug: "labneh-balls", name: "Labneh balls" }],
  candidate: true,
  reasons: [],
  plates: [{ label: "Member 1", member: "Omar", status: "in_tolerance", explain: ["x"] }],
};

const VALID = [
  {
    type: "proposal",
    proposalId: "p",
    title: "t",
    rationale: "r",
    descriptions: DESC,
    evidence: { reviewIds: [], count: 0 },
    status: "pending",
  },
  {
    type: "applied_change",
    changeSetId: "c",
    summary: "s",
    descriptions: DESC,
    appliedAt: "2026-09-27T09:00:00Z",
  },
  { type: "plan_day", date: "2026-09-27", meals: [MEAL] },
  { type: "recipe", jobId: "j", dishes: [DRAFT], rejected: [] },
  { type: "macro_table", date: "2026-09-27", rows: [] },
  { type: "job_progress", jobId: "j", kind: "plan.generate", status: "running" },
  { type: "insight_digest", runAt: "2026-09-27T06:30:00Z", proposals: [], dropped: [], notes: [] },
  { type: "iteration_limit", limit: 12, ran: [], notRun: [] },
];

describe("parseCard", () => {
  it("parses one card of every AGT-7 type", () => {
    const types = VALID.map((c) => {
      const p = parseCard(c);
      return p.ok ? p.card.type : `bad:${p.type}`;
    });
    expect(types).toEqual(VALID.map((c) => c.type));
  });

  it("reports an unknown type and a malformed card as unreadable, with their type", () => {
    expect(parseCard({ type: "weather" })).toEqual({ ok: false, type: "weather" });
    expect(parseCard({ type: "proposal", title: 5 })).toEqual({ ok: false, type: "proposal" });
    expect(parseCard(null)).toEqual({ ok: false, type: "unknown" });
    expect(parseCard({ ...VALID[3], dishes: [{ ...DRAFT, ops: [] }] })).toEqual({
      ok: false,
      type: "recipe",
    });
  });

  it("reads SPEC-Q-4 macro rows, and nothing else as one", () => {
    expect(macroRow({ member: "Omar", slot: "Lunch", target: null, actual: null })).toEqual({
      member: "Omar",
      slot: "Lunch",
      target: null,
      actual: null,
    });
    expect(macroRow({ who: "x" })).toBeNull();
  });
});

describe("recipe drafts (R-53)", () => {
  it("finds the new dish's id in its ops", () => {
    expect(draftDishId(DRAFT.ops)).toBe("d-new");
    expect(draftDishId([])).toBeNull();
  });

  it("reuses an ingredient an earlier draft of the card already created", () => {
    expect(remapOps(DRAFT.ops, new Map())).toEqual(DRAFT.ops);
    const out = remapOps(DRAFT.ops, new Map([["labneh_balls", "i-saved"]]));
    expect(out.map((o) => o.kind)).toEqual(["dish.create"]);
    expect(JSON.stringify(out)).toContain('"ingredientId":"i-saved"');
    expect(JSON.stringify(out)).not.toContain("i-new");
  });
});
