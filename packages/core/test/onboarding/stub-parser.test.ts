// G4 (R2-ONB-3): free text parsed by the model (stubbed here) feeds the same inference, and the
// deterministic part (flag expansion, ops) never depends on it. Also: skipping (R2-ONB-2) and the
// explanations' Adjust targets (SC-7).
import { describe, expect, it } from "vitest";
import {
  inferSetup,
  parseNeverEat,
  parsePeople,
  type FreeTextParser,
  type OnboardingAnswers,
} from "../../src/onboarding/index.js";
import { idFactory, MemoryTx, newHousehold } from "./memory-tx.js";
import { context, snapshot } from "./support.js";

/** A recorded structured-output parse, as the model would return it. */
const stub: FreeTextParser = {
  people: () => Promise.resolve([{ name: "Zayd", age: 10, sex: "male" }]),
  targets: () => Promise.resolve({ ok: false, reason: "not used" }),
  neverEat: () => Promise.resolve([{ who: "Zayd", term: "sesame", reason: "allergy" }]),
};

async function apply(answers: OnboardingAnswers) {
  const tx = new MemoryTx(idFactory(4));
  const slotIds = await newHousehold(tx);
  const setup = inferSetup(answers, context(slotIds, { newId: idFactory(9) }));
  await tx.applyAll(setup.changeOps);
  return { setup, snap: snapshot(tx) };
}

describe("G4 free-text parse is stubbed", () => {
  it("G4 a model parse of text the rules cannot read gives the same configuration as the rules", async () => {
    const hard = "the little one reacts badly to anything with simsim in it";
    const viaModel: OnboardingAnswers = {
      people: await stub.people("our youngest, ten"),
      targets: null,
      week: null,
      cuisines: null,
      neverEat: await stub.neverEat(hard, ["Zayd"]),
    };
    const viaRules: OnboardingAnswers = {
      ...viaModel,
      people: parsePeople("Zayd 10 M"),
      neverEat: parseNeverEat("Zayd is allergic to sesame", ["Zayd"]),
    };
    const a = await apply(viaModel);
    const b = await apply(viaRules);
    expect(a.snap).toEqual(b.snap);
    expect(a.setup.coverage).toEqual(b.setup.coverage);
    // The rules alone do not understand the sentence; the model's term is expanded by the catalogue.
    expect(parseNeverEat(hard, ["Zayd"]).some((i) => i.term === "sesame")).toBe(false);
  });

  it("G4 the model cannot widen or narrow an expansion: slugs come from the catalogue flags", async () => {
    const { setup } = await apply({
      people: [{ name: "Zayd", age: 10, sex: null }],
      targets: null,
      week: null,
      cuisines: null,
      neverEat: [{ who: "Zayd", term: "Sesame", reason: "allergy" }],
    });
    expect(setup.changeOps.filter((o) => o.kind === "exclusion.add")).toEqual([
      {
        kind: "exclusion.add",
        payload: {
          memberId: setup.members[0]?.id,
          kind: "dietary_flag",
          key: "contains_sesame",
          reason: "allergy",
          hard: true,
        },
      },
    ]);
  });
});

describe("R2-ONB-2 skipping and SC-7 explanations", () => {
  it("every question skipped still gives a plannable household and one explanation per answer", async () => {
    const { setup, snap } = await apply({
      people: null,
      targets: null,
      week: null,
      cuisines: null,
      neverEat: null,
    });
    expect(Object.keys(snap.members)).toEqual(["Adult A"]);
    expect(snap.members["Adult A"]).toMatchObject({
      isTargeted: false,
      appetite: "medium",
      birthYear: null,
    });
    expect(snap.exclusions).toEqual([]);
    expect(new Set(setup.explanations.map((e) => e.answer))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("every explanation links to a screen of this leaf, member links name a created member", async () => {
    const { setup } = await apply({
      people: parsePeople("Omar 41, Sara 39, Layla 18, Adam 15, Zayd 10"),
      targets: [
        { person: "Omar", numbers: { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70 } },
        { person: "Sara", numbers: { kcal: 1655, proteinG: 130, carbsG: 160, fatG: 55 } },
      ],
      week: {
        school: { people: ["Layla", "Adam", "Zayd"], weekdays: [0, 1, 2, 3, 4] },
        work: { people: ["Omar"], weekdays: [0, 1, 2, 3, 4] },
        training: [{ person: "Omar", weekdays: [0, 2, 4], time: "evening" }],
        snacks: true,
      },
      cuisines: ["levantine", "italian"],
      neverEat: parseNeverEat("Zayd is allergic to sesame.", [
        "Omar",
        "Sara",
        "Layla",
        "Adam",
        "Zayd",
      ]),
    });
    const ids = new Set(setup.members.map((m) => m.id));
    for (const e of setup.explanations) {
      expect(e.href).toMatch(
        /^\/(family(\/[0-9a-f-]{36}#(profile|targets|meals|training|never-serve)|\/tastes#(cuisines|never-serve))?|settings\/schedule\?slot=[a-z_]+)$/,
      );
      if (e.adjust.screen === "member") expect(ids.has(e.adjust.memberId)).toBe(true);
    }
    expect(setup.explanations.map((e) => e.text)).toContain(
      "Saturated fat capped at 14 g for Omar (6 % of calories) and 11 g for Sara (6 % of calories).",
    );
    expect(setup.explanations.some((e) => /more carbs/i.test(e.text))).toBe(false); // SPEC-Q-3
  });

  it("an answer naming someone not in question 1 is refused", () => {
    expect(() =>
      inferSetup(
        {
          people: [{ name: "Omar", age: 41, sex: null }],
          targets: [{ person: "Nadia", numbers: { kcal: 2000, proteinG: 1, carbsG: 1, fatG: 1 } }],
          week: null,
          cuisines: null,
          neverEat: null,
        },
        context({}, { slots: [] }),
      ),
    ).toThrow(/Nadia/);
  });
});
