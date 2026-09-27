// G3 (R2-ONB-6; leaf-1.4.7 SPEC-Q-8 … 10): the follow-up engine proposes only what the five
// answers leave open. The F1 answers are inferred with 1.4.3's `inferSetup` and applied with the
// real registry to an in-memory household; the engine reads the resulting configuration.
import { describe, expect, it } from "vitest";
import {
  inferSetup,
  parseNeverEat,
  parsePeople,
  parseTargets,
  type OnboardingAnswers,
} from "../../../src/onboarding/index.js";
import {
  checklist,
  followupOps,
  followupQueue,
  FollowupError,
  proposeFollowups,
  setupDay,
  type Followup,
  type FollowupConfig,
  type FollowupState,
} from "../../../src/onboarding/followups/index.js";
import { idFactory, MemoryTx, newHousehold } from "../memory-tx.js";
import { context, F1_CUISINES, F1_TEXT, F1_WEEK } from "../support.js";

type Text = { people: string; targets: Record<string, string>; neverEat: string };

function answersFrom(text: Text, week = F1_WEEK): OnboardingAnswers {
  const people = parsePeople(text.people);
  return {
    people,
    targets: Object.entries(text.targets).map(([person, raw]) => {
      const parsed = parseTargets(raw);
      if (!parsed.ok) throw new Error(`${person}: ${parsed.reason}`);
      return { person, numbers: parsed.value };
    }),
    week,
    cuisines: F1_CUISINES,
    neverEat: parseNeverEat(
      text.neverEat,
      people.map((p) => p.name),
    ),
  };
}

function configOf(tx: MemoryTx): FollowupConfig {
  return {
    members: tx.rows("member"),
    targetProfiles: tx.rows("target_profile"),
    slotTypes: tx.rows("slot_type"),
    memberSlotSchedules: tx.rows("member_slot_schedule"),
    trainingSchedules: tx.rows("training_schedule"),
    exclusions: tx.rows("exclusion"),
  };
}

async function household(text: Text = F1_TEXT, week = F1_WEEK) {
  const tx = new MemoryTx(idFactory(3));
  const slotIds = await newHousehold(tx);
  const setup = inferSetup(answersFrom(text, week), context(slotIds));
  await tx.applyAll(setup.changeOps);
  const id = (name: string) => {
    const m = setup.members.find((x) => x.name === name);
    if (m === undefined) throw new Error(`no member ${name}`);
    return m.id;
  };
  return { tx, id };
}

/** Differences between the expected and the proposed keys (empty: the lists are equal). */
function listProblems(expected: readonly string[], proposed: readonly Followup[]): string[] {
  const got = proposed.map((f) => f.key);
  const problems: string[] = [];
  for (const k of expected) if (!got.includes(k)) problems.push(`missing ${k}`);
  for (const k of got) if (!expected.includes(k)) problems.push(`unexpected ${k}`);
  if (problems.length === 0 && got.join() !== expected.join())
    problems.push(`order ${got.join(", ")}`);
  return problems;
}

const day = (d: string, hour = 9): Date => new Date(`${d}T${String(hour).padStart(2, "0")}:00:00Z`);
const state = (
  key: string,
  status: FollowupState["status"],
  on: string,
  hour = 9,
): FollowupState => ({
  key,
  status,
  choice: status === "answered" ? "yes" : null,
  resolvedOn: on,
  resolvedAt: day(on, hour),
});

