// W-28: never-eat answers in everyday words resolve against the catalogue, and a sentence naming
// several people gives each person only their own foods.
import { describe, expect, it } from "vitest";
import {
  inferSetup,
  parseNeverEat,
  resolveTarget,
  resolveTerm,
  shortNames,
  splitStatements,
} from "../../src/onboarding/index.js";
import { idFactory, MemoryTx, newHousehold } from "./memory-tx.js";
import { catalogueIngredients, context } from "./support.js";

const ingredients = catalogueIngredients();
const nameOf = (slug: string) => ingredients.find((i) => i.slug === slug)?.name ?? slug;
const names = (term: string) => {
  const r = resolveTerm(term, ingredients);
  return r.kind === "unknown" ? [] : r.slugs.map(nameOf);
};

describe("W-28 resolveTerm", () => {
  it("chicken covers every chicken cut, not chicken stock", () => {
    const found = names("chicken");
    expect(found).toEqual(
      expect.arrayContaining([
        "Chicken breast, skinless",
        "Chicken liver",
        "Whole chicken, meat and skin",
      ]),
    );
    expect(found).toHaveLength(9);
    expect(found).not.toContain("Chicken stock");
  });

  it("lamb covers every lamb cut although 'lamb' is also an alias of one", () => {
    expect(names("lamb")).toHaveLength(4);
  });

  it("minced beef and ground beef match beef mince in any order", () => {
    for (const term of ["minced beef", "ground beef", "beef mince"])
      expect(names(term).sort(), term).toEqual([
        "Beef mince, 80% lean",
        "Beef mince, 90% lean",
        "Beef mince, 95% lean",
      ]);
  });

  it("seafood is a category rule covering shellfish and fish", () => {
    const r = resolveTerm("seafood", ingredients);
    expect(r.kind).toBe("category");
    if (r.kind !== "category") return;
    expect(r.categories).toEqual(["seafood", "fish"]);
    expect(r.slugs.map(nameOf)).toEqual(
      expect.arrayContaining(["Shrimp", "Squid (calamari)", "Cod"]),
    );
  });

  it("red meat and meat are category rules", () => {
    const red = resolveTerm("red meat", ingredients);
    const meat = resolveTerm("meat", ingredients);
    expect(red.kind === "category" && red.categories).toEqual(["red_meat"]);
    expect(meat.kind === "category" && meat.categories).toEqual(["red_meat", "poultry"]);
  });

  it("raw tomatoes resolves to every tomato and says 'raw' was dropped", () => {
    const r = resolveTerm("raw tomatoes", ingredients);
    expect(r.kind).toBe("ingredient");
    expect(r.kind === "ingredient" && r.slugs.map(nameOf)).toEqual(["Tomato", "Tomatoes, canned"]);
    expect(r.dropped).toEqual(["raw"]);
  });

  it("mushrooms and prawns match although the catalogue words differ", () => {
    expect(names("mushrooms")).toEqual(["Mushrooms, white"]);
    expect(names("prawns")).toEqual(["Shrimp"]);
  });

  it("negative control: kidney still does not match kidney beans; lean matches nothing", () => {
    expect(names("kidney")).toEqual([]);
    expect(names("lean")).toEqual([]);
  });
});

describe("W-28 parseNeverEat: each person keeps their own foods", () => {
  const people = ["Omar", "Sara", "Layla", "Adam", "Zayd"];

  it("a sentence naming several people splits by clause", () => {
    const items = parseNeverEat(
      "No pork for anyone, Omar hates minced beef, Sara won't eat raw tomatoes, Adam no seafood",
      people,
    );
    expect(items).toEqual([
      { who: "everyone", term: "pork", reason: "religious" },
      { who: "Omar", term: "minced beef", reason: "dislike" },
      { who: "Sara", term: "raw tomatoes", reason: "dislike" },
      { who: "Adam", term: "seafood", reason: "other" },
    ]);
  });

  it("the owner's sentence: religious only where pork or alcohol is named", () => {
    expect(
      parseNeverEat(
        "no pork or alcohol for the whole family, no lamb for manal, no bone in chicken for Yousif",
        ["Yousif", "Manal", "Nada", "Omar", "Mohamed"],
      ),
    ).toEqual([
      { who: "everyone", term: "pork", reason: "religious" },
      { who: "everyone", term: "alcohol", reason: "religious" },
      { who: "Manal", term: "lamb", reason: "other" },
      { who: "Yousif", term: "bone", reason: "other" },
      { who: "Yousif", term: "chicken", reason: "other" },
    ]);
  });

  it("a clause naming nobody continues the previous person", () => {
    expect(parseNeverEat("Zayd hates chicken, mushrooms", people)).toEqual([
      { who: "Zayd", term: "chicken", reason: "dislike" },
      { who: "Zayd", term: "mushrooms", reason: "dislike" },
    ]);
  });

  it("names listed before the food share it", () => {
    expect(parseNeverEat("Layla, Adam and Zayd are allergic to sesame", people)).toEqual([
      { who: "Layla", term: "sesame", reason: "allergy" },
      { who: "Adam", term: "sesame", reason: "allergy" },
      { who: "Zayd", term: "sesame", reason: "allergy" },
    ]);
  });
});

