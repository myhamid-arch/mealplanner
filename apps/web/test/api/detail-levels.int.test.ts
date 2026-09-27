// R2-DL-1 (BLD-8 R-47): the detail level is stored per (member, section) and read back; admins
// set any section, a member only their own taste section; household sections have no member;
// nothing leaks across households; the level is not a change set (R-24, outside DM-6).
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

beforeAll(async () => {
  db = await createTestDatabase({ seed: false });
  app = startTestApp(db.url);
  a = await signupAdmin("Household A");
  b = await signupAdmin("Household B");
  await applyOps(a, [
    {
      kind: "member.create",
      payload: { id: omar, displayName: "Omar", color: "sea", isTargeted: true },
    },
    {
      kind: "member.create",
      payload: { id: zayd, displayName: "Zayd", color: "basil", isTargeted: false },
    },
  ]);
  member = await acceptWithSignup(await invite(a, "member", omar), "Omar");
  kitchen = await acceptWithSignup(await invite(a, "kitchen", null), "Kitchen");
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

const put = (caller: Caller, body: { memberId: string | null; section: string; level: string }) =>
  callJson(c.detailLevelsSet, { body }, caller);
const levels = async (caller: Caller) =>
  ok<{ levels: { memberId: string | null; section: string; level: string }[] }>(
    await callJson(c.detailLevelsList, {}, caller),
    "list",
  ).levels;

describe("detail levels (R2-DL-1)", () => {
  it("an admin sets member and household sections; the list returns them; a second PUT updates", async () => {
    expect(
      (await put(a, { memberId: omar, section: "meal_split", level: "detailed" })).status,
    ).toBe(200);
    expect((await put(a, { memberId: null, section: "slots", level: "expert" })).status).toBe(200);
    const r = await put(a, { memberId: omar, section: "meal_split", level: "expert" });
    expect(r.json).toEqual({ memberId: omar, section: "meal_split", level: "expert" });
    expect(await levels(a)).toEqual(
      expect.arrayContaining([
        { memberId: omar, section: "meal_split", level: "expert" },
        { memberId: null, section: "slots", level: "expert" },
      ]),
    );
    expect(
      (await levels(a)).filter((l) => l.memberId === omar && l.section === "meal_split"),
    ).toHaveLength(1);
  });

  it("levels are per member: one member's level does not change another's", async () => {
    await put(a, { memberId: zayd, section: "targets", level: "basic" });
    await put(a, { memberId: omar, section: "targets", level: "expert" });
    const all = await levels(a);
    expect(all).toContainEqual({ memberId: zayd, section: "targets", level: "basic" });
    expect(all).toContainEqual({ memberId: omar, section: "targets", level: "expert" });
  });

  it("a section of the wrong scope is refused with 422", async () => {
    expect((await put(a, { memberId: null, section: "meal_split", level: "basic" })).status).toBe(
      422,
    );
    expect((await put(a, { memberId: omar, section: "planning", level: "basic" })).status).toBe(
      422,
    );
    expect(
      (await put(a, { memberId: omar, section: "Not A Section", level: "basic" })).status,
    ).toBe(400);
  });

  it("a member sets only their own taste level and sees only their own rows", async () => {
    expect(
      (await put(member, { memberId: omar, section: "taste", level: "detailed" })).status,
    ).toBe(200);
    expect((await put(member, { memberId: omar, section: "targets", level: "basic" })).status).toBe(
      403,
    );
    expect((await put(member, { memberId: zayd, section: "taste", level: "basic" })).status).toBe(
      403,
    );
    expect((await put(member, { memberId: null, section: "taste", level: "basic" })).status).toBe(
      403,
    );
    const own = await levels(member);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((l) => l.memberId === omar)).toBe(true);
  });

  it("kitchen may not read or write levels", async () => {
    expect((await callJson(c.detailLevelsList, {}, kitchen)).status).toBe(403);
    expect((await put(kitchen, { memberId: null, section: "slots", level: "basic" })).status).toBe(
      403,
    );
  });

  it("another household sees none of these rows and cannot write to this household's members", async () => {
    expect(await levels(b)).toEqual([]);
    expect((await put(b, { memberId: omar, section: "targets", level: "basic" })).status).toBe(404);
  });

  it("setting a level writes no change set (R-24)", async () => {
    const before = ok<{ entries: unknown[] }>(
      await callJson(c.changeSetsList, { query: {} }, a),
      "log",
    ).entries.length;
    await put(a, { memberId: omar, section: "taste", level: "basic" });
    const after = ok<{ entries: unknown[] }>(
      await callJson(c.changeSetsList, { query: {} }, a),
      "log",
    ).entries.length;
    expect(after).toBe(before);
  });
});
