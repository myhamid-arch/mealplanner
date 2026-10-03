// G1 (R2-ONB-3; BLD-8 R-55, R-56): POST /api/v1/onboarding/parse through the real route and 1.3.1's
// structured-output client over recorded responses. Typed results; a schema-failing or invalid
// reading is refused (502, nothing returned); 503 without a credential; admin only; one audit row
// per model call in the caller's household.
// R-88: the database is seeded, so the never-eat reading is checked against the real catalogue.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createOnboardingModel } from "@mealplanner/ai/onboarding";
import * as c from "@mealplanner/api-contract/contract";
import { aiGeneration, newId } from "@mealplanner/db/schema";
import { parsePeople, parseTargets } from "@mealplanner/core/onboarding";
import { useOnboardingParseModel } from "../../lib/server/onboarding-parse";
import { callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { acceptWithSignup, applyOps, invite, signupAdmin, type Login } from "./support/world";

const RESPONSES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/ai/test/onboarding/fixtures/responses",
);

/** The real parse model, answering from recorded responses in order. */
function recordedModel(...names: string[]) {
  const queue = [...names];
  return createOnboardingModel(
    { enabled: true, model: "claude-rec" },
    {
      apiKey: "test-key-not-real",
      maxRetries: 0,
      fetch: () => {
        const name = queue.shift();
        if (name === undefined) throw new Error("no recorded response left");
        const r = JSON.parse(readFileSync(join(RESPONSES, `${name}.json`), "utf8")) as {
          status: number;
          body: unknown;
        };
        return Promise.resolve(Response.json(r.body, { status: r.status }));
      },
    },
  );
}

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };
let b: Login & { householdId: string };
let member: Login;
let kitchen: Login;

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  a = await signupAdmin("Household A");
  b = await signupAdmin("Household B");
  const omar = newId();
  await applyOps(a, [
    {
      kind: "member.create",
      payload: { id: omar, displayName: "Omar", color: "sea", isTargeted: true },
    },
  ]);
  member = await acceptWithSignup(await invite(a, "member", omar), "Omar");
  kitchen = await acceptWithSignup(await invite(a, "kitchen", null), "Kitchen");
}, 120_000);

