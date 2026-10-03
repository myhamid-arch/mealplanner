// G1 (R2-ONB-3; leaf-1.4.7 SPEC-Q-1 … 4): the onboarding free-text parse through 1.3.1's
// structured-output client over recorded responses. Typed results for each field; a schema-failing
// or semantically invalid answer is refused, not repaired; typed errors; one audit row per call.
import { describe, expect, it } from "vitest";
import { parsePeople, parseTargets } from "@mealplanner/core/onboarding";
import {
  checkOutput,
  ONBOARDING_PARSE_MODEL,
  onboardingConfig,
  parseOnboardingText,
  parseRequest,
  type OnboardingGenerationRecord,
  type OnboardingParseResult,
} from "../../src/onboarding/index.js";
import { replayModel } from "./replay.js";

const F1 = {
  people: "Adult A 40, Adult B 37, Child C1 18 F, Child C2 15 M, Child C3 10 M",
  adultA:
    "2150 cal, 180p 200c 70f, sat fat 22 g, soluble fibre 10 g. Training days: 2390 / 180 / 260 / 70",
  neverEat: "Child C3 is allergic to sesame.",
};
const F1_NAMES = ["Adult A", "Adult B", "Child C1", "Child C2", "Child C3"];
const F1_AGES = [40, 37, 18, 15, 10];

/** R-88: a small catalogue the never-eat readings map onto. */
const CATALOGUE = [
  { slug: "tahini", name: "Tahini", category: "nut_seed", dietaryFlags: ["contains_sesame"] },
  { slug: "pork-loin", name: "Pork loin", category: "red_meat", dietaryFlags: ["contains_pork"] },
  { slug: "beef-liver", name: "Beef liver", category: "red_meat", dietaryFlags: [] },
  { slug: "chicken-liver", name: "Chicken liver", category: "poultry", dietaryFlags: [] },
  { slug: "shrimp", name: "Shrimp", category: "seafood", dietaryFlags: ["contains_shellfish"] },
];

const rule = (over: Record<string, unknown>) => ({
  who: "Zayd",
  said: "sesame",
  reason: "allergy",
  flag: null,
  categories: [],
  slugs: [],
  keeps: "",
  ...over,
});

function recorder() {
  const records: OnboardingGenerationRecord[] = [];
  return {
    records,
    recordGeneration: (r: OnboardingGenerationRecord) => {
      records.push(r);
      return Promise.resolve(`gen-${String(records.length)}`);
    },
  };
}

async function run(
  response: string,
  input: Parameters<typeof parseOnboardingText>[1],
): Promise<{
  result: OnboardingParseResult;
  records: OnboardingGenerationRecord[];
  bodies: Record<string, unknown>[];
}> {
  const { model, bodies } = replayModel(response);
  const rec = recorder();
  const result = await parseOnboardingText(
    { model, recordGeneration: rec.recordGeneration },
    input,
  );
  return { result, records: rec.records, bodies };
}