describe("R-88 resolveTarget: the assistant's mapping is held to the catalogue", () => {
  it("a flag covers exactly what the catalogue flags, whatever the model listed", () => {
    const r = resolveTarget({ kind: "dietary_flag", keys: ["contains_sesame"] }, ingredients);
    expect(r.kind).toBe("dietary_flag");
    expect(r.kind === "dietary_flag" && r.slugs).toEqual(
      ingredients.filter((i) => i.dietaryFlags.includes("contains_sesame")).map((i) => i.slug),
    );
  });
  it("an unknown flag, or two flags at once, resolves to nothing", () => {
    expect(resolveTarget({ kind: "dietary_flag", keys: ["contains_kale"] }, ingredients).kind).toBe(
      "unknown",
    );
    expect(
      resolveTarget(
        { kind: "dietary_flag", keys: ["contains_sesame", "contains_pork"] },
        ingredients,
      ).kind,
    ).toBe("unknown");
  });
  it("unknown slugs are dropped; none left is unknown", () => {
    const r = resolveTarget(
      { kind: "ingredient", keys: ["chicken-wing", "dragon-wing"] },
      ingredients,
    );
    expect(r.kind === "ingredient" && r.slugs).toEqual(["chicken-wing"]);
    expect(resolveTarget({ kind: "ingredient", keys: ["dragon-wing"] }, ingredients).kind).toBe(
      "unknown",
    );
  });
  it("a category covers its catalogue items", () => {
    const r = resolveTarget({ kind: "category", keys: ["seafood"] }, ingredients);
    expect(r.kind === "category" && r.slugs.length).toBe(8);
  });
});

describe("R-88 inferSetup applies a mapped rule and explains it in the catalogue's words", () => {
  it("bone-in chicken for one person: three ingredient exclusions, named from the catalogue", async () => {
    const ctx = context(await newHousehold(new MemoryTx(idFactory(2))));
    const setup = inferSetup(
      {
        people: [
          { name: "Yousif", age: 40, sex: null },
          { name: "Manal", age: 38, sex: null },
        ],
        targets: null,
        week: null,
        cuisines: null,
        neverEat: [
          {
            who: "Yousif",
            term: "no bone in chicken",
            reason: "other",
            target: {
              kind: "ingredient",
              keys: ["chicken-drumstick", "chicken-wing", "chicken-whole"],
            },
            keeps: "boneless cuts",
          },
        ],
      },
      ctx,
    );
    const keys = setup.changeOps
      .filter((o) => o.kind === "exclusion.add")
      .map((o) => (o.payload as { key: string }).key);
    expect(keys).toEqual(["chicken-drumstick", "chicken-wing", "chicken-whole"]);
    expect(setup.unresolved).toEqual([]);
    expect(setup.explanations.map((e) => e.text)).toContain(
      "Yousif: never chicken drumstick, chicken wing and whole chicken. Never planned for them.",
    );
  });
});

describe("R-88 splitStatements: each statement is read and answered on its own", () => {
  const people = ["Yousif", "manal", "nada", "Omar", "mohamed"];
  it("the owner's answer: one statement per person and restriction", () => {
    expect(
      splitStatements(
        "no pork or alcohol for the whole family, no lamb for manal, no bone in chicken for Yousif, Omar doesn't like cheese, mohamed does like seafood, nada doesn't like raw tomatoes, manal doesn't like raw garlic",
        people,
      ).map((s) => s.text),
    ).toEqual([
      "no pork or alcohol for the whole family",
      "no lamb for manal",
      "no bone in chicken for Yousif",
      "Omar doesn't like cheese",
      "mohamed does like seafood",
      "nada doesn't like raw tomatoes",
      "manal doesn't like raw garlic",
    ]);
  });
  it("a clause naming nobody stays with its statement; names before the food join it", () => {
    expect(
      splitStatements(
        "Omar is allergic to nuts but almond milk is fine. Omar, nada and manal hate liver, kidneys\nNo pork",
        people,
      ).map((s) => s.text),
    ).toEqual([
      "Omar is allergic to nuts but almond milk is fine",
      "Omar, nada and manal hate liver, kidneys",
      "No pork",
    ]);
  });
  it("the key is the normalised text, so case and spacing do not make a new statement", () => {
    const [a] = splitStatements("Omar  doesn't like CHEESE", people);
    const [b] = splitStatements("omar doesn't like cheese.", people);
    expect(a?.key).toBe(b?.key);
  });
});

describe("R-88 shortNames: one line a person can read", () => {
  it("the name before its comma, with the detail kept only where two would read alike", () => {
    expect(shortNames(["Tomato", "Cherry tomatoes", "Tomatoes, canned", "Tomato paste"])).toEqual([
      "tomato",
      "cherry tomatoes",
      "tomatoes (canned)",
      "tomato paste",
    ]);
    expect(
      shortNames([
        "Chicken wing, with skin",
        "Chicken breast, skinless",
        "Chicken breast, with skin",
      ]),
    ).toEqual(["chicken wing", "chicken breast (skinless)", "chicken breast (with skin)"]);
  });
});
