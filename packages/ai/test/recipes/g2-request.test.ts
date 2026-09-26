// G2 (REC-2, REC-3, ARC-10): the system and catalogue blocks are byte-identical across calls with
// different contexts, and no personal data (names, ages, ids, emails) reaches the request.
import { describe, expect, it } from "vitest";
import {
  SYSTEM_PROMPT,
  buildGenerationContext,
  catalogueBlock,
  generateRecipes,
} from "../../src/recipes/index.js";
import { loadCatalogue } from "./support/catalogue.js";
import {
  ageLeaks,
  catalogueOrderProblems,
  findLeaks,
  personalData,
  sentContext,
  systemStabilityProblems,
  unexpectedKeys,
} from "./support/checks.js";
import { F1_DINNER_DATE, REALISTIC, f1Config, realisticF1 } from "./support/household.js";
import { batchFixture, batchResponse, type RecordedRequest } from "./support/recorded.js";
import { f1DinnerRequest, scenario } from "./support/scenario.js";

const EMAILS = REALISTIC.members.map((m) => m.email);
const ADMIN_REQUEST =
  "Something Zayd will eat after football, and email the recipe to omar.haddad@example.ae";

async function captured(
  config: Parameters<typeof f1DinnerRequest>[0],
  extra: Parameters<typeof f1DinnerRequest>[1] = {},
): Promise<RecordedRequest> {
  const valid = batchFixture("valid-batch");
  const s = scenario([batchResponse(valid)], { config });
  await generateRecipes(s.deps, f1DinnerRequest(config, extra)).catch(() => undefined);
  const [request] = s.recorder.requests;
  if (request === undefined) throw new Error("no request recorded");
  return request;
}

describe("G2 cache stability (REC-2)", () => {
  it("sends byte-identical cached system and catalogue blocks for different contexts", async () => {
    const requests = [
      await captured(f1Config()),
      await captured(f1Config(), { date: "2026-10-03", slotKey: "breakfast", count: 1 }),
      await captured(realisticF1(), { adminRequest: ADMIN_REQUEST }),
    ];
    // The contexts differ …
    const contexts = requests.map((r) => JSON.stringify(sentContext(r)));
    expect(new Set(contexts).size).toBe(3);
    // … and the cached prefix does not.
    expect(systemStabilityProblems(requests)).toEqual([]);
    const blocks = requests[0]?.body.system as Array<{ text: string }>;
    expect(blocks[0]?.text).toBe(SYSTEM_PROMPT);
    expect(blocks[1]?.text).toBe(catalogueBlock(loadCatalogue()));
  });

  it("lists the catalogue sorted by slug, then the method and cuisine keys (REC-2 §2)", () => {
    const catalogue = loadCatalogue();
    const text = catalogueBlock(catalogue);
    expect(
      catalogueOrderProblems(
        text,
        catalogue.ingredients.map((i) => i.slug),
      ),
    ).toEqual([]);
    expect(text).toContain(`Preparation-method keys: ${[...catalogue.methods].sort().join(", ")}`);
    expect(text).toContain(`Cuisine keys: ${[...catalogue.cuisines].sort().join(", ")}`);
    // Shuffled input renders the same bytes.
    const shuffled = { ...catalogue, ingredients: [...catalogue.ingredients].reverse() };
    expect(catalogueBlock(shuffled)).toBe(text);
  });

  it("detects a system block that carries volatile content (negative control)", async () => {
    const good = await captured(f1Config());
    const blocks = good.body.system as Array<{
      type: string;
      text: string;
      cache_control: unknown;
    }>;
    const dated = {
      ...good,
      body: {
        ...good.body,
        system: [
          { ...blocks[0], text: `${blocks[0]?.text ?? ""}\nToday is ${F1_DINNER_DATE}.` },
          blocks[1],
        ],
      },
    };
    expect(systemStabilityProblems([good, dated]).length).toBeGreaterThan(0);
  });
});

describe("G2 pseudonymisation (REC-3, ARC-10)", () => {
  it("sends no member name, age, birth year, member id, household id or email", async () => {
    const config = realisticF1();
    const request = await captured(config, { adminRequest: ADMIN_REQUEST });
    const data = personalData(config, EMAILS);
    expect(data.length).toBeGreaterThan(20);
    expect(findLeaks(request.raw, data)).toEqual([]);
    for (const [, value] of Object.entries(request.headers))
      expect(findLeaks(value, data)).toEqual([]);
    const context = sentContext(request);
    expect(unexpectedKeys(context)).toEqual([]);
    expect(ageLeaks(context, config, F1_DINNER_DATE)).toEqual([]);

    // The context is still useful: labels, targets and the scrubbed request are there.
    const c = context as {
      attendees: Array<{ label: string; targeted: boolean; likes: string[]; dislikes: string[] }>;
      adminRequest: string;
      slot: { constraintsNote: string };
      locale: { regionNote: string };
    };
    expect(c.attendees.map((a) => [a.label, a.targeted])).toEqual([
      ["Adult A", true],
      ["Adult B", true],
      ["Adult C", false],
      ["Child A", false],
      ["Child B", false],
    ]);
    expect(c.attendees[0]?.likes).toEqual(["ingredient:salmon"]);
    expect(c.attendees[1]?.dislikes).toEqual(["method:deep_fried"]);
    expect(c.attendees[4]?.likes).toEqual(["cuisine:japanese"]);
    expect(c.adminRequest).toBe(
      "Something Child B will eat after football, and email the recipe to [email]",
    );
    expect(c.slot.constraintsNote).toBe("Child B eats first; Adult B prefers dinner by 19:30");
    expect(c.locale.regionNote).toBe("Khalifa City, Abu Dhabi (Adult A's office in Musaffah)");
  });

  it("finds the same data when it is not pseudonymised (negative control)", () => {
    const config = realisticF1();
    const data = personalData(config, EMAILS);
    const leaked = JSON.stringify({
      members: config.members,
      household: config.household,
      note: ADMIN_REQUEST,
    });
    const leaks = findLeaks(leaked, data);
    for (const kind of [
      "household id",
      "household name",
      "member id",
      "member name",
      "birth year",
      "email",
    ])
      expect(leaks.some((l) => l.startsWith(kind))).toBe(true);
    const { context } = buildGenerationContext({ config, date: F1_DINNER_DATE, slotKey: "dinner" });
    const withAge = { ...context, attendees: context.attendees.map((a) => ({ ...a, age: 40 })) };
    expect(unexpectedKeys(withAge).length).toBeGreaterThan(0);
    expect(ageLeaks(withAge, config, F1_DINNER_DATE).length).toBeGreaterThan(0);
  });

  it("puts date-dependent targets and the admin request only in the user message", async () => {
    const request = await captured(f1Config(), {
      adminRequest: "a British breakfast using labneh",
    });
    const system = JSON.stringify(request.body.system);
    expect(system).not.toContain("a British breakfast using labneh");
    const user = JSON.stringify(request.body.messages);
    expect(user).toContain("a British breakfast using labneh");
    expect(user).toContain("plateTarget");
    expect(system).not.toContain("plateTarget");
  });
});
