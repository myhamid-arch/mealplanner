// AGT-9: the eval set (evals/agent/*.yaml) is well-formed and large enough, and the grader passes
// a correct transcript and fails a wrong one. The live run itself is G4's owner handoff.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { EvalFileSchema, gradeCase, passRate, type EvalCase } from "../../src/agent/index.js";

/** The repository root (the directory with pnpm-workspace.yaml), from the source or the build. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("repository root not found");
    dir = up;
  }
  return dir;
}

const DIR = join(repoRoot(), "evals/agent");

function cases(): EvalCase[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .flatMap((f) => EvalFileSchema.parse(load(readFileSync(join(DIR, f), "utf8"))).cases);
}

const byId = (id: string) => {
  const c = cases().find((x) => x.id === id);
  if (c === undefined) throw new Error(`no case ${id}`);
  return c;
};

describe("AGT-9 eval set", () => {
  it("has at least 25 valid cases with unique ids, including the spec's examples", () => {
    const all = cases();
    expect(all.length).toBeGreaterThanOrEqual(25);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    for (const id of ["set-protein", "why-off-target", "weekend-appeal", "allergy-sesame"])
      expect(all.some((c) => c.id === id)).toBe(true);
    // A proactive suggestion must not be applied (AGT-9 must-not example).
    expect(
      all.filter((c) => c.mustNot.tools.includes("apply_change")).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("grades a correct transcript as a pass", () => {
    const g = gradeCase(byId("allergy-sesame"), [
      { name: "get_household", input: {} },
      {
        name: "apply_change",
        input: {
          summary: "Omar: sesame allergy",
          ops: [
            {
              kind: "exclusion.add",
              payload: {
                memberId: "x",
                kind: "dietary_flag",
                key: "contains_sesame",
                reason: "allergy",
                hard: true,
              },
            },
          ],
        },
      },
    ]);
    expect(g).toEqual({ id: "allergy-sesame", pass: true, failures: [] });
  });

  it("R-66: a sesame allergy excluded only as the sesame-seeds ingredient fails (R2-ONB-3)", () => {
    const g = gradeCase(byId("allergy-sesame"), [
      {
        name: "apply_change",
        input: {
          summary: "Omar: sesame allergy",
          ops: [
            {
              kind: "exclusion.add",
              payload: {
                memberId: "x",
                kind: "ingredient",
                key: "sesame-seeds",
                reason: "allergy",
                hard: true,
              },
            },
          ],
        },
      },
    ]);
    expect(g.pass).toBe(false);
  });

  it("negative control: a soft allergy, a proposal instead of an apply, or an apply of an idea all fail", () => {
    const soft = gradeCase(byId("allergy-sesame"), [
      {
        name: "apply_change",
        input: {
          summary: "x",
          ops: [
            {
              kind: "exclusion.add",
              payload: {
                kind: "dietary_flag",
                key: "contains_sesame",
                reason: "allergy",
                hard: false,
              },
            },
          ],
        },
      },
    ]);
    expect(soft.pass).toBe(false);
    const proposed = gradeCase(byId("set-protein"), [
      {
        name: "propose_change",
        input: {
          title: "x",
          rationale: "y",
          ops: [{ kind: "target.set", payload: { kind: "default", profile: { proteinG: 140 } } }],
        },
      },
    ]);
    expect(proposed.failures).toEqual([
      "expected target.set through apply_change, got propose_change",
    ]);
    const applied = gradeCase(byId("bored-of-rice"), [
      {
        name: "apply_change",
        input: { summary: "less rice", ops: [{ kind: "weights.set", payload: { appeal: 0.9 } }] },
      },
    ]);
    expect(applied.pass).toBe(false);
    expect(passRate([soft, proposed, applied])).toBe(0);
  });

  it("weekday sets match in any order", () => {
    const g = gradeCase(byId("weekend-appeal"), [
      {
        name: "apply_change",
        input: {
          summary: "x",
          ops: [{ kind: "preset.upsert", payload: { name: "Weekend", appliesToWeekdays: [6, 5] } }],
        },
      },
    ]);
    expect(g.pass).toBe(true);
  });
});
