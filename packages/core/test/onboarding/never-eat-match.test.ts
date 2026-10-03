// W-28: never-eat answers in everyday words resolve against the catalogue, and a sentence naming
// several people gives each person only their own foods.
import { describe, expect, it } from "vitest";
import { parseNeverEat, resolveTerm } from "../../src/onboarding/index.js";
import { catalogueIngredients } from "./support.js";

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
      { who: "Adam", term: "seafood", reason: "religious" },
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
