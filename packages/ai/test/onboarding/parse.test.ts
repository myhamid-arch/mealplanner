// G1 (R2-ONB-3; leaf-1.4.7 SPEC-Q-1 … 4): the onboarding free-text parse through 1.3.1's
// structured-output client over recorded responses. Typed results for each field; a schema-failing
// or semantically invalid answer is refused, not repaired; typed errors; one audit row per call.
import { describe, expect, it } from "vitest";
import {
  parseNeverEat,
  parsePeople,
  parseTargets,
} from "@mealplanner/core/onboarding";
import {
  checkOutput,
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
): Promise<{ result: OnboardingParseResult; records: OnboardingGenerationRecord[]; bodies: Record<string, unknown>[] }> {
  const { model, bodies } = replayModel(response);
  const rec = recorder();
  const result = await parseOnboardingText({ model, recordGeneration: rec.recordGeneration }, input);
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
    expect(result).toMatchObject({ status: "parsed", value: { field: "targets", targets: expected } });
  });

  it("G1 targets: text without numbers is a typed not-ok reading with the model's reason", async () => {
    const { result } = await run("targets-none", { field: "targets", text: "whatever the coach says" });
    expect(result).toMatchObject({
      status: "parsed",
      value: {
        field: "targets",
        targets: { ok: false, reason: "No daily calories or macros were given." },
      },
    });
  });

  it("G1 never-eat: rules keep the term; the catalogue, not the model, expands it", async () => {
    const { result, bodies } = await run("never-eat-f1", {
      field: "never_eat",
      text: F1.neverEat,
      people: F1_NAMES,
    });
    expect(result).toMatchObject({
      status: "parsed",
      value: { field: "never_eat", neverEat: parseNeverEat(F1.neverEat, F1_NAMES) },
    });
    // The request lists the people and nothing from the catalogue.
    const sent = JSON.stringify(bodies[0]?.messages);
    expect(sent).toContain("People: Adult A, Adult B, Child C1, Child C2, Child C3");
    expect(sent).not.toMatch(/tahini|za'?atar|contains_sesame/);
  });

  it("G1 never-eat: the mockup's sentence gives four rules with reasons", async () => {
    const people = ["Omar", "Sara", "Layla", "Adam", "Zayd"];
    const { result } = await run("never-eat-mockup", {
      field: "never_eat",
      text: "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.",
      people,
    });
    expect(result).toMatchObject({
      status: "parsed",
      value: {
        field: "never_eat",
        neverEat: [
          { who: "Zayd", term: "sesame", reason: "allergy" },
          { who: "everyone", term: "pork", reason: "religious" },
          { who: "everyone", term: "alcohol", reason: "religious" },
          { who: "Sara", term: "liver", reason: "dislike" },
        ],
      },
    });
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
      const { result, records } = await run(response, { field, text: "some answer", people: ["Zayd"] });
      expect(result).toMatchObject({ status: "failed", code: "model_output_invalid" });
      expect(records).toHaveLength(1);
      expect(records[0]?.validationErrors).not.toBeNull();
    });

  for (const [response, field, issue] of [
    ["invalid-targets-swapped", "targets", /180 kcal is outside 800–6000/],
    ["invalid-targets-disagree", "targets", /disagrees with its macros/],
    ["invalid-never-eat-unknown-person", "never_eat", /"Grandma" is not one of the people named/],
    ["invalid-people-duplicate", "people", /"omar" appears twice/],
    ["invalid-people-age", "people", /age 410 is outside 0–120/],
  ] as const)
    it(`G1 semantic check refuses: ${response}`, async () => {
      const { result, records } = await run(response, {
        field,
        text: "some answer",
        people: ["Zayd", "Sara"],
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
      day: { kcal: 2150, proteinG: 180, carbsG: 200, fatG: 70, satFatMaxG: null, solubleFibreMinG: null, fibreMinG: null, sodiumMaxMg: null },
      training: null,
      problem: null,
    };
    expect(checkOutput("targets", valid).ok).toBe(true);
    expect(checkOutput("targets", { ...valid, day: { ...valid.day, proteinG: 250, carbsG: 300, fatG: 90 } }).ok).toBe(false);
    expect(checkOutput("never_eat", { rules: [{ who: "Zayd", term: "sesame", reason: "allergy" }] }, ["Zayd"]).ok).toBe(true);
    expect(checkOutput("never_eat", { rules: [{ who: "Zayd", term: "sesame", reason: "allergy" }] }, ["Sara"]).ok).toBe(false);
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
    expect(records[0]?.requestSummary).toMatchObject({ field: "people", textLength: F1.people.length });
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
