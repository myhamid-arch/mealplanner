// GET /api/v1/portion-biases (FBK-5, FBK-9; BLD-8 R-53): admins read every member's learned role
// biases or one member's; a member reads only their own member's (asking for another member is
// 403); kitchen is refused by role; nothing crosses households.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { newId } from "@mealplanner/db/schema";
import { callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { acceptWithSignup, applyOps, invite, ok, signupAdmin, type Login } from "./support/world";

let db: TestDatabase;
let app: TestApp;
let a: Login & { householdId: string };
let b: Login & { householdId: string };
let member: Login;
let kitchen: Login;
const omar = newId();
const zayd = newId();
const other = newId();

type Bias = { memberId: string; componentRole: string; factor: number };

beforeAll(async () => {
  db = await createTestDatabase({ seed: false });
  app = startTestApp(db.url);
  a = await signupAdmin("Household A");
  b = await signupAdmin("Household B");
  await applyOps(a, [
    {
      kind: "member.create",
      payload: { id: omar, displayName: "Omar", color: "sea", isTargeted: false },
    },
    {
      kind: "member.create",
      payload: { id: zayd, displayName: "Zayd", color: "basil", isTargeted: false },
    },
    { kind: "portion_bias.set", payload: { memberId: zayd, componentRole: "carb", bias: 0.9 } },
    { kind: "portion_bias.set", payload: { memberId: zayd, componentRole: "protein", bias: 1.1 } },
    {
      kind: "portion_bias.set",
      payload: { memberId: omar, componentRole: "vegetable", bias: 1.2 },
    },
  ]);
  await applyOps(b, [
    {
      kind: "member.create",
      payload: { id: other, displayName: "Other", color: "sea", isTargeted: false },
    },
    { kind: "portion_bias.set", payload: { memberId: other, componentRole: "carb", bias: 1.5 } },
  ]);
  member = await acceptWithSignup(await invite(a, "member", zayd), "Zayd");
  kitchen = await acceptWithSignup(await invite(a, "kitchen", null), "Kitchen");
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

const list = (caller: Caller, memberId?: string) =>
  callJson(c.portionBiasesList, { query: memberId === undefined ? {} : { memberId } }, caller);
const biases = async (caller: Caller, memberId?: string) =>
  ok<{ biases: Bias[] }>(await list(caller, memberId), "list").biases;

describe("portion biases (FBK-5, R-53)", () => {
  it("an admin reads every member's biases of the household, and nothing of another household", async () => {
    const all = await biases(a);
    expect(all).toHaveLength(3);
    expect(all).toContainEqual({ memberId: zayd, componentRole: "carb", factor: 0.9 });
    expect(all).toContainEqual({ memberId: zayd, componentRole: "protein", factor: 1.1 });
    expect(all).toContainEqual({ memberId: omar, componentRole: "vegetable", factor: 1.2 });
    expect(all.some((x) => x.memberId === other)).toBe(false);
  });

  it("an admin reads one member's biases with ?memberId", async () => {
    const one = await biases(a, zayd);
    expect(one.map((x) => x.componentRole).sort()).toEqual(["carb", "protein"]);
    expect(one.every((x) => x.memberId === zayd)).toBe(true);
    expect(await biases(a, other)).toEqual([]);
  });

  it("a member reads only their own member's biases", async () => {
    const mine = await biases(member);
    expect(mine.map((x) => x.componentRole).sort()).toEqual(["carb", "protein"]);
    expect(await biases(member, zayd)).toHaveLength(2);
    const refused = await list(member, omar);
    expect(refused.status).toBe(403);
  });

  it("kitchen is refused by role", async () => {
    expect((await list(kitchen)).status).toBe(403);
  });
});
