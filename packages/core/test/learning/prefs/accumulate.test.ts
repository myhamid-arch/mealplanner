import { describe, expect, it } from "vitest";
import {
  accumulate,
  learningPreferenceOps,
  retract,
  type Contribution,
} from "../../../src/learning/preferences/index.js";
import { applyPreferenceSets, must, pref } from "./helpers.js";

const c = (weight: number, signal: number, entityKey = "d1"): Contribution => ({
  entityType: "dish",
  entityKey,
  weight,
  signal,
});

describe("FBK-4 score with shrinkage k = 2", () => {
  it("score = Σ(w·s) / (Σw + k): one full-weight review moves a score at most 1/3 of the way", () => {
    expect(accumulate(null, [c(1, -1)])).toEqual({ score: -0.333, evidenceWeight: 1 });
    expect(accumulate(null, [c(1, 1)])).toEqual({ score: 0.333, evidenceWeight: 1 });
  });

  it("two 1★ reviews give −2 / (2 + 2) = −0.5, whether applied together or one at a time", () => {
    expect(accumulate(null, [c(1, -1), c(1, -1)])).toEqual({ score: -0.5, evidenceWeight: 2 });
    const once = accumulate(null, [c(1, -1)]);
    expect(accumulate(once, [c(1, -1)])).toEqual({ score: -0.5, evidenceWeight: 2 });
  });

  it("G2 incremental updates equal the closed form Σ(w·s) / (Σw + 2) over many reviews", () => {
    const weights = [1, 0.3, 0.075, 0.5];
    const history = Array.from({ length: 40 }, (_, i) => c(must(weights[i % 4]), (i % 5) / 2 - 1));
    let state = null;
    for (const h of history) state = accumulate(state, [h]);
    const sumW = history.reduce((s, h) => s + h.weight, 0);
    const sumWS = history.reduce((s, h) => s + h.weight * h.signal, 0);
    expect(state?.evidenceWeight).toBeCloseTo(sumW, 3);
    expect(Math.abs((state?.score ?? 0) - sumWS / (sumW + 2))).toBeLessThan(0.003);
  });

  it("retracting a contribution restores the earlier state; evidence never goes below 0", () => {
    const one = accumulate(null, [c(1, 0.5)]);
    const two = accumulate(one, [c(0.3, -1)]);
    expect(accumulate(two, retract([c(0.3, -1)]))).toEqual(one);
    expect(accumulate(one, retract([c(1, 0.5), c(1, 0.5)]))).toEqual({
      score: 0,
      evidenceWeight: 0,
    });
  });
});

describe("learningPreferenceOps", () => {
  it("emits one learned preference.set per key for the member, folding every contribution", () => {
    const ops = learningPreferenceOps("m1", [c(1, -1), c(0.3, -1, "d1#v"), c(1, -1)], []);
    expect(ops).toEqual([
      {
        kind: "preference.set",
        payload: {
          memberId: "m1",
          entityType: "dish",
          entityKey: "d1",
          score: -0.5,
          source: "learned",
          evidenceWeight: 2,
        },
      },
      {
        kind: "preference.set",
        payload: {
          memberId: "m1",
          entityType: "dish",
          entityKey: "d1#v",
          score: -0.13,
          source: "learned",
          evidenceWeight: 0.3,
        },
      },
    ]);
  });

  it("continues from the member's stored learned row only (not other members, levels or sources)", () => {
    const rows = [
      pref({
        memberId: "m1",
        entityType: "dish",
        entityKey: "d1",
        score: -0.333,
        evidenceWeight: 1,
        source: "learned",
      }),
      pref({
        memberId: "m2",
        entityType: "dish",
        entityKey: "d1",
        score: 0.9,
        evidenceWeight: 5,
        source: "learned",
      }),
      pref({ memberId: null, entityType: "dish", entityKey: "d1", score: 0.5, source: "explicit" }),
      pref({ memberId: "m1", entityType: "dish", entityKey: "d1", score: 1, source: "explicit" }),
    ];
    const [op] = learningPreferenceOps("m1", [c(1, -1)], rows);
    expect(op?.payload).toMatchObject({
      memberId: "m1",
      score: -0.5,
      evidenceWeight: 2,
      source: "learned",
    });
  });

  it("G2 locked preferences are never changed by learning", () => {
    const locked = [
      pref({
        memberId: "m1",
        entityType: "dish",
        entityKey: "d1",
        score: 0.8,
        evidenceWeight: 3,
        source: "learned",
        locked: true,
      }),
      pref({
        memberId: "m1",
        entityType: "cuisine",
        entityKey: "thai",
        score: 0.7,
        source: "explicit",
        locked: true,
      }),
    ];
    let rows = locked;
    for (let i = 0; i < 10; i += 1) {
      const ops = learningPreferenceOps(
        "m1",
        [c(1, -1), { entityType: "cuisine", entityKey: "thai", weight: 0.3, signal: -1 }],
        rows,
      );
      expect(ops.some((op) => op.payload.entityKey === "d1")).toBe(false);
      rows = applyPreferenceSets(rows, ops);
    }
    expect(rows.filter((r) => r.locked)).toEqual(locked);
    // The learned row of a key with a locked explicit row still learns; the locked row is untouched.
    expect(rows.find((r) => r.entityKey === "thai" && r.source === "learned")?.score).toBeLessThan(
      0,
    );
  });

  it("G2 negative control: a learner that ignores locks changes the locked row or fails", () => {
    const locked = [
      pref({
        memberId: "m1",
        entityType: "dish",
        entityKey: "d1",
        score: 0.8,
        evidenceWeight: 3,
        source: "learned",
        locked: true,
      }),
    ];
    const unlocked = locked.map((r) => ({ ...r, locked: false }));
    const ignoringLocks = learningPreferenceOps("m1", [c(1, -1)], unlocked);
    expect(ignoringLocks).toHaveLength(1);
    expect(() => applyPreferenceSets(locked, ignoringLocks)).toThrow(/locked/);
  });

  it("emits nothing when nothing would change", () => {
    expect(learningPreferenceOps("m1", [], [])).toEqual([]);
    expect(learningPreferenceOps("m1", retract([c(1, -1)]), [])).toEqual([]);
  });
});
