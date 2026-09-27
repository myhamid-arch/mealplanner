// Leaf 1.4.10 G3 (W-14, R2-ADM-7, ChangeLog mockup): through `GET /change-sets`, each entry names
// what it changed, and scalar changes carry before → after (`detail`), resolved when the log is
// read from the ops and their before-images. A change set stored as raw rows (no new column, no
// migration) resolves the same way; an entry whose subject no longer exists falls back to its
// stored summary. Negative controls: two blocks of different logins read differently, and the
// title-only rendering (the stored summary) fails the same checks.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { newId } from "@mealplanner/db/schema";
import { DESCRIBED_OP_KINDS } from "../../lib/server/changes";
import { callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { acceptWithSignup, addMembers, invite, ok, signupAdmin, type Login } from "./support/world";

type Change = { label: string; before: string | null; after: string | null };
type Entry = {
  type: "change_set" | "support_view";
  id: string;
  summary: string;
  undoneAt: string | null;
  undo: { available: boolean; reason: string | null };
  detail?: { title: string; subject: string; changes: Change[] };
};

let db: TestDatabase;
let app: TestApp;
let admin: Login & { householdId: string };
let sara: string;
let zayd: string;
let priya: Login;
let ravi: Login;
let omar: Login;
const ids: Record<string, string> = {};

async function log(caller: Caller = admin): Promise<Entry[]> {
  return ok<{ entries: Entry[] }>(
    await callJson(c.changeSetsList, { query: { limit: 200 } }, caller),
    "change log",
  ).entries;
}

async function apply(summary: string, ops: unknown[]): Promise<string> {
  const r = await callJson(c.changeSetsApply, { body: { summary, ops } }, admin);
  return ok<{ changeSetId: string }>(r, summary).changeSetId;
}

async function latestChangeSet(): Promise<string> {
  const rows = await app.rt.db.execute(
    sql`SELECT id FROM change_set WHERE household_id = ${admin.householdId} ORDER BY applied_at DESC LIMIT 1`,
  );
  const id = (rows.rows[0] as { id: string } | undefined)?.id;
  if (id === undefined) throw new Error("no change set");
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  admin = await signupAdmin("Khalifa");
  ({ adultId: sara, childId: zayd } = await addMembers(admin));
  priya = await acceptWithSignup(await invite(admin, "kitchen", null), "Priya");
  ravi = await acceptWithSignup(await invite(admin, "kitchen", null), "Ravi");
  omar = await acceptWithSignup(await invite(admin, "member", null), "Omar");

  const block = async (who: Login) => {
    ok(await callJson(c.accessBlock, { params: { userId: who.userId }, body: {} }, admin), "block");
    return latestChangeSet();
  };
  ids.blockPriya = await block(priya);
  ids.blockRavi = await block(ravi);
  ok(
    await callJson(
      c.accessRole,
      { params: { userId: omar.userId }, body: { role: "kitchen" } },
      admin,
    ),
    "role",
  );
  ids.role = await latestChangeSet();
  ids.target = await apply("Targets", [
    {
      kind: "target.set",
      payload: {
        memberId: sara,
        kind: "default",
        profile: { kcal: 2190, proteinG: 190, carbsG: 200, fatG: 70 },
      },
    },
  ]);
  ids.tolerance = await apply("Tolerance", [
    { kind: "tolerance.set", payload: { memberId: sara, proteinG: 8 } },
  ]);
  ids.settings = await apply("Household settings", [
    { kind: "household.update", payload: { timezone: "Europe/London" } },
  ]);
  ids.weights = await apply("Planning", [{ kind: "weights.set", payload: { appeal: 0.8 } }]);
  ids.member = await apply("Member", [
    { kind: "member.update", payload: { memberId: zayd, appetite: "large" } },
  ]);
  ok(await callJson(c.changeSetsUndo, { params: { id: ids.weights } }, admin), "undo");
  ids.undo = await latestChangeSet();

  // Dates (CP3 finding 4): a resolved title with a date, and a stored summary with two.
  ids.override = await apply("Training day", [
    {
      kind: "day_override.set",
      payload: { memberId: sara, date: `${String(YEAR)}-12-14`, kind: "training", active: true },
    },
  ]);
  ids.dated = newId();
  await app.rt.db.execute(
    sql`INSERT INTO change_set (id, household_id, actor, actor_user_id, source, summary, forward, inverse, applied_at)
        VALUES (${ids.dated}, ${admin.householdId}, 'system', NULL, 'learning',
                ${`Re-solve plates from ${String(YEAR)}-09-27 to ${String(YEAR + 1)}-01-03`},
                '[]'::jsonb, '[]'::jsonb, '2026-01-03T00:00:00Z')`,
  );

  // A member added and then taken away again: its subject no longer exists.
  const temp = newId();
  ids.vanished = await apply("Add Temp", [
    {
      kind: "member.create",
      payload: { id: temp, displayName: "Temp", color: "tomato", isTargeted: false },
    },
  ]);
  ok(await callJson(c.changeSetsUndo, { params: { id: ids.vanished } }, admin), "undo temp");

  // A change set written as raw rows, as any stored before this leaf: a block of Priya with the
  // stored summary "Block login" and the before-image of her login (kitchen, active).
  ids.raw = newId();
  const image = JSON.stringify([
    {
      kind: "rows.restore",
      payload: {
        images: [
          {
            entity: "household_user",
            key: { householdId: admin.householdId, userId: priya.userId },
            before: { householdId: admin.householdId, userId: priya.userId, role: "kitchen" },
          },
        ],
      },
    },
  ]);
  await app.rt.db.execute(
    sql`INSERT INTO change_set (id, household_id, actor, actor_user_id, source, summary, forward, inverse, applied_at)
        VALUES (${ids.raw}, ${admin.householdId}, 'user', ${admin.userId}, 'ui', 'Block login',
                ${JSON.stringify([{ kind: "access.block", payload: { userId: priya.userId } }])}::jsonb,
                ${image}::jsonb, '2026-01-01T00:00:00Z')`,
  );
  // And one naming a login that does not exist.
  ids.ghost = newId();
  await app.rt.db.execute(
    sql`INSERT INTO change_set (id, household_id, actor, actor_user_id, source, summary, forward, inverse, applied_at)
        VALUES (${ids.ghost}, ${admin.householdId}, 'user', ${admin.userId}, 'ui', 'Block login',
                ${JSON.stringify([{ kind: "access.block", payload: { userId: newId() } }])}::jsonb,
                '[]'::jsonb, '2026-01-02T00:00:00Z')`,
  );
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

// ------------------------------------------------------------------------------------------------
// The checks, run on a rendering of the entries (as the change-log screen renders the title)
// ------------------------------------------------------------------------------------------------

/** The household's current year: signup keeps the default time zone, where it is this year. */
const YEAR = new Date().getUTCFullYear();
const readable = (iso: string, withYear = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }) + (withYear ? ` ${iso.slice(0, 4)}` : "");
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

type Render = (e: Entry) => string;
/** The change-log screen's title: the resolved title, or the stored summary. */
const SCREEN: Render = (e) => e.detail?.title ?? e.summary;
/** Negative control: the pre-leaf title-only rendering. */
const TITLE_ONLY: Render = (e) => e.summary;

function problems(entries: Entry[], render: Render): string[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const title = (key: string) => {
    const e = byId.get(ids[key] ?? "");
    return e === undefined ? `(missing ${key})` : render(e);
  };
  const out: string[] = [];
  const expectTitle = (key: string, want: string | RegExp) => {
    const got = title(key);
    if (typeof want === "string" ? got !== want : !want.test(got))
      out.push(`${key}: "${got}" is not ${String(want)}`);
  };
  expectTitle("blockPriya", "Blocked Priya (kitchen)");
  expectTitle("blockRavi", "Blocked Ravi (kitchen)");
  if (title("blockPriya") === title("blockRavi")) out.push("the two blocks read the same");
  expectTitle("role", "Omar's role member → kitchen");
  expectTitle("target", "Sara's protein target 180 → 190 g");
  expectTitle("tolerance", "Sara's per-meal protein tolerance ±5 → ±8 g");
  expectTitle("settings", /^Household settings: time zone \S+ → Europe\/London$/);
  expectTitle("weights", /^Planning balance: appeal [\d.]+ → 0\.8$/);
  expectTitle("undo", /^Undo: Planning balance: appeal [\d.]+ → 0\.8$/);
  expectTitle("member", "Zayd: appetite medium → large");
  expectTitle("raw", "Blocked Priya (kitchen)");
  return out;
}

describe("W-14 change-log subjects", () => {
  let entries: Entry[];
  beforeAll(async () => {
    entries = await log();
  });

  it("each entry names its subject and, for scalar fields, before → after", () => {
    expect(problems(entries, SCREEN)).toEqual([]);
  });

  it("the target change carries the mockup's chips: protein and calories, before and after", () => {
    const e = entries.find((x) => x.id === ids.target);
    expect(e?.detail?.subject).toBe("Sara");
    expect(e?.detail?.changes).toEqual([
      { label: "protein", before: "180 g", after: "190 g" },
      { label: "calories", before: "2150 kcal", after: "2190 kcal" },
    ]);
  });

  it("the settings change and the undo carry before → after (the undo reversed)", () => {
    const settings = entries.find((x) => x.id === ids.settings)?.detail?.changes[0];
    expect(settings?.label).toBe("time zone");
    expect(settings?.after).toBe("Europe/London");
    expect(settings?.before).not.toBe("Europe/London");
    const weights = entries.find((x) => x.id === ids.weights)?.detail?.changes[0];
    const undo = entries.find((x) => x.id === ids.undo)?.detail?.changes[0];
    expect(undo).toEqual({ label: "appeal", before: weights?.after, after: weights?.before });
  });

  it("a change set stored as raw rows resolves from its JSON alone (no migration)", () => {
    const raw = entries.find((x) => x.id === ids.raw);
    expect(raw?.summary).toBe("Block login");
    expect(raw?.detail?.title).toBe("Blocked Priya (kitchen)");
  });

  it("an undo blocked by a later change names that change by its resolved title", () => {
    // The raw block (dated earlier) conflicts with the later block of the same login.
    const raw = entries.find((x) => x.id === ids.raw);
    expect(raw?.undo.available).toBe(false);
    expect(raw?.undo.reason).toContain('"Blocked Priya (kitchen)"');
    expect(raw?.undo.reason).not.toContain('"Block login"');
  });

  it('dates read as the mockup writes them: "Mon 28 Sep", with the year only when not this one', () => {
    const override = entries.find((x) => x.id === ids.override);
    expect(override?.detail?.title).toBe(
      `Sara: a training day on ${readable(`${String(YEAR)}-12-14`)}`,
    );
    const dated = entries.find((x) => x.id === ids.dated);
    expect(dated?.detail).toBeUndefined();
    expect(dated?.summary).toBe(
      `Re-solve plates from ${readable(`${String(YEAR)}-09-27`)} to ${readable(`${String(YEAR + 1)}-01-03`, true)}`,
    );
    const shown = entries.flatMap((e) => [
      SCREEN(e),
      e.detail?.subject ?? "",
      e.undo.reason ?? "",
      ...(e.detail?.changes ?? []).flatMap((c) => [c.before ?? "", c.after ?? ""]),
    ]);
    expect(shown.filter((t) => ISO_DATE.test(t))).toEqual([]);
  });

  it("negative control: the stored summary, as the log showed it before, has an ISO date", async () => {
    const rows = await app.rt.db.execute(
      sql`SELECT summary FROM change_set WHERE id = ${ids.dated ?? ""}`,
    );
    expect(ISO_DATE.test((rows.rows[0] as { summary: string }).summary)).toBe(true);
  });

  it("a vanished subject renders with the stored title and no detail", () => {
    for (const key of ["vanished", "ghost"]) {
      const e = entries.find((x) => x.id === ids[key]);
      expect(e).toBeDefined();
      expect(e?.detail).toBeUndefined();
      expect(SCREEN(e as Entry)).toBe(e?.summary);
    }
  });

  it("multi-subject change sets keep their stored summary", () => {
    // addMembers: two members and a target in one change set.
    const setup = entries.find((x) => x.summary === "test setup");
    expect(setup).toBeDefined();
    expect(setup?.detail).toBeUndefined();
  });

  it("negative control: two blocks of different logins have the same stored summary", () => {
    const [p, r] = [ids.blockPriya, ids.blockRavi].map((id) => entries.find((x) => x.id === id));
    expect(p?.summary).toBe(r?.summary);
    expect(p?.detail?.title).not.toBe(r?.detail?.title);
  });

  it("negative control: the title-only rendering fails the same checks", () => {
    const found = problems(entries, TITLE_ONLY);
    expect(found).toContain("the two blocks read the same");
    expect(found.length).toBeGreaterThanOrEqual(9);
  });

  it("the resolved op kinds (coverage listed for the architect)", () => {
    process.stdout.write(`described op kinds: ${DESCRIBED_OP_KINDS.join(", ")}\n`);
    expect(DESCRIBED_OP_KINDS).toEqual(
      expect.arrayContaining([
        "access.block",
        "role.set",
        "household.update",
        "target.set",
        "tolerance.set",
        "weights.set",
        "member.update",
      ]),
    );
  });

  it("another household's admin sees none of these entries", async () => {
    const other = await signupAdmin("Other");
    const theirs = await log(other);
    expect(theirs.filter((e) => Object.values(ids).includes(e.id))).toEqual([]);
  });
});