describe("G3 follow-ups proposed from the F1 answers (R2-ONB-6)", () => {
  it("G3 F1's five answers leave exactly the nut-free school, dinner time and Adult B's training energy open", async () => {
    const { tx, id } = await household();
    const proposed = proposeFollowups(configOf(tx));
    expect(
      listProblems(["school_nut_free", "dinner_time", `training_kcal:${id("Adult B")}`], proposed),
    ).toEqual([]);
    const nut = proposed[0];
    expect(nut?.question).toBe("Is the school nut-free? I'll keep nuts out of the lunch boxes.");
    expect(proposed[1]?.question).toBe("Dinner at 19:30 — is that about right?");
    expect(proposed[2]?.question).toBe(
      "On training days, should Adult B's total calories go up, or stay the same?",
    );
    // Every follow-up is one tap: two to four choices.
    for (const f of proposed) expect(f.choices.length).toBeGreaterThanOrEqual(2);
    for (const f of proposed) expect(f.choices.length).toBeLessThanOrEqual(4);
  });

  it("G3 the questions do not depend on the order the rows are stored in", async () => {
    const { tx } = await household();
    const cfg = configOf(tx);
    const reversed = { ...cfg, members: [...cfg.members].reverse() };
    expect(proposeFollowups(reversed).map((f) => f.question)).toEqual(
      proposeFollowups(cfg).map((f) => f.question),
    );
  });

  it("G3 the viewer's own training question says your", async () => {
    const { tx, id } = await household();
    const [, , training] = proposeFollowups(configOf(tx), { viewerMemberId: id("Adult B") });
    expect(training?.question).toBe(
      "On training days, should your total calories go up, or stay the same?",
    );
  });

  it("G3 negative control: an item the answers already settle is never proposed", async () => {
    // Adult A's targets answer carries training-day numbers: the question is settled.
    const { tx, id } = await household();
    const keys = proposeFollowups(configOf(tx)).map((f) => f.key);
    expect(keys).not.toContain(`training_kcal:${id("Adult A")}`);
    // The list check itself reports a list that would ask it.
    const wrong: Followup[] = [
      ...proposeFollowups(configOf(tx)),
      { ...(proposeFollowups(configOf(tx))[2] as Followup), key: `training_kcal:${id("Adult A")}` },
    ];
    expect(
      listProblems(["school_nut_free", "dinner_time", `training_kcal:${id("Adult B")}`], wrong),
    ).toEqual([`unexpected training_kcal:${id("Adult A")}`]);

    // A never-eat answer that keeps nuts from everyone settles the school question.
    const nutFree = await household({
      ...F1_TEXT,
      neverEat: `${F1_TEXT.neverEat} No nuts for anyone.`,
    });
    expect(proposeFollowups(configOf(nutFree.tx)).map((f) => f.key)).not.toContain(
      "school_nut_free",
    );
    // Training-day numbers for Adult B settle theirs; no school answer, no school question.
    const both = await household(
      {
        ...F1_TEXT,
        targets: {
          ...F1_TEXT.targets,
          "Adult B": `${F1_TEXT.targets["Adult B"]}. Training days: 1800 / 130 / 200 / 55`,
        },
      },
      { ...F1_WEEK, school: null },
    );
    expect(proposeFollowups(configOf(both.tx)).map((f) => f.key)).toEqual(["dinner_time"]);
  });

  it("G3 a dinner time someone already set is settled", async () => {
    const { tx } = await household();
    const dinner = tx.rows("slot_type").find((s) => s.key === "dinner");
    if (dinner === undefined) throw new Error("no dinner");
    await tx.applyAll([
      { kind: "slot.update", payload: { slotTypeId: dinner.id, defaultTime: "20:15:00" } },
    ]);
    expect(proposeFollowups(configOf(tx)).map((f) => f.key)).not.toContain("dinner_time");
  });
});

