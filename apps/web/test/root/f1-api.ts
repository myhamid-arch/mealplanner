// F1 through the running stack (SPEC-Q-1): the household and its admin from `POST /signup`, its
// configuration from `POST /change-sets` with the ops `loadFixture` builds from F1
// (packages/db/src/services/config/fixtures.ts), and the other logins through invites bound to
// their role and member. No SQL writes anything.
//
// `f1Differences` then compares the stored configuration with an oracle: `loadFixture(F1)` in a
// throwaway database of the same PostgreSQL server (migrated and seeded, then dropped), with ids,
// timestamps and emails replaced by natural keys. The oracle never touches the stack's database.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { ChangeOp } from "@mealplanner/core/changes";
import { DEFAULT_SLOTS, FixtureSchema, type HouseholdContext } from "@mealplanner/core/types";
import { newId } from "@mealplanner/db/schema";
import { migrateAndSeed } from "@mealplanner/db/seed";
import { loadFixture, loadHouseholdConfig } from "@mealplanner/db/services/config";
import { F1 as F1_INPUT } from "../../../../packages/core/dist/test/fixtures/index.js";
import { acceptInvite, apiAs, dbUrl, signup, type SignedUp } from "./stack";
import type { Api } from "../node/support";

/** F1 as `loadFixture` reads it: parsed, with the schema's defaults. */
const F1 = FixtureSchema.parse(F1_INPUT);

export interface F1Household {
  householdId: string;
  admin: SignedUp;
  adminApi: Api;
  /** Logins by F1 user key (adult_a, adult_b, c1, kitchen). */
  logins: Record<string, SignedUp>;
  /** Member ids by F1 member key. */
  members: Record<string, string>;
  slots: Record<string, string>;
  ctx: HouseholdContext;
}

async function ok(call: Api, method: string, path: string, body: unknown, status: number) {
  const r = await call(method, path, body);
  if (r.status !== status)
    throw new Error(`${method} ${path}: ${String(r.status)} ${JSON.stringify(r.json)}`);
  return r.json;
}

/** The ops of `loadFixture`'s one change set for F1 (F1 has no custom slots, presets or dishes). */
function f1Ops(
  members: Record<string, string>,
  slots: Record<string, string>,
  adminUserId: string,
): ChangeOp[] {
  const ops: ChangeOp[] = [];
  const member = (key: string) => {
    const id = members[key];
    if (id === undefined) throw new Error(`unknown member ${key}`);
    return id;
  };
  const slot = (key: string) => {
    const id = slots[key];
    if (id === undefined) throw new Error(`unknown slot ${key}`);
    return id;
  };
  for (const m of F1.members) {
    const memberId = member(m.key);
    ops.push({
      kind: "member.create",
      payload: {
        id: memberId,
        displayName: m.displayName,
        color: m.color,
        birthYear: m.birthYear ?? null,
        sex: m.sex ?? null,
        isTargeted: m.targets !== undefined,
        appetite: m.appetite,
      },
    } as ChangeOp);
    if (m.targets !== undefined) {
      ops.push({
        kind: "target.set",
        payload: { memberId, kind: "default", profile: m.targets.default },
      } as ChangeOp);
      if (m.targets.training !== undefined)
        ops.push({
          kind: "target.set",
          payload: { memberId, kind: "training", profile: m.targets.training },
        } as ChangeOp);
    }
    if (m.tolerance !== undefined)
      ops.push({ kind: "tolerance.set", payload: { memberId, ...m.tolerance } } as ChangeOp);
    if (m.training.length > 0)
      ops.push({
        kind: "training.set",
        payload: {
          memberId,
          days: m.training.map((d) => ({
            weekday: d.weekday,
            sessionTime: d.sessionTime,
            intensity: d.intensity ?? null,
          })),
        },
      } as ChangeOp);
  }
  const active = new Set<string>(F1.slots.active);
  for (const s of DEFAULT_SLOTS)
    if (s.active !== active.has(s.key))
      ops.push({
        kind: "slot.update",
        payload: { slotTypeId: slot(s.key), active: active.has(s.key) },
      } as ChangeOp);
  for (const s of F1.schedules)
    ops.push({
      kind: "slot_schedule.set",
      payload: {
        memberId: member(s.member),
        slotTypeId: slot(s.slot),
        days: s.weekdays.map((weekday) => ({ weekday, attends: s.attends })),
      },
    } as ChangeOp);
  for (const [keys, score] of [
    [F1.cuisines.liked, 0.5],
    [F1.cuisines.disliked, -0.5],
  ] as const)
    for (const key of keys)
      ops.push({
        kind: "preference.set",
        payload: { memberId: null, entityType: "cuisine", entityKey: key, score, source: "explicit" },
      } as ChangeOp);
  for (const e of F1.exclusions)
    ops.push({
      kind: "exclusion.add",
      payload: {
        memberId: e.member === undefined ? null : member(e.member),
        kind: e.kind,
        key: e.key,
        reason: e.reason,
        hard: true,
      },
    } as ChangeOp);
  const adminKey = F1.users.find((u) => u.role === "admin")?.member;
  if (adminKey !== undefined)
    ops.push({
      kind: "access.link_member",
      payload: { userId: adminUserId, memberId: member(adminKey) },
    } as ChangeOp);
  return ops;
}

/** Tagged emails, so several F1 households can share one stack. */
function tagged(email: string, tag: string): string {
  const [local, domain] = email.split("@");
  return `${local ?? "x"}+${tag}@${domain ?? "f1.example"}`;
}

