// G6 (BLD-2): fixtures F1, F2, F3 load; what is stored equals what the fixture describes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import { FixtureSchema, type Fixture } from "@mealplanner/core/types";
import { createRepos } from "../src/repos/index.js";
import { household } from "../src/schema/index.js";
import {
  FixtureError,
  loadFixture,
  loadHouseholdConfig,
  seedCatalog,
  type LoadedFixture,
} from "../src/services/config/index.js";
import { createTestDatabase, type TestDatabase } from "./support/db.js";
import { F1, F2, F3, fixtureCatalog } from "./support/fixtures.js";
import { must } from "./support/must.js";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await seedCatalog(database.db, fixtureCatalog);
}, 60_000);

afterAll(async () => {
  await database.drop();
});

/** Differences between a loaded household and its fixture (empty = the fixture loaded exactly). */
async function loadProblems(fixture: Fixture, loaded: LoadedFixture): Promise<string[]> {
  const problems: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };
  const config = await loadHouseholdConfig(database.db, loaded.adminContext);
  const repos = createRepos(database.db, loaded.adminContext);
  check(config.household.name === fixture.household.name, "household name");
  check(
    config.members.length === fixture.members.length,
    `members ${String(config.members.length)}`,
  );
  for (const m of fixture.members) {
    const row = config.members.find((x) => x.id === loaded.members[m.key]);
    check(
      row?.displayName === m.displayName &&
        row.isTargeted === (m.targets !== undefined) &&
        row.appetite === m.appetite &&
        row.birthYear === (m.birthYear ?? null),
      `member ${m.key}`,
    );
    for (const kind of ["default", "training"] as const) {
      const want = m.targets?.[kind];
      const got = config.targetProfiles.find((t) => t.memberId === row?.id && t.kind === kind);
      check(
        want === undefined
          ? got === undefined
          : got !== undefined &&
              got.kcal === want.kcal &&
              got.proteinG === want.proteinG &&
              got.carbsG === want.carbsG &&
              got.fatG === want.fatG &&
              got.satFatMaxG === (want.satFatMaxG ?? null) &&
              got.solubleFibreMinG === (want.solubleFibreMinG ?? null),
        `${m.key} ${kind} targets`,
      );
    }
    const tolerance = config.tolerances.find((t) => t.memberId === row?.id);
    const wantTolerance = m.tolerance ?? {
      proteinG: 5,
      carbsG: 5,
      fatG: 2,
      kcal: 50,
      mode: "strict",
    };
    check(
      tolerance !== undefined &&
        tolerance.proteinG === wantTolerance.proteinG &&
        tolerance.carbsG === wantTolerance.carbsG &&
        tolerance.fatG === wantTolerance.fatG &&
        tolerance.kcal === wantTolerance.kcal &&
        tolerance.mode === wantTolerance.mode,
      `${m.key} tolerance`,
    );
    const training = config.trainingSchedules
      .filter((t) => t.memberId === row?.id)
      .map((t) => `${String(t.weekday)}@${String(t.sessionTime)}`)
      .sort();
    check(
      JSON.stringify(training) ===
        JSON.stringify(m.training.map((t) => `${String(t.weekday)}@${t.sessionTime}`).sort()),
      `${m.key} training days`,
    );
  }
  const active = config.slotTypes
    .filter((s) => s.active)
    .map((s) => s.key)
    .sort();
  check(
    JSON.stringify(active) ===
      JSON.stringify([...fixture.slots.active, ...fixture.slots.custom.map((s) => s.key)].sort()),
    `active slots ${active.join(",")}`,
  );
  const expectedScheduleRows = new Set(
    fixture.schedules.flatMap((s) =>
      s.weekdays.map((d) => `${s.member}/${s.slot}/${String(d)}=${String(s.attends)}`),
    ),
  );
  const memberKey = new Map(Object.entries(loaded.members).map(([k, v]) => [v, k]));
  const slotKey = new Map(Object.entries(loaded.slots).map(([k, v]) => [v, k]));
  const storedScheduleRows = new Set(
    config.memberSlotSchedules.map(
      (s) =>
        `${memberKey.get(s.memberId) ?? "?"}/${slotKey.get(s.slotTypeId) ?? "?"}/${String(s.weekday)}=${String(s.attends)}`,
    ),
  );
  check(
    JSON.stringify([...storedScheduleRows].sort()) ===
      JSON.stringify([...expectedScheduleRows].sort()),
    "attendance rows",
  );
  const cuisinePrefs = config.preferences
    .filter((p) => p.entityType === "cuisine" && p.memberId === null)
    .map((p) => `${p.entityKey}:${String(p.score)}`)
    .sort();
  check(
    JSON.stringify(cuisinePrefs) ===
      JSON.stringify(
        [
          ...fixture.cuisines.liked.map((k) => `${k}:0.5`),
          ...fixture.cuisines.disliked.map((k) => `${k}:-0.5`),
        ].sort(),
      ),
    "cuisine preferences",
  );
  check(
    config.exclusions.length === fixture.exclusions.length &&
      fixture.exclusions.every((e) =>
        config.exclusions.some(
          (x) =>
            x.key === e.key &&
            x.reason === e.reason &&
            x.hard &&
            x.memberId === (e.member === undefined ? null : loaded.members[e.member]),
        ),
      ),
    "exclusions",
  );
  check(config.weightPresets.length === fixture.presets.length, "presets");
  const logins = await repos.household_user.list();
  check(
    logins.length === fixture.users.length &&
      fixture.users.every((u) =>
        logins.some(
          (l) =>
            l.userId === loaded.users[u.key] &&
            l.role === u.role &&
            l.memberId === (u.member === undefined ? null : loaded.members[u.member]),
        ),
      ),
    "logins",
  );
  const dishes = (await repos.dish.list()).filter((d) => d.householdId === loaded.householdId);
  check(dishes.length === fixture.dishes.length, `dishes ${String(dishes.length)}`);
  const variants = fixture.dishes.flatMap((d) => d.components.flatMap((c) => c.variants)).length;
  check(
    (await repos.variant.list()).filter((v) => v.householdId === loaded.householdId).length ===
      variants,
    "variants",
  );
  const reviews = await repos.review.list();
  check(reviews.length === fixture.reviews.length, `reviews ${String(reviews.length)}`);
  check(
    (await repos.review_reaction.list()).length ===
      fixture.reviews.reduce((n, r) => n + r.reactions.length, 0),
    "review reactions",
  );
  check((await repos.change_set.list()).length === 2, "two change sets: setup and configuration");
  return problems;
}

