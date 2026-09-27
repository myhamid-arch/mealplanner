// leaf-1.4.9 G1/G2 (W-9): the event builders. The digest lists the changes made automatically
// (FBK-5 portion moves) with titles from the moves; a plan no agent turn started becomes the
// ChatPhoneDigest row. Existing callers (no new arguments) get what they got before.
import { describe, expect, it } from "vitest";
import {
  automaticChangeTitle,
  digestHasNews,
  insightDigestEvent,
  jobCompletionEvent,
  planReady,
  type AutomaticChangeLike,
  type InsightDigestLike,
  type PlanReadyLike,
} from "../../src/agent/events.js";

const EMPTY: InsightDigestLike = {
  runAt: "2026-09-28T06:30:00.000Z",
  stored: [],
  dropped: [],
  notes: [],
};

const ZAYD: AutomaticChangeLike = {
  changeSetId: "cs-1",
  summary: "Learned from Zayd's review of Chicken and rice",
  appliedAt: new Date("2026-09-27T19:40:00.000Z"),
  undone: false,
  moves: [{ memberName: "Zayd", role: "carb", before: 1, after: 0.9 }],
};

function cardsOf(content: unknown): Record<string, unknown>[] {
  return (content as { cards: Record<string, unknown>[] }).cards;
}

describe("automaticChangeTitle (SPEC-Q-2)", () => {
  it("names the member, the role and the change", () => {
    expect(automaticChangeTitle(ZAYD)).toBe("Zayd's carb portion is 10% smaller");
  });
  it("groups roles that moved together, and says larger", () => {
    expect(
      automaticChangeTitle({
        ...ZAYD,
        moves: [
          { memberName: "Adam", role: "carb", before: 0.9, after: 0.99 },
          { memberName: "Adam", role: "protein", before: 1, after: 1.1 },
        ],
      }),
    ).toBe("Adam's carb and protein portions are 10% larger");
  });
  it("falls back to the summary when no move can be read", () => {
    expect(automaticChangeTitle({ ...ZAYD, moves: [] })).toBe(ZAYD.summary);
    expect(
      automaticChangeTitle({
        ...ZAYD,
        moves: [{ memberName: "Zayd", role: "carb", before: 0, after: 0.9 }],
      }),
    ).toBe(ZAYD.summary);
  });
});

describe("insightDigestEvent with automatic changes (W-9a)", () => {
  it("adds the automatic list and mentions it", () => {
    const content = insightDigestEvent(EMPTY, [
      ZAYD,
      { ...ZAYD, changeSetId: "cs-2", undone: true },
    ]);
    const [card] = cardsOf(content);
    expect(card?.automatic).toEqual([
      {
        changeSetId: "cs-1",
        title: "Zayd's carb portion is 10% smaller",
        detail: ZAYD.summary,
        appliedAt: "2026-09-27T19:40:00.000Z",
        undone: false,
      },
      {
        changeSetId: "cs-2",
        title: "Zayd's carb portion is 10% smaller",
        detail: ZAYD.summary,
        appliedAt: "2026-09-27T19:40:00.000Z",
        undone: true,
      },
    ]);
    expect((content as { text: string }).text).toBe(
      "I looked at the latest reviews. 2 changes were made automatically; you can undo them.",
    );
  });
  it("without automatic changes the card is as before (no field)", () => {
    const [card] = cardsOf(insightDigestEvent(EMPTY));
    expect(card).not.toHaveProperty("automatic");
    expect(Object.keys(card ?? {}).sort()).toEqual(
      ["dropped", "notes", "proposals", "runAt", "type"].sort(),
    );
  });
  it("a digest with only automatic changes is news", () => {
    expect(digestHasNews(EMPTY)).toBe(false);
    expect(digestHasNews(EMPTY, [ZAYD])).toBe(true);
  });
});

const WEEK: PlanReadyLike = {
  dates: ["2026-09-28", "2026-09-29"],
  meals: [
    {
      slotLabel: "Dinner",
      isPacked: false,
      isTraining: false,
      attendees: ["Omar", "Sara"],
      targeted: true,
      offTarget: false,
    },
    {
      // One shared lunch for three children: three lunch boxes.
      slotLabel: "Packed school lunch",
      isPacked: true,
      isTraining: false,
      attendees: ["Layla", "Adam", "Zayd"],
      targeted: false,
      offTarget: false,
    },
    {
      slotLabel: "Post-workout",
      isPacked: false,
      isTraining: true,
      attendees: ["Omar"],
      targeted: true,
      offTarget: false,
    },
  ],
};

describe("planReady (W-9b, SPEC-Q-5)", () => {
  it("builds the ChatPhoneDigest row", () => {
    expect(planReady({ ...WEEK, dates: ["2026-09-28"] })).toEqual({
      title: "Monday's plan is ready",
      facts: [
        "All meals on target",
        "3 packed school lunches",
        "Omar's training-day meals included",
      ],
      href: "/plan?week=2026-09-28",
      action: "Look, then send to kitchen",
    });
  });
  it("several days, meals off target, no targeted plates", () => {
    const off = planReady({
      ...WEEK,
      meals: WEEK.meals.map((m, i) => (i === 0 ? { ...m, offTarget: true } : m)),
    });
    expect(off.title).toBe("The plan from Monday to Tuesday is ready");
    expect(off.facts[0]).toBe("1 meal off target");
    const kids = planReady({
      dates: ["2026-10-04"],
      meals: WEEK.meals.slice(1, 2).map((m) => ({ ...m, attendees: ["Zayd"] })),
    });
    expect(kids).toMatchObject({
      title: "Sunday's plan is ready",
      facts: ["1 packed school lunch"],
    });
  });
});

describe("jobCompletionEvent", () => {
  const job = { id: "job-1", kind: "plan.generate", status: "succeeded" as const, result: {} };
  it("with a plan: one job_progress card with `ready`, no text", () => {
    const content = jobCompletionEvent(job, WEEK) as { text: string; cards: unknown[] };
    expect(content.text).toBe("");
    expect(content.cards).toEqual([
      {
        type: "job_progress",
        jobId: "job-1",
        kind: "plan.generate",
        status: "succeeded",
        ready: planReady(WEEK),
      },
    ]);
  });
  it("without a plan: unchanged (the agent-started completion)", () => {
    expect(jobCompletionEvent(job)).toEqual({
      text: "The plan is ready.",
      cards: [{ type: "job_progress", jobId: "job-1", kind: "plan.generate", status: "succeeded" }],
    });
  });
});

describe('jobCompletionEvent: recipe drafts (R-61 "Use for")', () => {
  const job = {
    id: "job-2",
    kind: "recipe.draft",
    status: "succeeded" as const,
    result: { dishes: [], rejected: [] },
  };
  it("carries the requested day and slot on the recipe card", () => {
    const use = { date: "2026-09-30", slotKey: "dinner", slotLabel: "Dinner" };
    const content = jobCompletionEvent({ ...job, use }) as { cards: Record<string, unknown>[] };
    expect(content.cards[1]).toEqual({
      type: "recipe",
      jobId: "job-2",
      dishes: [],
      rejected: [],
      use,
    });
  });
  it("without them the recipe card is as before", () => {
    const content = jobCompletionEvent(job) as { cards: Record<string, unknown>[] };
    expect(content.cards[1]).toEqual({ type: "recipe", jobId: "job-2", dishes: [], rejected: [] });
  });
});