/** Builds F1 through the stack's API. `tag` keeps the logins' emails unique per household. */
export async function buildF1(tag: string): Promise<F1Household> {
  const adminUser = F1.users.find((u) => u.role === "admin");
  if (adminUser === undefined) throw new Error("F1 has no admin");
  const admin = await signup(tagged(adminUser.email, tag), adminUser.name, F1.household.name);
  const adminApi = apiAs(admin);
  if (F1.household.regionNote !== undefined)
    await ok(
      adminApi,
      "POST",
      "/change-sets",
      {
        summary: "F1 region",
        ops: [{ kind: "household.update", payload: { regionNote: F1.household.regionNote } }],
      },
      201,
    );
  const slotList = (await ok(adminApi, "GET", "/slots", undefined, 200)) as {
    slots: { id: string; key: string }[];
  };
  const slots = Object.fromEntries(slotList.slots.map((s) => [s.key, s.id]));
  // Ids from the product's own generator (UUIDv7, increasing): members keep F1's order.
  const members: Record<string, string> = {};
  for (const m of F1.members) members[m.key] = newId();
  await ok(
    adminApi,
    "POST",
    "/change-sets",
    { summary: `Fixture ${F1.id} configuration`, ops: f1Ops(members, slots, admin.userId) },
    201,
  );
  const logins: Record<string, SignedUp> = { [adminUser.key]: admin };
  for (const u of F1.users) {
    if (u.key === adminUser.key) continue;
    const invite = (await ok(
      adminApi,
      "POST",
      "/invites",
      { role: u.role, memberId: u.member === undefined ? null : members[u.member] },
      201,
    )) as { code: string };
    logins[u.key] = await acceptInvite(invite.code, tagged(u.email, tag), u.name);
  }
  return {
    householdId: admin.householdId,
    admin,
    adminApi,
    logins,
    members,
    slots,
    ctx: { householdId: admin.householdId, userId: null, role: "system" },
  };
}

const DROPPED = new Set(["id", "householdId", "createdAt", "updatedAt", "createdBy"]);

/** A configuration with ids, household and timestamps replaced by natural keys, arrays sorted. */
function canonical(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return names.get(value) ?? value;
  if (value instanceof Date) return "<time>";
  if (Array.isArray(value))
    return value
      .map((v) => canonical(v, names))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !DROPPED.has(k) && !k.endsWith("At"))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v, names)]),
    );
  return value;
}

export async function canonicalHousehold(db: pg.Pool, householdId: string) {
  const ctx: HouseholdContext = { householdId, userId: null, role: "system" };
  const cfg = await loadHouseholdConfig(drizzle(db), ctx);
  const { rows: logins } = await db.query<{
    user_id: string;
    name: string;
    role: string;
    status: string;
    member_id: string | null;
  }>(
    `SELECT hu.user_id, u.name, hu.role::text, hu.status::text, hu.member_id
       FROM household_user hu JOIN "user" u ON u.id = hu.user_id
      WHERE hu.household_id = $1`,
    [householdId],
  );
  const names = new Map<string, string>([[householdId, "<household>"]]);
  for (const m of cfg.members) names.set(m.id, `member:${m.displayName}`);
  for (const s of cfg.slotTypes) names.set(s.id, `slot:${s.key}`);
  for (const l of logins) names.set(l.user_id, `user:${l.name}`);
  return {
    config: canonical(cfg, names),
    logins: canonical(
      logins.map((l) => ({ user: l.user_id, role: l.role, status: l.status, member: l.member_id })),
      names,
    ),
  };
}

/** Paths where two canonical values differ. */
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`),
    );
  }
  return [`${path || "."}: API ${JSON.stringify(a)?.slice(0, 300)} vs fixture ${JSON.stringify(b)?.slice(0, 300)}`];
}

/**
 * The API-built household against `loadFixture(F1)` in a throwaway database on the same server:
 * configuration and logins, by natural key. Returns the differing paths (none when they match)
 * and what was compared.
 */
export async function f1Differences(
  stackDb: pg.Pool,
  householdId: string,
): Promise<{ differences: string[]; compared: Record<string, number> }> {
  const serverUrl = new URL(dbUrl());
  const oracleName = `root_f1_oracle_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
  const admin = new pg.Client({ connectionString: serverUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${oracleName}"`);
  const oracleUrl = new URL(serverUrl.toString());
  oracleUrl.pathname = `/${oracleName}`;
  const oracle = new pg.Pool({ connectionString: oracleUrl.toString(), max: 2 });
  try {
    await migrateAndSeed(oracleUrl.toString());
    const fixture = await loadFixture(drizzle(oracle), F1_INPUT);
    const api = await canonicalHousehold(stackDb, householdId);
    const want = await canonicalHousehold(oracle, fixture.householdId);
    const cfg = api.config as Record<string, unknown[]>;
    return {
      differences: [
        ...differences(api.config, want.config, "config"),
        ...differences(api.logins, want.logins, "logins"),
      ],
      compared: Object.fromEntries(
        Object.entries(cfg).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]),
      ),
    };
  } finally {
    await oracle.end();
    await admin.query(`DROP DATABASE IF EXISTS "${oracleName}" WITH (FORCE)`);
    await admin.end();
  }
}

/** The set-up check every root test runs after `buildF1`: `f1Differences` is empty. */
export async function assertF1(stackDb: pg.Pool, f1: F1Household): Promise<Record<string, number>> {
  const r = await f1Differences(stackDb, f1.householdId);
  if (r.differences.length > 0)
    throw new Error(`the API-built F1 differs from loadFixture(F1):\n${r.differences.join("\n")}`);
  return r.compared;
}
