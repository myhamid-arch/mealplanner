// node-1.1 N3, HTTP path (R-69): after the service test migrated the gate's database and seeded the
// catalogue and F1, the same change set goes through `POST /api/v1/change-sets` and
// `POST /api/v1/change-sets/{id}/undo` of the built web app (`next start`) as F1's admin; every
// compared table must equal its pre-apply snapshot. Negative control: the same undo with one
// before-image removed from the stored inverse fails the equality check.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HouseholdContext } from "@mealplanner/core/types";
import { foundationOps } from "../../../../packages/db/test/node/foundation-ops";
import {
  changedTables,
  diffSnapshots,
  imageEntities,
  measure,
  NOT_COMPARED,
  openDatabase,
  snapshot,
  type NodeDatabase,
} from "../../../../packages/db/test/node/support";
import { api, requiredEnv, signIn, startBuiltApp, type Api, type BuiltApp } from "./support";

const F1_ADMIN = "adult.a@f1.example";

let database: NodeDatabase;
let app: BuiltApp;
let call: Api;
let ctx: HouseholdContext;

beforeAll(async () => {
  database = openDatabase(requiredEnv("NODE_DB_URL"));
  app = await startBuiltApp(database.url);
  const login = await signIn(app, database.url, F1_ADMIN);
  call = api(app, login);
  ctx = { householdId: login.householdId, userId: login.userId, role: "admin" };
});

afterAll(async () => {
  await app.stop();
  await database.close();
});

async function storedInverse(changeSetId: string): Promise<unknown[]> {
  const { rows } = await database.pool.query<{ inverse: unknown[] }>(
    "SELECT inverse FROM change_set WHERE id = $1",
    [changeSetId],
  );
  return rows[0]?.inverse ?? [];
}

async function applyAndUndo(tag: string, tamper?: (inverse: unknown[]) => unknown[]) {
  const set = await foundationOps(database.db, ctx, tag);
  // Every authenticated request records the login's last activity at most once per 5 minutes
  // (household_user.last_active_at, R2-ADM-3). One request before the snapshot takes that write out
  // of the window, so the comparison stays full-row: a slower run fails, never passes wrongly.
  expect((await call("GET", "/change-sets")).status).toBe(200);
  const before = await snapshot(database.pool);
  const applied = await call("POST", "/change-sets", { summary: set.summary, ops: set.ops });
  expect(applied.status, JSON.stringify(applied.json)).toBe(201);
  const changeSetId = (applied.json as { changeSetId: string }).changeSetId;
  const after = await snapshot(database.pool);
  const inverse = await storedInverse(changeSetId);
  if (tamper !== undefined)
    await database.pool.query("UPDATE change_set SET inverse = $1::jsonb WHERE id = $2", [
      JSON.stringify(tamper(inverse)),
      changeSetId,
    ]);
  const undone = await call("POST", `/change-sets/${changeSetId}/undo`);
  expect(undone.status, JSON.stringify(undone.json)).toBe(200);
  const restored = await snapshot(database.pool);
  return {
    set,
    changeSetId,
    undoId: (undone.json as { changeSetId: string }).changeSetId,
    entities: imageEntities(inverse),
    changed: changedTables(before, after),
    restoreDiff: diffSnapshots(before, restored),
  };
}

function withoutOneMemberImage(inverse: unknown[]): unknown[] {
  const copy = structuredClone(inverse) as {
    payload: { images: { entity: string; before: unknown }[] };
  }[];
  for (const op of copy) {
    const index = op.payload.images.findIndex((i) => i.entity === "member" && i.before !== null);
    if (index !== -1) {
      op.payload.images.splice(index, 1);
      break;
    }
  }
  return copy;
}

describe("node-1.1 N3 foundation (HTTP, built app)", () => {
  it("N3 HTTP: the change set applied and undone through the API restores every table exactly", async () => {
    const r = await applyAndUndo("http");
    expect(r.changed).toEqual(expect.arrayContaining(r.set.expectChanged));
    expect(r.entities.filter((e) => NOT_COMPARED.has(e))).toEqual([]);
    expect(r.restoreDiff, r.restoreDiff.join("\n")).toEqual([]);
    const log = await call("GET", "/change-sets");
    expect(log.status).toBe(200);
    const listed = JSON.stringify(log.json);
    expect(listed).toContain(r.changeSetId);
    expect(listed).toContain(r.undoId);
    measure({
      check: "http",
      ops: r.set.ops.map((o) => o.kind),
      changed: r.changed,
      entities: r.entities,
      restoreDiff: r.restoreDiff.length,
    });
  });

  it("N3 HTTP negative control: an undo that skips one before-image fails the equality check", async () => {
    const r = await applyAndUndo("http-control", withoutOneMemberImage);
    expect(r.restoreDiff.length).toBeGreaterThan(0);
    expect(r.restoreDiff.every((line) => line.startsWith("member "))).toBe(true);
    measure({ check: "http-control", restoreDiff: r.restoreDiff.length });
  });
});
