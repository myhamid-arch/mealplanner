// The deterministic parsers (R2-ONB-3 formats; leaf-1.4.3 SPEC-Q-11).
import { describe, expect, it } from "vitest";
import {
  appetiteForAge,
  parseNeverEat,
  parsePeople,
  parseTargets,
  weekdayText,
} from "../../src/onboarding/index.js";

describe("parsePeople", () => {
  it("reads the mockup's line", () => {
    expect(parsePeople("Omar 41, Sara 39, Layla 18, Adam 15, Zayd 10")).toEqual([
      { name: "Omar", age: 41, sex: null },
      { name: "Sara", age: 39, sex: null },
      { name: "Layla", age: 18, sex: null },
      { name: "Adam", age: 15, sex: null },
      { name: "Zayd", age: 10, sex: null },
    ]);
  });
  it("reads brackets, sex markers, 'and' and names with spaces", () => {
    expect(parsePeople("Layla (18, F) and Adam (15, M); Mary Ann 7 years old, Grandpa")).toEqual([
      { name: "Layla", age: 18, sex: "female" },
      { name: "Adam", age: 15, sex: "male" },
      { name: "Mary Ann", age: 7, sex: null },
      { name: "Grandpa", age: null, sex: null },
    ]);
  });
  it("ignores empty chunks", () => {
    expect(parsePeople(" , ,")).toEqual([]);
  });
  it("appetite from age: ≥ 14 large, 8–13 medium, < 8 small", () => {
    expect([14, 13, 8, 7, null].map(appetiteForAge)).toEqual([
      "large",
      "medium",
      "medium",
      "small",
      "medium",
    ]);
  });
});

describe("parseTargets", () => {
  it.each([
    ["2150 cal, 180p 200c 70f", { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70 }],
    ["1655 / 130 / 160 / 55", { kcal: 1655, proteinG: 130, carbsG: 160, fatG: 55 }],
    [
      "Calories: 2000\nProtein: 150 g\nCarbs: 200 g\nFat: 60 g",
      { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    ],
    ["P180 C200 F70 kcal 2150", { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70 }],
    ["2000 kcal, 150P/200C/60F", { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 }],
    ["150g protein, 200g carbs, 60g fat", { kcal: 1940, proteinG: 150, carbsG: 200, fatG: 60 }],
  ])("reads %j", (text, expected) => {
    expect(parseTargets(text)).toEqual({ ok: true, value: expected });
  });
  it("reads extras and a training-day part", () => {
    expect(
      parseTargets(
        "2150 cal, 180p 200c 70f, sat fat 22g, soluble fibre 10g, fibre 35 g, sodium 2300 mg. Training days: 2390 / 180 / 260 / 70",
      ),
    ).toEqual({
      ok: true,
      value: {
        kcal: 2150,
        proteinG: 180,
        carbsG: 200,
        fatG: 70,
        satFatMaxG: 22,
        solubleFibreMinG: 10,
        fibreMinG: 35,
        sodiumMaxMg: 2300,
        training: { kcal: 2390, proteinG: 180, carbsG: 260, fatG: 70 },
      },
    });
  });
  it("explains what is missing or out of range", () => {
    expect(parseTargets("")).toMatchObject({ ok: false });
    expect(parseTargets("180p 200c")).toEqual({ ok: false, reason: "Missing fat." });
    expect(parseTargets("12 / 1 / 1 / 1")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("800–6000") as unknown,
    });
  });
});

describe("parseNeverEat", () => {
  const people = ["Omar", "Sara", "Layla", "Adam", "Zayd"];
  it("reads the mockup's answer", () => {
    expect(
      parseNeverEat(
        "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.",
        people,
      ),
    ).toEqual([
      { who: "Zayd", term: "sesame", reason: "allergy" },
      { who: "everyone", term: "pork", reason: "religious" },
      { who: "everyone", term: "alcohol", reason: "religious" },
      { who: "Sara", term: "liver", reason: "dislike" },
    ]);
  });
  it("reads several people and several foods in one sentence", () => {
    expect(parseNeverEat("Layla and Adam can't stand mushrooms, olives", people)).toEqual([
      { who: "Layla", term: "mushrooms", reason: "dislike" },
      { who: "Layla", term: "olives", reason: "dislike" },
      { who: "Adam", term: "mushrooms", reason: "dislike" },
      { who: "Adam", term: "olives", reason: "dislike" },
    ]);
  });
  it("a sentence with no name applies to everyone", () => {
    expect(parseNeverEat("We are halal", people)).toEqual([]);
    expect(parseNeverEat("No shellfish", people)).toEqual([
      { who: "everyone", term: "shellfish", reason: "other" },
    ]);
  });
});

describe("weekdayText", () => {
  it("names runs and lists", () => {
    expect(weekdayText([0, 1, 2, 3, 4])).toBe("Mon–Fri");
    expect(weekdayText([0, 2, 4])).toBe("Mon, Wed, Fri");
    expect(weekdayText([0, 1, 2, 3, 4, 5, 6])).toBe("every day");
  });
});
