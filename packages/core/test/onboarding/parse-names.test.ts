// W-10a (leaf-1.4.9 G3, R2-ONB-3): the deterministic parse keeps relation and possessive words out
// of names, and "me" is the admin. PARSE_PEOPLE_MODULE loads another `parse-people` in place of
// the current one (the verify script's negative control runs the pre-fix parser through the same
// assertions, which must fail).
import { describe, expect, it } from "vitest";
import { inferSetup, type PersonAnswer } from "../../src/onboarding/index.js";
import * as current from "../../src/onboarding/parse-people.js";
import { context, F1_TEXT } from "./support.js";

const override = process.env.PARSE_PEOPLE_MODULE;
const { parsePeople } = (
  override === undefined || override === "" ? current : await import(/* @vite-ignore */ override)
) as { parsePeople: (text: string) => PersonAnswer[] };

const p = (name: string, age: number | null, sex: PersonAnswer["sex"] = null): PersonAnswer => ({
  name,
  age,
  sex,
});

describe("F1 lines", () => {
  it('F1 as onboarding answer 1 keeps its names ("Child C1" is a name)', () => {
    expect(parsePeople(F1_TEXT.people)).toEqual([
      p("Adult A", 40),
      p("Adult B", 37),
      p("Child C1", 18, "female"),
      p("Child C2", 15, "male"),
      p("Child C3", 10, "male"),
    ]);
  });
  it("the mockup's line", () => {
    expect(parsePeople("Omar 41, Sara 39, Layla 18 F, Adam 15 M, Zayd 10 M")).toEqual([
      p("Omar", 41),
      p("Sara", 39),
      p("Layla", 18, "female"),
      p("Adam", 15, "male"),
      p("Zayd", 10, "male"),
    ]);
  });
  it("F1 written with relation words", () => {
    expect(
      parsePeople(
        "Adult A 40, my wife Adult B 37 and our three kids Child C1 18 F, Child C2 15 M and Child C3 10 M",
      ),
    ).toEqual([
      p("Adult A", 40),
      p("Adult B", 37),
      p("Child C1", 18, "female"),
      p("Child C2", 15, "male"),
      p("Child C3", 10, "male"),
    ]);
  });
});

describe("relation and possessive phrases (W-10a)", () => {
  it.each<[string, string, PersonAnswer[]]>([
    [
      "1",
      "me (41), my wife Sara 39 and our three kids Layla 18, Adam 15 and Zayd 10",
      [p("me", 41), p("Sara", 39), p("Layla", 18), p("Adam", 15), p("Zayd", 10)],
    ],
    [
      "2",
      "My husband Omar 41, me 39, our kids Layla 18, Adam 15, Zayd 10",
      [p("Omar", 41), p("me", 39), p("Layla", 18), p("Adam", 15), p("Zayd", 10)],
    ],
    ["3", "Sara, my wife, 39; our son Adam 15", [p("Sara", 39), p("Adam", 15)]],
    [
      "4",
      "our daughter Layla (18, F) and our son Adam (15, M)",
      [p("Layla", 18, "female"), p("Adam", 15, "male")],
    ],
    ["5", "my partner Sam 38 & my stepdaughter Mia 12", [p("Sam", 38), p("Mia", 12)]],
    [
      "6",
      "Omar 41, his wife Sara 39, their twins Adam and Zayd 10",
      [p("Omar", 41), p("Sara", 39), p("Adam", null), p("Zayd", 10)],
    ],
    ["7", "the kids: Layla 18, Adam 15, Zayd 10", [p("Layla", 18), p("Adam", 15), p("Zayd", 10)]],
    ["8", "two kids Adam 15 and Zayd 10", [p("Adam", 15), p("Zayd", 10)]],
    [
      "9",
      "my mum Aisha 68, my 2 boys Adam 15 and Zayd 10",
      [p("Aisha", 68), p("Adam", 15), p("Zayd", 10)],
    ],
    [
      "10",
      "Sara (my wife) 39, Omar's mother Aisha 68, our youngest daughter Layla 12",
      [p("Sara", 39), p("Aisha", 68), p("Layla", 12)],
    ],
    ["11", "Omar 41 (me), my wife 39", [p("Omar", 41), p("Wife", 39)]],
    ["12", "I'm 41, kids Adam 15 and Zayd 10", [p("I'm", 41), p("Adam", 15), p("Zayd", 10)]],
  ])("phrasing %s: %s", (_n, text, expected) => {
    expect(parsePeople(text)).toEqual(expected);
  });

  it("the architect's line gives five plain names", () => {
    // One string, so a failure message shows what the parse named (the negative control reads it).
    expect(
      parsePeople("me (41), my wife Sara 39 and our three kids Layla 18, Adam 15 and Zayd 10")
        .map((x) => x.name)
        .join(", "),
    ).toBe("me, Sara, Layla, Adam, Zayd");
  });

  it("a bare singular relation word stays a name when nothing else is given", () => {
    expect(parsePeople("Grandpa, Child C1 18")).toEqual([p("Grandpa", null), p("Child C1", 18)]);
  });
});

describe("inferSetup: the members of the architect's line (W-10a)", () => {
  const SLOT_IDS: Record<string, string> = {};
  it("gives the viewer, Sara, Layla, Adam and Zayd with their ages", () => {
    const setup = inferSetup(
      {
        people: parsePeople(
          "me (41), my wife Sara 39 and our three kids Layla 18, Adam 15 and Zayd 10",
        ),
        targets: [
          {
            person: "me",
            numbers: { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70 },
          },
        ],
        week: null,
        cuisines: null,
        neverEat: null,
      },
      context(SLOT_IDS, { adminName: "Omar" }),
    );
    const members = setup.changeOps
      .filter((o) => o.kind === "member.create")
      .map((o) => {
        const m = o.payload as {
          displayName: string;
          birthYear: number | null;
          isTargeted: boolean;
        };
        return [m.displayName, m.birthYear, m.isTargeted];
      });
    expect(members).toEqual([
      ["Omar", 2026 - 41, true],
      ["Sara", 2026 - 39, false],
      ["Layla", 2026 - 18, false],
      ["Adam", 2026 - 15, false],
      ["Zayd", 2026 - 10, false],
    ]);
  });
});
