import { describe, expect, it } from "vitest";
import {
  PORTION_BIAS_BOUNDS,
  nextBias,
  portionBiasOps,
  portionBiasOpsForFactor,
  portionFactor,
  type PortionBiasSetOp,
} from "../../../src/learning/portions/index.js";
import type { ComponentRole, PortionBiasRow } from "../../../src/types/index.js";

const child = { id: "c1", isTargeted: false };
const adult = { id: "a1", isTargeted: true };

function apply(rows: PortionBiasRow[], ops: PortionBiasSetOp[]): PortionBiasRow[] {
  const out = rows.map((r) => ({ ...r }));
  for (const { payload } of ops) {
    if (payload.bias === null) throw new Error("reset not expected");
    const row = out.find(
      (r) => r.memberId === payload.memberId && r.componentRole === payload.componentRole,
    );
    if (row === undefined)
      out.push({
        householdId: "h",
        memberId: payload.memberId,
        componentRole: payload.componentRole,
        bias: payload.bias,
      });
    else row.bias = payload.bias;
  }
  return out;
}

function run(tags: string[], times: number, roles: ComponentRole[] = ["carb"], member = child) {
  let rows: PortionBiasRow[] = [];
  const trace: number[] = [];
  for (let i = 0; i < times; i += 1) {
    rows = apply(rows, portionBiasOps(member, roles, tags, rows));
    trace.push(rows.find((r) => r.componentRole === roles[0])?.bias ?? 1);
  }
  return { rows, trace };
}

describe("G3 FBK-5 learned role bias", () => {
  it("G3 too_much multiplies by 0.9; too_little and still_hungry by 1.1; starting at 1.0", () => {
    expect(run(["too_much"], 1).trace).toEqual([0.9]);
    expect(run(["too_much"], 2).trace).toEqual([0.9, 0.81]);
    expect(run(["too_little"], 1).trace).toEqual([1.1]);
    expect(run(["still_hungry"], 2).trace).toEqual([1.1, 1.21]);
  });

  it("G3 the bias stays within [0.6, 1.6] after 20 repeated signals", () => {
    const down = run(["too_much"], 20).trace;
    const up = run(["still_hungry"], 20).trace;
    for (const b of [...down, ...up]) {
      expect(b).toBeGreaterThanOrEqual(PORTION_BIAS_BOUNDS.min);
      expect(b).toBeLessThanOrEqual(PORTION_BIAS_BOUNDS.max);
    }
    expect(down.at(-1)).toBe(0.6);
    expect(up.at(-1)).toBe(1.6);
    // At the bound, a further signal writes nothing.
    expect(portionBiasOps(child, ["carb"], ["too_much"], run(["too_much"], 20).rows)).toEqual([]);
  });

  it("each distinct role once; just_right, no quantity tag, or both directions change nothing", () => {
    expect(portionBiasOps(child, ["carb", "protein", "carb"], ["too_much"], [])).toHaveLength(2);
    expect(portionFactor(["just_right"])).toBeNull();
    expect(portionFactor(["tasty"])).toBeNull();
    expect(portionFactor(["too_much", "still_hungry"])).toBeNull();
    expect(portionBiasOps(child, ["carb"], ["just_right"], [])).toEqual([]);
  });

  it("G3 targeted members' quantity feedback writes no portion bias (their grams are fixed by targets)", () => {
    for (const tags of [["too_much"], ["too_little"], ["still_hungry"]]) {
      expect(portionBiasOps(adult, ["carb", "protein"], tags, [])).toEqual([]);
      expect(run(tags, 5, ["carb"], adult).rows).toEqual([]);
    }
    expect(portionBiasOpsForFactor(adult, ["carb"], 0.5, [])).toEqual([]);
  });

  it("G3 negative control: an unclamped learner leaves the bounds and is detected", () => {
    let bias = 1;
    for (let i = 0; i < 20; i += 1) bias = Math.round(bias * 0.9 * 1000) / 1000;
    expect(bias).toBeLessThan(PORTION_BIAS_BOUNDS.min);
    expect(nextBias(bias, 1)).toBe(PORTION_BIAS_BOUNDS.min);
  });

  it("rejects a non-positive factor", () => {
    expect(() => portionBiasOpsForFactor(child, ["carb"], 0, [])).toThrow(RangeError);
  });
});
