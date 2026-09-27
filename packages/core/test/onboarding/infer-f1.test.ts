// G4 (R2-ONB-3): the F1 answers produce exactly the F1 configuration. Inferred ops are applied with
// the real registry to a household as sign-up leaves it and compared with F1 applied the way
// loadFixture applies it. Three fields differ by rule (leaf-1.4.3 SPEC-Q-2, R-47) and are asserted
// against their R2 values instead.
import { describe, expect, it } from "vitest";
import {
  inferSetup,
  MEMBER_COLOR_ORDER,
  parseNeverEat,
  parsePeople,
  parseTargets,
  type OnboardingAnswers,
} from "../../src/onboarding/index.js";
import { idFactory, MemoryTx, newHousehold } from "./memory-tx.js";
import {
  context,
  diffSnapshots,
  f1Snapshot,
  F1_CUISINES,
  F1_TEXT,
  F1_WEEK,
  snapshot,
  type Snapshot,
} from "./support.js";

function answersFrom(
  text: typeof F1_TEXT | { people: string; targets: Record<string, string>; neverEat: string },
) {
  const people = parsePeople(text.people);
  const targets = Object.entries(text.targets).map(([person, raw]) => {
    const parsed = parseTargets(raw);
    if (!parsed.ok) throw new Error(`${person}: ${parsed.reason}`);
    return { person, numbers: parsed.value };
  });
  const answers: OnboardingAnswers = {
    people,
    targets,
    week: F1_WEEK,
    cuisines: F1_CUISINES,
    neverEat: parseNeverEat(
      text.neverEat,
      people.map((p) => p.name),
    ),
  };
  return answers;
}

async function inferred(answers: OnboardingAnswers): Promise<{ snap: Snapshot; tx: MemoryTx }> {
  const tx = new MemoryTx(idFactory(2));
  const slotIds = await newHousehold(tx);
  const setup = inferSetup(answers, context(slotIds));
  await tx.applyAll(setup.changeOps);
  return { snap: snapshot(tx), tx };
}

/** Removes the three fields R2 sets differently from F1 (SPEC-Q-2). */
function withoutRuleFields(s: Snapshot): Snapshot {
  const members = Object.fromEntries(
    Object.entries(s.members).map(([name, m]) => {
      const { appetite, ...rest } = Object.fromEntries(
        Object.entries(m).filter(([k]) => k !== "color"),
      );
      return [name, m.isTargeted === true ? rest : { ...rest, appetite }];
    }),
  );
  const slots = Object.fromEntries(
    Object.entries(s.slots).map(([key, slot]) => {
      if (key !== "packed_work_lunch") return [key, slot];
      return [key, Object.fromEntries(Object.entries(slot).filter(([k]) => k !== "isShared"))];
    }),
  );
  return { ...s, members, slots };
}

describe("G4 inferSetup golden: F1", () => {
  it("G4 the F1 answers produce exactly the F1 configuration (SPEC-Q-2 fields apart)", async () => {
    const expected = await f1Snapshot();
    const { snap } = await inferred(answersFrom(F1_TEXT));
    expect(diffSnapshots(withoutRuleFields(expected), withoutRuleFields(snap))).toEqual([]);
    // Sanity: the comparison covers the whole configuration.
    expect(Object.keys(snap.members)).toHaveLength(5);
    expect(snap.targets).toHaveLength(3);
    expect(snap.schedules.length).toBeGreaterThan(40);
    expect(snap.exclusions).toHaveLength(1);
    expect(snap.preferences).toHaveLength(5);
    expect(snap.distributions).toBe(0);
    expect(snap.slotTargets).toBe(0);
  });

  it("G4 the three rule fields take their R2 values (SPEC-Q-2)", async () => {
    const { snap } = await inferred(answersFrom(F1_TEXT));
    const names = ["Adult A", "Adult B", "Child C1", "Child C2", "Child C3"];
    names.forEach((name, i) => {
      expect(snap.members[name]?.color).toBe(MEMBER_COLOR_ORDER[i]);
    });
    // R2-ONB-3: appetite from age (≥ 14 large), also for targeted adults.
    expect(snap.members["Adult A"]?.appetite).toBe("large");
    expect(snap.members["Adult B"]?.appetite).toBe("large");
    // R2-ONB-3: packed work lunch is individual, with reheat.
    expect(snap.slots.packed_work_lunch?.isShared).toBe(false);
    expect(snap.slots.packed_work_lunch?.reheatAvailable).toBe(true);
    // The school lunch stays shared and cold.
    expect(snap.slots.packed_school_lunch?.isShared).toBe(true);
    expect(snap.slots.packed_school_lunch?.reheatAvailable).toBe(false);
  });

  it("G4 kids get no macro targets and adults' targets are what was typed", async () => {
    const { snap } = await inferred(answersFrom(F1_TEXT));
    for (const child of ["Child C1", "Child C2", "Child C3"])
      expect(snap.members[child]?.isTargeted).toBe(false);
    expect(snap.targets.filter((t) => t.includes('"Child'))).toEqual([]);
  });

  it("G4 negative control: one changed answer is reported as a difference", async () => {
    const expected = withoutRuleFields(await f1Snapshot());
    const olderChild = await inferred(
      answersFrom({ ...F1_TEXT, people: F1_TEXT.people.replace("Child C1 18 F", "Child C1 17 F") }),
    );
    const older = diffSnapshots(expected, withoutRuleFields(olderChild.snap));
    expect(older).toHaveLength(1);
    expect(older[0]).toMatch(
      /^members\.Child C1: expected .*"birthYear":2008.*got .*"birthYear":2009/,
    );
    const noAllergy = await inferred(answersFrom({ ...F1_TEXT, neverEat: "" }));
    expect(diffSnapshots(expected, withoutRuleFields(noAllergy.snap)).length).toBeGreaterThan(0);
    const wrongCarbs = await inferred(
      answersFrom({
        ...F1_TEXT,
        targets: { ...F1_TEXT.targets, "Adult B": "1655 / 130 / 165 / 55, sat fat max 18 g" },
      }),
    );
    expect(diffSnapshots(expected, withoutRuleFields(wrongCarbs.snap)).length).toBeGreaterThan(0);
  });
});