describe("G1 typed results from recorded responses", () => {
  it("G1 people: the F1 line reads as the deterministic parse reads it", async () => {
    const { result, records } = await run("people-f1", { field: "people", text: F1.people });
    expect(result).toEqual({
      status: "parsed",
      value: { field: "people", people: parsePeople(F1.people) },
      generationId: "gen-1",
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.purpose).toBe("onboarding_parse");
  });

  it("G1 people: prose the rules cannot split becomes typed people", async () => {
    const text = "me (41), my wife Sara 39 and our three kids Layla 18, Adam 15 and Zayd 10";
    const { result } = await run("people-prose", { field: "people", text });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed" || result.value.field !== "people") return;
    expect(result.value.people).toEqual([
      { name: "Sara", age: 39, sex: "female" },
      { name: "Layla", age: 18, sex: "female" },
      { name: "Adam", age: 15, sex: "male" },
      { name: "Zayd", age: 10, sex: "male" },
    ]);
  });

  it("G1 targets: Adult A's numbers equal the deterministic parse, training day included", async () => {
    const { result } = await run("targets-f1-adult-a", { field: "targets", text: F1.adultA });
    const expected = parseTargets(F1.adultA);
    expect(expected.ok).toBe(true);
    expect(result).toMatchObject({
      status: "parsed",
      value: { field: "targets", targets: expected },
    });
  });

  it("G1 targets: text without numbers is a typed not-ok reading with the model's reason", async () => {
    const { result } = await run("targets-none", {
      field: "targets",
      text: "whatever the coach says",
    });
    expect(result).toMatchObject({
      status: "parsed",
      value: {
        field: "targets",
        targets: { ok: false, reason: "No daily calories or macros were given." },
      },
    });
  });

  it("R-88 never-eat: the reading maps onto the catalogue sent with the instructions", async () => {
    const { result, bodies } = await run("never-eat-f1", {
      field: "never_eat",
      text: F1.neverEat,
      people: F1_NAMES,
      ages: F1_AGES,
      catalogue: CATALOGUE,
    });
    expect(result).toMatchObject({
      status: "parsed",
      value: {
        field: "never_eat",
        neverEat: [
          {
            who: "Child C3",
            term: "child c3 is allergic to sesame",
            reason: "allergy",
            // A flag only: what it covers stays the catalogue's (inferSetup expands it).
            target: { kind: "dietary_flag", keys: ["contains_sesame"] },
          },
        ],
        questions: [],
        unclear: [],
      },
    });
    // The people (with ages) go in the user turn; the catalogue in the cached system blocks.
    const sent = JSON.stringify(bodies[0]?.messages);
    expect(sent).toContain(
      "People: Adult A (40), Adult B (37), Child C1 (18), Child C2 (15), Child C3 (10)",
    );
    expect(sent).not.toContain("tahini");
    const system = JSON.stringify(bodies[0]?.system);
    expect(system).toContain("tahini | Tahini | nut_seed | contains_sesame");
    expect(bodies[0]?.output_config).toMatchObject({ effort: "low" });
  });

  it("R-88 never-eat: one statement is read, with the whole answer as context", async () => {
    const { bodies } = await run("never-eat-f1", {
      field: "never_eat",
      text: "Child C3 is allergic to sesame",
      context: "No pork for anyone. Child C3 is allergic to sesame.",
      people: F1_NAMES,
      catalogue: CATALOGUE,
    });
    const sent = JSON.stringify(bodies[0]?.messages);
    expect(sent).toContain(
      "Whole answer (context only):\\nNo pork for anyone. Child C3 is allergic to sesame.\\nRead this statement:\\nChild C3 is allergic to sesame",
    );
  });

  it("R-88 onboarding readings use the faster model unless ONBOARDING_PARSE_MODEL overrides it", () => {
    const base = { enabled: true as const, model: "claude-fable-5-1" };
    expect(onboardingConfig(base, {}).model).toBe(ONBOARDING_PARSE_MODEL);
    expect(onboardingConfig(base, { ONBOARDING_PARSE_MODEL: "claude-opus-5-5" }).model).toBe(
      "claude-opus-5-5",
    );
    const off = { enabled: false as const, model: "x", reason: "no key" };
    expect(onboardingConfig(off, {}).enabled).toBe(false);
  });

  it("R-88 never-eat: rules, reasons and a question with the options' rules", async () => {
    const people = ["Omar", "Sara", "Layla", "Adam", "Zayd"];
    const { result } = await run("never-eat-mockup", {
      field: "never_eat",
      text: "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.",
      people,
      catalogue: CATALOGUE,
    });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed" || result.value.field !== "never_eat") return;
    expect(result.value.neverEat.map((r) => [r.who, r.reason, r.target])).toEqual([
      ["Zayd", "allergy", { kind: "dietary_flag", keys: ["contains_sesame"] }],
      ["everyone", "religious", { kind: "dietary_flag", keys: ["contains_pork"] }],
      ["everyone", "religious", { kind: "dietary_flag", keys: ["contains_alcohol"] }],
      ["Sara", "dislike", { kind: "ingredient", keys: ["beef-liver", "chicken-liver"] }],
    ]);
    expect(result.value.questions).toHaveLength(1);
    expect(result.value.questions[0]?.options.map((o) => [o.label, o.items.length])).toEqual([
      ["Yes, all organ meats", 1],
      ["No, only liver", 0],
    ]);
  });
});

describe("G1 schema-failing and invalid answers are refused, not repaired (SPEC-Q-3)", () => {
  for (const [response, field] of [
    ["schema-people-missing-age", "people"],
    ["schema-targets-string-kcal", "targets"],
    ["schema-never-eat-bad-reason", "never_eat"],
    ["schema-not-json", "people"],
  ] as const)
    it(`G1 schema failure refused: ${response}`, async () => {
      const { result, records } = await run(response, {
        field,
        text: "some answer",
        people: ["Zayd"],
      });
      expect(result).toMatchObject({ status: "failed", code: "model_output_invalid" });
      expect(records).toHaveLength(1);
      expect(records[0]?.validationErrors).not.toBeNull();
    });

  for (const [response, field, issue] of [
    ["invalid-targets-swapped", "targets", /180 kcal is outside 800–6000/],
    ["invalid-targets-disagree", "targets", /disagrees with its macros/],
    ["invalid-never-eat-unknown-person", "never_eat", /"Grandma" is not one of the people named/],
    ["invalid-never-eat-unknown-slug", "never_eat", /"bacon-strips" is not in the catalogue/],
    ["invalid-people-duplicate", "people", /"omar" appears twice/],
    ["invalid-people-age", "people", /age 410 is outside 0–120/],
  ] as const)
    it(`G1 semantic check refuses: ${response}`, async () => {
      const { result, records } = await run(response, {
        field,
        text: "some answer",
        people: ["Zayd", "Sara"],
        catalogue: CATALOGUE,
      });
      expect(result.status).toBe("failed");
      if (result.status !== "failed") return;
      expect(result.code).toBe("model_output_invalid");
      expect(result.issues.join("\n")).toMatch(issue);
      // Recorded with its issues; nothing of the refused reading is returned.
      expect(records[0]?.validationErrors).toEqual(result.issues);
      expect(result).not.toHaveProperty("value");
    });

  it("G1 negative control: the same checks accept the valid reading they refuse when broken", () => {
    const valid = {
      day: {
        kcal: 2150,
        proteinG: 180,
        carbsG: 200,
        fatG: 70,
        satFatMaxG: null,
        solubleFibreMinG: null,
        fibreMinG: null,
        sodiumMaxMg: null,
      },
      training: null,
      problem: null,
    };
    expect(checkOutput("targets", valid).ok).toBe(true);
    expect(
      checkOutput("targets", {
        ...valid,
        day: { ...valid.day, proteinG: 250, carbsG: 300, fatG: 90 },
      }).ok,
    ).toBe(false);
    const reading = (r: Record<string, unknown>) => ({
      rules: [rule(r)],
      questions: [],
      unclear: [],
    });
    const ok = (r: Record<string, unknown>, people = ["Zayd"]) =>
      checkOutput("never_eat", reading(r), people, CATALOGUE).ok;
    expect(ok({ flag: "contains_sesame" })).toBe(true);
    expect(ok({ flag: "contains_sesame" }, ["Sara"])).toBe(false);
    expect(ok({ slugs: ["beef-liver"] })).toBe(true);
    expect(ok({ slugs: ["beef-kidney"] })).toBe(false);
    expect(ok({ categories: ["seafood"] })).toBe(true);
    // No catalogue item is in "fish" here, so the category covers nothing and is refused.
    expect(ok({ categories: ["fish"] })).toBe(false);
    // Exactly one of flag, categories and slugs.
    expect(ok({ flag: "contains_sesame", slugs: ["tahini"] })).toBe(false);
    expect(ok({})).toBe(false);
    // A question needs 2–4 options, and its options' rules pass the same checks.
    const question = (options: unknown[]) =>
      checkOutput(
        "never_eat",
        {
          rules: [],
          questions: [{ who: "Zayd", said: "x", question: "Which?", options }],
          unclear: [],
        },
        ["Zayd"],
        CATALOGUE,
      ).ok;
    expect(
      question([
        { label: "A", rules: [rule({ slugs: ["shrimp"] })] },
        { label: "B", rules: [] },
      ]),
    ).toBe(true);
    expect(question([{ label: "A", rules: [] }])).toBe(false);
    expect(
      question([
        { label: "A", rules: [rule({ slugs: ["lobster"] })] },
        { label: "B", rules: [] },
      ]),
    ).toBe(false);
    // Options that plan the same are merged; a question left with one plan is no question.
    const read = (options: unknown[]) =>
      checkOutput(
        "never_eat",
        {
          rules: [],
          questions: [{ who: "Zayd", said: "x", question: "Which?", options }],
          unclear: [],
        },
        ["Zayd"],
        CATALOGUE,
      );
    const merged = read([
      { label: "No shrimp", rules: [rule({ slugs: ["shrimp"] })] },
      { label: "No shrimp at all", rules: [rule({ slugs: ["shrimp"] })] },
      { label: "Shrimp is fine", rules: [] },
    ]);
    expect(
      merged.ok &&
        merged.value.field === "never_eat" &&
        merged.value.questions[0]?.options.map((o) => o.label),
    ).toEqual(["No shrimp", "Shrimp is fine"]);
    const moot = read([
      { label: "No shrimp", rules: [rule({ slugs: ["shrimp"] })] },
      { label: "Never shrimp", rules: [rule({ slugs: ["shrimp"] })] },
    ]);
    expect(
      moot.ok &&
        moot.value.field === "never_eat" && [
          moot.value.questions.length,
          moot.value.neverEat.length,
        ],
    ).toEqual([0, 1]);
  });
});

describe("G1 client rules and typed errors (REC-2, 07 §1)", () => {
  it("G1 the request: structured output, adaptive thinking, effort low, default fallbacks with the beta", async () => {
    const { bodies } = await run("people-f1", { field: "people", text: F1.people });
    const body = bodies[0] ?? {};
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(body.fallbacks).toBe("default");
    expect(body.model).toBe("claude-rec");
  });

  it("G1 the system prompt is stable per field and cached; the answer goes in the user turn", () => {
    const a = parseRequest({ field: "targets", text: "1999 kcal, 150p" });
    const b = parseRequest({ field: "targets", text: "1655 / 130 / 160 / 55" });
    expect(JSON.stringify(a.system)).toBe(JSON.stringify(b.system));
    expect(a.system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(a.system)).not.toContain("1999");
    expect(JSON.stringify(a.messages)).toContain("1999 kcal, 150p");
  });

  for (const [response, code] of [
    ["refusal", "refusal"],
    ["max-tokens", "max_tokens"],
    ["authentication", "authentication"],
  ] as const)
    it(`G1 ${code}: a typed failure, recorded, never thrown`, async () => {
      const { result, records } = await run(response, { field: "people", text: F1.people });
      expect(result).toMatchObject({ status: "failed", code });
      expect(records).toHaveLength(1);
      expect(records[0]?.stopReason).toBe(code === "authentication" ? "authentication" : code);
    });

  it("G1 without a credential: disabled, no call, no audit row", async () => {
    const rec = recorder();
    const result = await parseOnboardingText(
      { model: null, recordGeneration: rec.recordGeneration },
      { field: "people", text: F1.people },
    );
    expect(result.status).toBe("disabled");
    expect(rec.records).toEqual([]);
  });

  it("G1 the audit row holds no answer text and no credential", async () => {
    const { records } = await run("people-f1", { field: "people", text: F1.people });
    const summary = JSON.stringify(records[0]?.requestSummary);
    expect(summary).not.toContain("Adult A 40");
    expect(summary).not.toContain("test-key-not-real");
    expect(records[0]?.requestSummary).toMatchObject({
      field: "people",
      textLength: F1.people.length,
    });
  });

  it("G1 text over 2000 characters is not sent", async () => {
    const { model, bodies } = replayModel("people-f1");
    await expect(
      parseOnboardingText(
        { model, recordGeneration: () => Promise.resolve("x") },
        { field: "people", text: "a".repeat(2001) },
      ),
    ).rejects.toThrow(RangeError);
    expect(bodies).toEqual([]);
  });
});
