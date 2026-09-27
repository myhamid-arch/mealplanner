// G4 (R2-ONB-3): allergens expand through the catalogue's dietary_flags (sesame → tahini, hummus,
// za'atar and every ingredient flagged contains_sesame); religious rules are household-level hard
// exclusions; foods are written as ingredient slugs (R-36); dislikes still filter (R-34).
import { describe, expect, it } from "vitest";
import {
  inferSetup,
  parseNeverEat,
  resolveTerm,
  type OnboardingAnswers,
} from "../../src/onboarding/index.js";
import { idFactory, MemoryTx, newHousehold } from "./memory-tx.js";
import { catalogueIngredients, context, snapshot } from "./support.js";

const MOCKUP_NEVER_EAT =
  "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.";
const PEOPLE = ["Omar", "Sara", "Layla", "Adam", "Zayd"];

function answers(neverEat: OnboardingAnswers["neverEat"]): OnboardingAnswers {
  return {
    people: PEOPLE.map((name, i) => ({ name, age: [41, 39, 18, 15, 10][i] ?? null, sex: null })),
    targets: null,
    week: null,
    cuisines: null,
    neverEat,
  };
}

describe("G4 sesame expands via dietary flags", () => {
  it("G4 sesame resolves to the contains_sesame flag, covering tahini, hummus and za'atar", () => {
    const ingredients = catalogueIngredients();
    const r = resolveTerm("sesame", ingredients);
    expect(r.kind).toBe("dietary_flag");
    if (r.kind !== "dietary_flag") return;
    expect(r.flag).toBe("contains_sesame");
    expect(r.slugs).toEqual(expect.arrayContaining(["tahini", "hummus", "zaatar"]));
    // Exactly the flagged catalogue rows, computed from the data, not a fixed list.
    const flagged = ingredients
      .filter((i) => i.dietaryFlags.includes("contains_sesame"))
      .map((i) => i.slug);
    expect(r.slugs).toEqual(flagged);
  });

  it("G4 negative control: without the flag on tahini the expansion no longer covers it", () => {
    const ingredients = catalogueIngredients().map((i) =>
      i.slug === "tahini"
        ? { ...i, dietaryFlags: i.dietaryFlags.filter((f) => f !== "contains_sesame") }
        : i,
    );
    const r = resolveTerm("sesame", ingredients);
    expect(r.kind === "dietary_flag" && r.slugs.includes("tahini")).toBe(false);
  });

  it("G4 the mockup's never-eat answer becomes the exclusions R2-ONB-3 describes", async () => {
    const tx = new MemoryTx(idFactory(3));
    const slotIds = await newHousehold(tx);
    const setup = inferSetup(answers(parseNeverEat(MOCKUP_NEVER_EAT, PEOPLE)), context(slotIds));
    await tx.applyAll(setup.changeOps);
    const snap = snapshot(tx);
    expect(snap.exclusions).toEqual(
      [
        {
          member: "*",
          kind: "dietary_flag",
          key: "contains_alcohol",
          reason: "religious",
          hard: true,
        },
        {
          member: "*",
          kind: "dietary_flag",
          key: "contains_pork",
          reason: "religious",
          hard: true,
        },
        { member: "Sara", kind: "ingredient", key: "beef-liver", reason: "dislike", hard: false },
        {
          member: "Sara",
          kind: "ingredient",
          key: "chicken-liver",
          reason: "dislike",
          hard: false,
        },
        {
          member: "Zayd",
          kind: "dietary_flag",
          key: "contains_sesame",
          reason: "allergy",
          hard: true,
        },
      ]
        .map((o) => JSON.stringify(o))
        .sort(),
    );
    const zayd = setup.members.find((m) => m.name === "Zayd")?.id;
    expect(setup.coverage).toContainEqual(
      expect.objectContaining({
        memberId: zayd,
        flag: "contains_sesame",
        slugs: expect.arrayContaining(["tahini", "hummus", "zaatar"]) as unknown,
      }),
    );
    const text = setup.explanations.filter((e) => e.answer === 5).map((e) => e.text);
    expect(text.find((t) => t.startsWith("Zayd:"))).toMatch(/tahini.*hummus|hummus.*tahini/);
    expect(text.find((t) => t.startsWith("Zayd:"))).toMatch(/za'atar/i);
    expect(text.find((t) => t.startsWith("Everyone:"))).toMatch(
      /pork and alcohol.*sauces and marinades/,
    );
    // R-34: the copy never says a dislike may still be served.
    expect(text.find((t) => t.startsWith("Sara:"))).toBe(
      "Sara: never beef liver and chicken liver. Never planned for them.",
    );
  });

  it("G4 a food with no match is reported, not saved", () => {
    const setup = inferSetup(
      answers([{ who: "Omar", term: "unobtainium", reason: "dislike" }]),
      context({ breakfast: "00000000-0000-4000-8000-000000000001" }, { slots: [] }),
    );
    expect(setup.unresolved).toEqual([{ who: "Omar", term: "unobtainium", reason: "dislike" }]);
    expect(setup.changeOps.filter((o) => o.kind === "exclusion.add")).toEqual([]);
  });
});