describe("G3 answers change the configuration (R-34, R-36)", () => {
  it("G3 yes, nut-free adds a contains_nuts exclusion for each school child; then it is settled", async () => {
    const { tx, id } = await household();
    const cfg = configOf(tx);
    const nut = proposeFollowups(cfg)[0] as Followup;
    const { ops } = followupOps(nut, "yes", cfg);
    expect(ops).toEqual(
      ["Child C1", "Child C2", "Child C3"].map((n) => ({
        kind: "exclusion.add",
        payload: {
          memberId: id(n),
          kind: "dietary_flag",
          key: "contains_nuts",
          reason: "other",
          hard: true,
          // OQ-9 (R-62): lunch boxes only.
          slotKeys: ["packed_school_lunch"],
        },
      })),
    );
    await tx.applyAll(ops);
    const rows = tx.rows("exclusion").filter((e) => e.key === "contains_nuts");
    expect(rows.map((e) => e.slotKeys)).toEqual([
      ["packed_school_lunch"],
      ["packed_school_lunch"],
      ["packed_school_lunch"],
    ]);
    expect(proposeFollowups(configOf(tx)).map((f) => f.key)).not.toContain("school_nut_free");
    expect(followupOps(nut, "no", cfg).ops).toEqual([]);
  });

  it("G4 settled only once every school child's lunch box is nut-free (OQ-9)", async () => {
    const { tx, id } = await household();
    const nutRule = (memberId: string, slotKeys: string[] | null) => ({
      kind: "exclusion.add" as const,
      payload: {
        memberId,
        kind: "dietary_flag" as const,
        key: "contains_nuts",
        reason: "other" as const,
        slotKeys,
      },
    });
    const open = () => proposeFollowups(configOf(tx)).some((f) => f.key === "school_nut_free");
    // Nuts kept out of one child's snacks only: that lunch box is not covered.
    await tx.applyAll([nutRule(id("Child C1"), ["snack"])]);
    expect(open()).toBe(true);
    // C1's lunch box (scoped) and C2 everywhere (unscoped) are covered; C3 is still open.
    await tx.applyAll([nutRule(id("Child C1"), ["packed_school_lunch"])]);
    await tx.applyAll([nutRule(id("Child C2"), null)]);
    expect(open()).toBe(true);
    const cfg = configOf(tx);
    const nut = proposeFollowups(cfg)[0] as Followup;
    const { ops, summary } = followupOps(nut, "yes", cfg);
    expect(ops).toEqual(
      [nutRule(id("Child C3"), ["packed_school_lunch"])].map((o) => ({
        ...o,
        payload: { ...o.payload, hard: true },
      })),
    );
    expect(summary).toBe("Nut-free school: no nuts in the lunch boxes");
    await tx.applyAll(ops);
    expect(open()).toBe(false);
  });

  it("G3 a dinner time choice updates the dinner slot; yes changes nothing", async () => {
    const { tx } = await household();
    const cfg = configOf(tx);
    const dinner = proposeFollowups(cfg)[1] as Followup;
    expect(dinner.choices.map((c) => c.label)).toEqual(["Yes, 19:30", "19:00", "20:00", "20:30"]);
    expect(followupOps(dinner, "yes", cfg).ops).toEqual([]);
    const { ops } = followupOps(dinner, "20:00", cfg);
    await tx.applyAll(ops);
    expect(tx.rows("slot_type").find((s) => s.key === "dinner")?.defaultTime).toBe("20:00:00");
  });

  it("G3 training energy invents no numbers: both choices change nothing, go up links to the numbers", async () => {
    const { tx, id } = await household();
    const cfg = configOf(tx);
    const training = proposeFollowups(cfg)[2] as Followup;
    expect(followupOps(training, "up", cfg).ops).toEqual([]);
    expect(followupOps(training, "same", cfg).ops).toEqual([]);
    expect(training.choices.find((c) => c.id === "up")?.then?.href).toBe(
      `/family/${id("Adult B")}#training`,
    );
  });

  it("G3 a choice the follow-up does not offer is refused", async () => {
    const { tx } = await household();
    const cfg = configOf(tx);
    expect(() => followupOps(proposeFollowups(cfg)[1] as Followup, "23:00", cfg)).toThrow(
      FollowupError,
    );
  });
});