describe("G6 fixtures F1, F2, F3 load", { timeout: 120_000 }, () => {
  it.each([
    ["F1", F1],
    ["F2", F2],
    ["F3", F3],
  ] as const)("%s loads and matches the fixture", async (_id, input) => {
    const loaded = await loadFixture(database.db, input);
    expect(await loadProblems(FixtureSchema.parse(input), loaded)).toEqual([]);
  });

  it("F1 stores the BLD-2 reference numbers and the C3 sesame allergy", async () => {
    const loaded = await loadFixture(database.db, {
      ...F1,
      id: "F1-again",
      users: F1.users.map((u) => ({ ...u, email: `again.${u.email}` })),
    });
    const config = await loadHouseholdConfig(database.db, loaded.adminContext);
    const a = config.targetProfiles.filter((t) => t.memberId === loaded.members.adult_a);
    expect(a.find((t) => t.kind === "default")).toMatchObject({
      kcal: 2150,
      proteinG: 180,
      carbsG: 200,
      fatG: 70,
      satFatMaxG: 22,
      solubleFibreMinG: 10,
    });
    expect(a.find((t) => t.kind === "training")).toMatchObject({
      kcal: 2390,
      proteinG: 180,
      carbsG: 260,
      fatG: 70,
    });
    expect(config.exclusions).toEqual([
      expect.objectContaining({
        memberId: loaded.members.c3,
        kind: "dietary_flag",
        key: "contains_sesame",
        reason: "allergy",
        hard: true,
      }),
    ]);
  });

  it("negative control: a fixture with an unknown catalogue key or a dangling reference is rejected and writes nothing", async () => {
    const households = async () =>
      must((await database.db.select({ n: count() }).from(household))[0]).n;
    const before = await households();
    await expect(
      loadFixture(database.db, {
        ...F2,
        id: "bad-cuisine",
        users: [
          { key: "solo", email: "bad@f2.example", name: "Bad", role: "admin", member: "solo" },
        ],
        cuisines: { liked: ["atlantean"], disliked: [] },
      }),
    ).rejects.toBeInstanceOf(FixtureError);
    await expect(
      loadFixture(database.db, {
        ...F2,
        id: "dangling",
        schedules: [{ member: "ghost", slot: "lunch", weekdays: [0], attends: true }],
      }),
    ).rejects.toBeInstanceOf(FixtureError);
    expect(await households()).toBe(before);
    // And the comparison itself detects a household that does not match its fixture.
    const loaded = await loadFixture(database.db, {
      ...F2,
      id: "F2-check",
      users: [
        { key: "solo", email: "check@f2.example", name: "Solo", role: "admin", member: "solo" },
      ],
    });
    const wrong = FixtureSchema.parse({
      ...F2,
      members: [
        {
          ...must(F2.members[0]),
          targets: { default: { kcal: 2100, proteinG: 150, carbsG: 200, fatG: 60 } },
        },
      ],
    });
    expect(await loadProblems(wrong, loaded)).toContain("solo default targets");
  });
});
