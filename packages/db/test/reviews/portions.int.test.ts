// G3 — FBK-5: untargeted members' learned role bias follows quantity feedback within [0.6, 1.6],
// as learning change sets; targeted members' portions (targets, bias, solver input) are unaffected.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepos } from "../../src/repos/index.js";
import { applyChangeSet, undoChangeSet } from "../../src/services/changes/index.js";
import { ChangeOpError, ChangeValidationError } from "../../src/services/changes/errors.js";
import { loadHouseholdConfig } from "../../src/services/config/index.js";
import { createReview } from "../../src/services/reviews/index.js";
import { portionBias } from "../../src/schema/index.js";
import type { TestDatabase } from "../support/db.js";
import { must } from "../support/must.js";
import { reviewDatabase, reviewHousehold, type ReviewHousehold } from "./support.js";

let database: TestDatabase;
let h: ReviewHousehold;
beforeAll(async () => {
  database = await reviewDatabase();
  h = await reviewHousehold(database);
}, 120_000);
afterAll(async () => {
  await database.drop();
});

async function biases(memberId: string): Promise<Record<string, number>> {
  const rows = await createRepos(database.db, h.as("adult_a")).portion_bias.list({ memberId });
  return Object.fromEntries(rows.map((r) => [r.componentRole, r.bias]));
}

async function component(role: string) {
  const r = createRepos(database.db, h.as("adult_a"));
  return must(
    (await r.component.list({ dishId: h.dishId })).find((c) => c.role === role),
    role,
  );
}

const quantity = (
  memberId: string,
  targetType: "component" | "dish" | "plan_day",
  targetId: string,
  tags: string[],
) =>
  createReview(database.db, h.as("adult_a"), {
    targetType,
    targetId,
    ...(targetType === "plan_day" ? {} : { planMealId: h.planMealId }),
    onBehalfOfMemberId: memberId,
    tags,
  });

describe("G3 FBK-5 portion bias (PostgreSQL)", { timeout: 120_000 }, () => {
  it("G3 too_much on a component multiplies that role's bias by 0.9; too_little by 1.1", async () => {
    const c1 = h.member("c1");
    const carb = await component("carb");
    const first = await quantity(c1, "component", carb.id, ["too_much"]);
    expect(await biases(c1)).toEqual({ carb: 0.9 });
    await quantity(c1, "component", carb.id, ["too_much"]);
    expect(await biases(c1)).toEqual({ carb: 0.81 });
    await quantity(c1, "component", carb.id, ["too_little"]);
    expect(await biases(c1)).toEqual({ carb: 0.891 });
    const cs = must(
      await createRepos(database.db, h.as("adult_a")).change_set.get({
        id: must(first.learningChangeSetId),
      }),
      "cs",
    );
    expect([cs.actor, cs.source]).toEqual(["system", "learning"]);
  });

  it("G3 a whole-meal or whole-day quantity tag adjusts every role on the member's plate, once each", async () => {
    const c2 = h.member("c2");
    const r = createRepos(database.db, h.as("adult_a"));
    const [plate] = await r.plate.list({ planMealId: h.planMealId, memberId: c2 });
    const roles = new Set<string>();
    for (const item of await r.plate_item.list({ plateId: must(plate, "plate").id }))
      if (item.cookedG > 0)
        roles.add((await r.component.get({ id: item.componentId }))?.role ?? "");
    await quantity(c2, "dish", h.dishId, ["still_hungry"]);
    expect(await biases(c2)).toEqual(Object.fromEntries([...roles].map((role) => [role, 1.1])));
    await quantity(c2, "plan_day", h.planDayId, ["too_much"]);
    expect(await biases(c2)).toEqual(Object.fromEntries([...roles].map((role) => [role, 0.99])));
  });

  it("G3 20 repeated signals stay within [0.6, 1.6]", async () => {
    const c3 = h.member("c3");
    const protein = await component("protein");
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      await quantity(c3, "component", protein.id, ["still_hungry"]);
      seen.push(must((await biases(c3)).protein, "bias"));
    }
    for (let i = 0; i < 20; i += 1) {
      await quantity(c3, "component", protein.id, ["too_much"]);
      seen.push(must((await biases(c3)).protein, "bias"));
    }
    expect(Math.max(...seen)).toBe(1.6);
    expect(Math.min(...seen)).toBe(0.6);
    expect(seen.every((b) => b >= 0.6 && b <= 1.6)).toBe(true);
  });

  it("G3 targeted members' quantity feedback changes no bias, target or solver input", async () => {
    const a = h.member("adult_a");
    const ctx = h.as("adult_a");
    const carb = await component("carb");
    const before = JSON.stringify(await loadHouseholdConfig(database.db, ctx));
    for (const tags of [["too_much"], ["too_little"], ["still_hungry"]]) {
      const result = await quantity(a, "component", carb.id, tags);
      expect(result.learningChangeSetId).toBeNull();
      await quantity(a, "dish", h.dishId, tags);
    }
    expect(await biases(a)).toEqual({});
    expect(JSON.stringify(await loadHouseholdConfig(database.db, ctx))).toBe(before);
  });

  it("G3 learning's portion change set undoes back to the prior bias", async () => {
    const c1 = h.member("c1");
    const before = await biases(c1);
    const result = await quantity(c1, "component", (await component("carb")).id, ["too_much"]);
    expect(await biases(c1)).not.toEqual(before);
    await undoChangeSet(database.db, h.as("adult_a"), must(result.learningChangeSetId), {
      actor: "user",
      source: "ui",
    });
    expect(await biases(c1)).toEqual(before);
  });

  it("G3 negative control: a bias for a targeted member, or outside the bounds, is refused", async () => {
    const system = { householdId: h.loaded.householdId, userId: null, role: "system" as const };
    const set = (memberId: string, bias: number) =>
      applyChangeSet(database.db, system, {
        actor: "system",
        source: "learning",
        summary: "bypass",
        ops: [{ kind: "portion_bias.set", payload: { memberId, componentRole: "carb", bias } }],
      });
    await expect(set(h.member("adult_a"), 0.9)).rejects.toBeInstanceOf(ChangeOpError);
    await expect(set(h.member("c1"), 0.5)).rejects.toBeInstanceOf(ChangeValidationError);
    await expect(set(h.member("c1"), 1.7)).rejects.toBeInstanceOf(ChangeValidationError);
    await expect(
      database.db.insert(portionBias).values({
        householdId: h.loaded.householdId,
        memberId: h.member("c2"),
        componentRole: "fat",
        bias: 0.5,
      }),
    ).rejects.toThrow();
    expect(await biases(h.member("adult_a"))).toEqual({});
  });
});