describe("G3 one card per day, dismissals (SPEC-Q-9)", () => {
  it("G3 the first open follow-up is today's card; the others are coming up", async () => {
    const { tx } = await household();
    const proposed = proposeFollowups(configOf(tx));
    const q = followupQueue(proposed, [], "2026-10-05");
    expect(q.card?.key).toBe("school_nut_free");
    expect([q.position, q.total]).toEqual([1, 3]);
    expect(q.upcoming.map((f) => f.key)).toEqual(proposed.slice(1).map((f) => f.key));
  });

  it("G3 after an answer or a dismissal today there is no card until tomorrow", async () => {
    const { tx } = await household();
    const proposed = proposeFollowups(configOf(tx));
    const answered = [state("school_nut_free", "answered", "2026-10-05")];
    expect(followupQueue(proposed, answered, "2026-10-05").card).toBeNull();
    const tomorrow = followupQueue(proposed, answered, "2026-10-06");
    expect(tomorrow.card?.key).toBe("dinner_time");
    expect([tomorrow.position, tomorrow.total]).toEqual([2, 3]);
    const dismissed = [state("school_nut_free", "dismissed", "2026-10-05")];
    expect(followupQueue(proposed, dismissed, "2026-10-05").card).toBeNull();
  });

  it("G3 a dismissed follow-up comes back after the ones never offered, oldest dismissal first", async () => {
    const { tx } = await household();
    const proposed = proposeFollowups(configOf(tx));
    const keys = proposed.map((f) => f.key);
    const states = [
      state(keys[0] as string, "dismissed", "2026-10-05"),
      state(keys[1] as string, "dismissed", "2026-10-06"),
    ];
    const d7 = followupQueue(proposed, states, "2026-10-07");
    expect(d7.card?.key).toBe(keys[2]);
    expect(d7.upcoming.map((f) => f.key)).toEqual([keys[0], keys[1]]);
    const d8 = followupQueue(
      proposed,
      [...states, state(keys[2] as string, "answered", "2026-10-07")],
      "2026-10-08",
    );
    expect(d8.card?.key).toBe(keys[0]);
  });

  it("G3 answered follow-ups the answer settled still count; all answered leaves no card", async () => {
    const { tx } = await household();
    const all = proposeFollowups(configOf(tx));
    // Once "yes, nut-free" is applied, the configuration no longer proposes it.
    const remaining = all.slice(1);
    const q = followupQueue(
      remaining,
      [state("school_nut_free", "answered", "2026-10-05")],
      "2026-10-06",
    );
    expect([q.position, q.total, q.answered]).toEqual([2, 3, 1]);
    const done = followupQueue(
      [],
      all.map((f, i) => state(f.key, "answered", `2026-10-0${String(5 + i)}`)),
      "2026-10-09",
    );
    expect(done.card).toBeNull();
    expect([done.answered, done.total]).toEqual([3, 3]);
  });
});

describe("G3 the Getting set up checklist", () => {
  const facts = {
    activeMembers: 5,
    planDays: 1,
    kitchenInvited: true,
    reviews: 0,
    familyInvited: false,
  };

  it("G3 the checklist counts progress as FirstDaysPhone shows it (3 / 6)", () => {
    const c = checklist(facts, { answered: 0, total: 3 });
    expect(c.items.map((i) => [i.label, i.done])).toEqual([
      ["Family added", true],
      ["First plan made", true],
      ["Kitchen invited", true],
      ["Rate your first 3 meals (takes 2 taps each)", false],
      ["Invite the family", false],
      ["Answer 3 optional questions", false],
    ]);
    expect([c.done, c.total]).toEqual([3, 6]);
  });

  it("G3 the checklist follows the data: ratings, invites and answers", () => {
    const c = checklist({ ...facts, reviews: 3, familyInvited: true }, { answered: 3, total: 3 });
    expect([c.done, c.total]).toEqual([6, 6]);
    expect(checklist({ ...facts, reviews: 2 }, { answered: 2, total: 3 }).done).toBe(3);
    // Nothing to ask: the questions item is left out.
    expect(checklist(facts, { answered: 0, total: 0 }).total).toBe(5);
    expect(checklist(facts, { answered: 0, total: 1 }).items.at(-1)?.label).toBe(
      "Answer 1 optional question",
    );
  });

  it("G3 day N counts from the household's first day", () => {
    expect(setupDay("2026-10-04", "2026-10-04")).toBe(1);
    expect(setupDay("2026-10-04", "2026-10-05")).toBe(2);
    expect(setupDay("2026-10-31", "2026-11-02")).toBe(3);
  });
});
