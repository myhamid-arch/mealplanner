// Root R3 (SC-2) on a fresh compose stack (R-79, R-80). Seeds 1–10 of F1's week at economy 0.4 and
// at 0 (every other setting unchanged), each in its own API-built F1 household of the one stack
// (SPEC-Q-2), run by the stack's worker container. SC-2 is node-1.2 N3's measure
// (engine-measure.ts `coreIngredients`, `sc2Aggregate`): median reduction ≥ 8 %, every seed ≥ 0 %.
// A 21st household repeats seed 1 at 0.4 and must persist the same plan as the first, so sharing
// one database biases nothing. Negative control: SC-2 measured against itself (0 %) fails.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { measure } from "../../../../packages/db/test/node/support";
import type { RecordedModel } from "../node/recorded-model";
import { coreIngredients, sc2Aggregate } from "../node/engine-measure";
import { assertF1, canonicalHousehold } from "./f1-api";
import { ECONOMY, F1_WEEK, finishRun, planOf, queueRun, type Run } from "./engine-runs";
import { pool, recordedModel } from "./stack";

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);

let db: pg.Pool;
let model: RecordedModel;
const runs: Run[] = [];
let repeat: Run;

beforeAll(async () => {
  db = pool(6);
  model = await recordedModel([]);
});

afterAll(async () => {
  await model.close();
  await db.end();
});

const find = (seed: number, economy: number) => {
  const r = runs.find((x) => x.seed === seed && x.economy === economy);
  if (r === undefined) throw new Error(`no run for seed ${String(seed)} economy ${String(economy)}`);
  return r;
};

describe("root SC-2 (compose stack)", () => {
  it("SC-2 21 API-built F1 households (seeds 1–10 × economy 0.4 and 0, and seed 1 again) planned by the stack's worker", async () => {
    const plan = [
      ...SEEDS.flatMap((seed) => [ECONOMY, 0].map((economy) => ({ seed, economy }))),
      { seed: 1, economy: ECONOMY },
    ];
    // Households are built one at a time; the worker takes the queued jobs in turn.
    const queued = [];
    for (const [i, p] of plan.entries())
      queued.push(await queueRun(`sc2r${String(i)}`, p.seed, p.economy));
    const first = queued[0];
    if (first === undefined) throw new Error("nothing queued");
    const compared = await assertF1(db, first.f1);
    // Every other household's stored configuration equals the first's, by natural key.
    const want = JSON.stringify(await canonicalHousehold(db, first.f1.householdId));
    const differing = [];
    for (const q of queued.slice(1))
      if (JSON.stringify(await canonicalHousehold(db, q.f1.householdId)) !== want)
        differing.push(q.f1.householdId);
    expect(differing).toEqual([]);
    const done: Run[] = [];
    for (const q of queued) done.push(await finishRun(db, q));
    runs.push(...done.slice(0, 20));
    repeat = done[20] as Run;
    measure({
      check: "runs",
      runs: done.length,
      compared,
      households: queued.length,
      seconds: done.map((r) => r.seconds),
    });
    expect(runs.length).toBe(20);
  });

  it("SC-2 seed 1 repeated in another household persists the same plan", async () => {
    const a = await planOf(db, find(1, ECONOMY));
    const b = await planOf(db, repeat);
    const differing = a.filter((m, i) => JSON.stringify(m) !== JSON.stringify(b[i]));
    measure({ check: "repeat", meals: a.length, differing: differing.length });
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    expect(differing).toEqual([]);
  });

  it("SC-2 over seeds 1–10 through the stack's job path: median ≥ 8 %, every seed ≥ 0 %", async () => {
    const perSeed = [];
    for (const seed of SEEDS) {
      const count = async (economy: number) => {
        const r = find(seed, economy);
        return (await coreIngredients(db, r.f1.householdId, F1_WEEK)).length;
      };
      const economy = await count(ECONOMY);
      const baseline = await count(0);
      perSeed.push({ seed, economy, baseline, reduction: 1 - economy / baseline });
    }
    const agg = sc2Aggregate(perSeed.map((s) => s.reduction));
    measure({ check: "sc2", perSeed, ...agg });
    expect(perSeed.every((s) => s.baseline > 0)).toBe(true);
    expect(agg.pass).toBe(true);
  });

  it("SC-2 negative control: SC-2 measured against itself (0 %) fails", async () => {
    const perSeed = [];
    for (const seed of SEEDS) {
      const r = find(seed, 0);
      const n = (await coreIngredients(db, r.f1.householdId, F1_WEEK)).length;
      perSeed.push(1 - n / n);
    }
    const self = sc2Aggregate(perSeed);
    measure({ check: "sc2-control", self });
    expect(self.pass).toBe(false);
  });

  it("SC-2 the recorded model received no request it could not answer", () => {
    measure({ check: "model", requests: model.requests.length, failures: model.failures });
    expect(model.failures).toEqual([]);
  });
});