afterEach(() => {
  useOnboardingParseModel(undefined);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

const F1_PEOPLE = "Adult A 40, Adult B 37, Child C1 18 F, Child C2 15 M, Child C3 10 M";
const ADULT_A =
  "2150 cal, 180p 200c 70f, sat fat 22 g, soluble fibre 10 g. Training days: 2390 / 180 / 260 / 70";

const parse = (caller: Caller, body: unknown) => callJson(c.onboardingParse, { body }, caller);

async function audits(householdId: string) {
  return app.rt.db
    .select()
    .from(aiGeneration)
    .where(
      and(eq(aiGeneration.householdId, householdId), eq(aiGeneration.purpose, "onboarding_parse")),
    );
}

describe("G1 POST /onboarding/parse", () => {
  it("G1 typed people and targets from recorded responses, as the deterministic parse reads them", async () => {
    useOnboardingParseModel(recordedModel("people-f1", "targets-f1-adult-a"));
    const people = await parse(a, { field: "people", text: F1_PEOPLE });
    expect(people.status).toBe(200);
    expect(c.OnboardingParseDto.parse(people.json)).toEqual({ people: parsePeople(F1_PEOPLE) });
    const targets = await parse(a, { field: "targets", text: ADULT_A });
    expect(targets.status).toBe(200);
    expect(targets.json).toEqual({ targets: parseTargets(ADULT_A) });
  });

  it("R-88 typed never-eat rules, mapped onto the household's catalogue, with a question", async () => {
    useOnboardingParseModel(recordedModel("never-eat-mockup"));
    const r = await parse(a, {
      field: "never_eat",
      text: "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.",
      people: ["Omar", "Sara", "Layla", "Adam", "Zayd"],
      ages: [41, 39, 18, 15, 10],
      context: "Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver.",
    });
    expect(r.status).toBe(200);
    const dto = c.OnboardingParseDto.parse(r.json);
    expect(dto).toMatchObject({
      neverEat: [
        {
          who: "Zayd",
          reason: "allergy",
          target: { kind: "dietary_flag", keys: ["contains_sesame"] },
        },
        {
          who: "everyone",
          reason: "religious",
          target: { kind: "dietary_flag", keys: ["contains_pork"] },
        },
        {
          who: "everyone",
          reason: "religious",
          target: { kind: "dietary_flag", keys: ["contains_alcohol"] },
        },
        {
          who: "Sara",
          reason: "dislike",
          target: { kind: "ingredient", keys: ["beef-liver", "chicken-liver"] },
        },
      ],
      questions: [
        { who: "Sara", options: [{ label: "Yes, all organ meats" }, { label: "No, only liver" }] },
      ],
      unclear: [],
    });
  });

  it("G1 a schema-failing answer is refused with 502 and not returned; the audit row keeps why", async () => {
    const before = (await audits(a.householdId)).length;
    useOnboardingParseModel(
      recordedModel("schema-targets-string-kcal", "invalid-targets-disagree"),
    );
    for (const text of ["2150 cal", "2150 cal, 250p 300c 90f"]) {
      const r = await parse(a, { field: "targets", text });
      expect(r.status).toBe(502);
      const problem = c.Problem.parse(r.json);
      expect(problem.code).toBe("model_output_invalid");
      expect(r.text).not.toContain("proteinG");
    }
    const rows = await audits(a.householdId);
    expect(rows.length - before).toBe(2);
    expect(rows.every((row) => row.stopReason.length > 0)).toBe(true);
    expect(rows.filter((row) => row.validationErrors !== null).length).toBeGreaterThanOrEqual(2);
  });

  it("G1 refusal and API errors are 502 with their typed code", async () => {
    useOnboardingParseModel(recordedModel("refusal", "authentication"));
    const refused = await parse(a, { field: "people", text: F1_PEOPLE });
    expect([refused.status, c.Problem.parse(refused.json).code]).toEqual([502, "model_refusal"]);
    const auth = await parse(a, { field: "people", text: F1_PEOPLE });
    expect([auth.status, c.Problem.parse(auth.json).code]).toEqual([502, "model_authentication"]);
  });

  it("G1 without a credential: 503 and no audit row (the page keeps its deterministic parse)", async () => {
    useOnboardingParseModel(null);
    const before = (await audits(a.householdId)).length;
    const r = await parse(a, { field: "people", text: F1_PEOPLE });
    expect(r.status).toBe(503);
    expect(c.Problem.parse(r.json).code).toBe("model_unavailable");
    expect((await audits(a.householdId)).length).toBe(before);
  });

  it("G1 the environment decides: no Anthropic credential here means 503", async () => {
    // The test process has no credential (the handoff gate G6 runs with one).
    useOnboardingParseModel(undefined);
    const saved = { ...process.env };
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"])
      Reflect.deleteProperty(process.env, k);
    try {
      expect((await parse(a, { field: "people", text: F1_PEOPLE })).status).toBe(503);
    } finally {
      Object.assign(process.env, saved);
      useOnboardingParseModel(undefined);
    }
  });

  it("G1 admin only: member and kitchen get 403 and the model is not called", async () => {
    let calls = 0;
    useOnboardingParseModel({
      model: "claude-count",
      parse: () => {
        calls += 1;
        return Promise.reject(new Error("must not be called"));
      },
    });
    expect((await parse(member, { field: "people", text: F1_PEOPLE })).status).toBe(403);
    expect((await parse(kitchen, { field: "people", text: F1_PEOPLE })).status).toBe(403);
    expect(calls).toBe(0);
  });

  it("G1 the audit row belongs to the caller's household only", async () => {
    useOnboardingParseModel(recordedModel("people-f1"));
    const beforeA = (await audits(a.householdId)).length;
    const beforeB = (await audits(b.householdId)).length;
    expect((await parse(b, { field: "people", text: F1_PEOPLE })).status).toBe(200);
    expect((await audits(b.householdId)).length).toBe(beforeB + 1);
    expect((await audits(a.householdId)).length).toBe(beforeA);
    const [row] = (await audits(b.householdId)).slice(-1);
    expect(JSON.stringify(row?.requestSummary)).not.toContain("Adult A 40");
  });

  it("G1 input limits: empty text and text over 2000 characters are 400", async () => {
    useOnboardingParseModel(recordedModel());
    expect((await parse(a, { field: "people", text: "  " })).status).toBe(400);
    expect((await parse(a, { field: "people", text: "x".repeat(2001) })).status).toBe(400);
  });
});
