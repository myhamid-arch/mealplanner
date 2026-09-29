// Root R5 (SC-4) on a fresh compose stack (R-79, R-80), as node-1.3 N3 measures it. F1 is built
// through the stack's API; an admin chat turn through `POST /conversations/{id}/messages` makes the
// stack's agent call `apply_change` (recorded model turn); the change set is in the change log as
// the agent's, and `POST /change-sets/{id}/undo` restores the database exactly (the snapshot
// comparison of packages/db/test). Negative control: an undo whose stored inverse lacks one
// before-image leaves a difference, and only in that entity.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  changedTables,
  diffSnapshots,
  imageEntities,
  measure,
  NOT_COMPARED,
} from "../../../../packages/db/test/node/support";
import { snapshotDatabase } from "../../../../packages/db/test/support/snapshot";
import { loadRecordings, type RecordedModel } from "../node/recorded-model";
import { assertF1, buildF1, type F1Household } from "./f1-api";
import { appUrl, pool, recordedModel } from "./stack";

/** As node-1.3 N3: the tables a chat turn writes besides its change set. */
const TURN_TABLES = ["ai_generation", "chat_message", "conversation"];
const EXCLUDED = new Set([...NOT_COMPARED, ...TURN_TABLES]);
const SYNTHESIS = "insights.run: synthesis keeps the rule candidates as they are";
/** The recorded turns this gate uses: turn 2 (the change) and turn 3 (the control's change). */
const TURNS = [
  "turn 2: apply the change the admin asked for",
  "turn 2: confirm",
  "turn 3 (negative control): apply a second change",
  "turn 3: confirm",
];

let db: pg.Pool;
let model: RecordedModel;
let f1: F1Household;
let conversationId = "";
const snapshot = () => snapshotDatabase(db, EXCLUDED);
const fullSnapshot = () => snapshotDatabase(db, NOT_COMPARED);

beforeAll(async () => {
  db = pool();
  model = await recordedModel([]);
});

afterAll(async () => {
  await model.close();
  await db.end();
});

async function chat(text: string): Promise<string> {
  const res = await fetch(`${appUrl()}/api/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${f1.admin.token}`,
      "x-household-id": f1.householdId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  expect(res.status, body).toBe(200);
  return body;
}

async function changeLog(): Promise<
  { type: string; id: string; actor: string; source: string; undoneAt: string | null }[]
> {
  const r = await f1.adminApi("GET", "/change-sets?limit=200");
  expect(r.status).toBe(200);
  return (r.json as { entries: [] }).entries;
}

async function storedInverse(changeSetId: string): Promise<unknown[]> {
  const { rows } = await db.query<{ inverse: unknown[] }>(
    "SELECT inverse FROM change_set WHERE id = $1",
    [changeSetId],
  );
  return rows[0]?.inverse ?? [];
}

async function agentChangeSet(known: ReadonlySet<string>) {
  const entries = await changeLog();
  const fresh = entries.filter(
    (e) =>
      e.type === "change_set" && !known.has(e.id) && e.actor === "agent" && e.source === "agent_apply",
  );
  expect(fresh.length, JSON.stringify(entries.slice(0, 5))).toBe(1);
  return fresh[0];
}

describe("root SC-4 (compose stack)", () => {
  it("SC-4 set-up: F1 through the stack's API and a conversation", async () => {
    f1 = await buildF1("sc4");
    const compared = await assertF1(db, f1);
    model.add(
      loadRecordings("intelligence", {
        MEMBER_ID: f1.members.adult_b ?? "",
        CHILD_ID: f1.members.c1 ?? "",
        // Only turn 1 (not used here) names the dish.
        DISH_ID: "not-used-by-sc4",
      }).filter((r) => TURNS.includes(r.name) || r.name === SYNTHESIS),
    );
    const conv = await f1.adminApi("POST", "/conversations", { title: "root SC-4" });
    expect(conv.status).toBe(201);
    conversationId = (conv.json as { id: string }).id;
    measure({ check: "setup", compared });
  });

  it("SC-4 an agent apply_change is in the change log as the agent's and its undo restores the prior state exactly", async () => {
    const known = new Set((await changeLog()).map((e) => e.id));
    const before = await snapshot();
    const fullBefore = await fullSnapshot();
    await chat("Weigh appeal higher, please.");
    expect(model.failures, model.failures.join("\n")).toEqual([]);
    const entry = await agentChangeSet(known);
    const after = await snapshot();
    const entities = imageEntities(await storedInverse(entry?.id ?? ""));
    const turnWrites = changedTables(fullBefore, await fullSnapshot()).filter(
      (t) => !entities.includes(t),
    );
    const undo = await f1.adminApi("POST", `/change-sets/${entry?.id ?? ""}/undo`);
    expect(undo.status, JSON.stringify(undo.json)).toBe(200);
    const restored = await snapshot();
    const diff = diffSnapshots(before, restored);
    const undone = (await changeLog()).find((e) => e.id === entry?.id);
    measure({
      check: "sc4",
      changeSetId: entry?.id,
      actor: entry?.actor,
      source: entry?.source,
      changed: changedTables(before, after),
      entities,
      excluded: [...EXCLUDED],
      turnWrites,
      restoreDiff: diff.length,
      undone: undone?.undoneAt !== null,
    });
    expect(changedTables(before, after)).toContain("planning_weights");
    expect(entities.filter((e) => EXCLUDED.has(e))).toEqual([]);
    expect(turnWrites.every((t) => TURN_TABLES.includes(t))).toBe(true);
    expect(turnWrites).toContain("chat_message");
    expect(diff, diff.join("\n")).toEqual([]);
    expect(undone?.undoneAt).not.toBeNull();
  });

  it("SC-4 negative control: an undo that skips one before-image fails the equality check", async () => {
    const known = new Set((await changeLog()).map((e) => e.id));
    const before = await snapshot();
    await chat("Rename Child C1, please.");
    const entry = await agentChangeSet(known);
    const inverse = (await storedInverse(entry?.id ?? "")) as {
      payload: { images: { entity: string; before: unknown }[] };
    }[];
    let removed = 0;
    for (const op of inverse) {
      const i = op.payload.images.findIndex((x) => x.entity === "member" && x.before !== null);
      if (i !== -1) {
        op.payload.images.splice(i, 1);
        removed += 1;
        break;
      }
    }
    await db.query("UPDATE change_set SET inverse = $1::jsonb WHERE id = $2", [
      JSON.stringify(inverse),
      entry?.id,
    ]);
    const undo = await f1.adminApi("POST", `/change-sets/${entry?.id ?? ""}/undo`);
    expect(undo.status).toBe(200);
    const diff = diffSnapshots(before, await snapshot());
    const onlyMember = diff.every((line) => line.startsWith("member "));
    measure({ check: "sc4-control", removed, restoreDiff: diff.length, onlyMember });
    expect(removed).toBe(1);
    expect(diff.length).toBeGreaterThan(0);
    expect(onlyMember, diff.join("\n")).toBe(true);
  });

  it("SC-4 the recorded model answered every request, and no live call was made", () => {
    const syntheses = model.answered.get(SYNTHESIS) ?? 0;
    measure({
      check: "model",
      requests: model.requests.length,
      failures: model.failures,
      remaining: model.remaining(),
    });
    expect(model.failures, model.failures.join("\n")).toEqual([]);
    expect(model.remaining()).toEqual([]);
    expect(model.requests.length).toBe(TURNS.length + syntheses);
  });
});
