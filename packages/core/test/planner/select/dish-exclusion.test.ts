// R-83 (W-23, leaf-1.3.7 G1): the `dish` exclusion kind. A slot-scoped dish exclusion keeps that
// dish off the plates of the members it covers in those slots and nowhere else; the op names the
// dish by id and only a dish the household can see. The planned-week checks run on F1 with the
// seed library: the dish F1's week serves most in packed slots, excluded from the household's
// packed slots, as a practical-tag proposal would (FBK-3).
import { describe, expect, it } from "vitest";
import { ChangeOpSchema, type ChangeOp } from "../../../src/changes/index.js";
import { dishExclusionReason } from "../../../src/planner/select/filters.js";
import type { PlanResult } from "../../../src/planner/select/index.js";
import { mealsOfDate } from "../../../src/planner/select/meals.js";
import { Household } from "../../../src/planner/select/members.js";
import { Pool } from "../../../src/planner/select/pool.js";
import { Run } from "../../../src/planner/select/run.js";
import type { DishRow, ExclusionRow, HouseholdConfig } from "../../../src/types/index.js";
import { idFactory, MemoryTx, newHousehold } from "../../onboarding/memory-tx.js";
import { f1PlanConfig, F1_WEEK } from "./f1.js";
import { planF1, seedLibrary } from "./support.js";

const SEEDS = [1, 2, 3];
const lib = seedLibrary();

const packedKeys = (cfg: HouseholdConfig) =>
  cfg.slotTypes
    .filter((s) => s.active && s.isPacked)
    .map((s) => s.key)
    .sort();

function dishExclusion(
  dishId: string,
  slotKeys: string[] | null,
  memberId: string | null = null,
): ExclusionRow {
  return {
    id: `dish-${dishId}-${memberId ?? "all"}-${slotKeys?.join("+") ?? "every"}`,
    householdId: "household-test",
    memberId,
    kind: "dish",
    key: dishId,
    reason: "other",
    hard: false,
    slotKeys,
  };
}

function withRows(rows: ExclusionRow[]): HouseholdConfig {
  const cfg = f1PlanConfig();
  cfg.exclusions = [...cfg.exclusions, ...rows];
  return cfg;
}

/** Meals of the plan that serve the dish, split by whether their slot is packed. */
function servings(plan: PlanResult, dishId: string, packed: ReadonlySet<string>) {
  const meals = plan.days.flatMap((d) => d.meals).filter((m) => m.dishId === dishId);
  return {
    packed: meals.filter((m) => packed.has(m.slotKey)).map((m) => `${m.date} ${m.slotKey}`),
    other: meals.filter((m) => !packed.has(m.slotKey)).map((m) => `${m.date} ${m.slotKey}`),
  };
}

/**
 * The G1 planner assertion: over the seeds, no planned week serves the dish in a packed slot, and
 * the dish stays in the eligible pool of every non-packed meal where it was eligible without the
 * exclusion. Returns the violations (empty = passes).
 */
async function packedExclusionViolations(cfg: HouseholdConfig, dishId: string): Promise<string[]> {
  const packed = new Set(packedKeys(cfg));
  const out: string[] = [];
  for (const seed of SEEDS) {
    const plan = await planF1(F1_WEEK, { seed, config: cfg });
    for (const at of servings(plan, dishId, packed).packed) out.push(`seed ${String(seed)}: served ${at}`);
  }
  const base = new Run(f1PlanConfig(), lib.dishes, lib.adjusters, 1);
  const run = new Run(cfg, lib.dishes, lib.adjusters, 1);
  for (const date of F1_WEEK)
    for (const spec of mealsOfDate(cfg, date)) {
      if (packed.has(spec.slot.key)) continue;
      const before = base.eligiblePool(spec).some((d) => d.id === dishId);
      const after = run.eligiblePool(spec).some((d) => d.id === dishId);
      if (before && !after) out.push(`${date} ${spec.slot.key}: no longer offered`);
    }
  return out;
}

/** The dish F1's week (seed 1) serves most in packed slots. */
async function mostPackedDish(): Promise<{ dishId: string; count: number }> {
  const cfg = f1PlanConfig();
  const packed = new Set(packedKeys(cfg));
  const plan = await planF1(F1_WEEK, { seed: 1, config: cfg });
  const counts = new Map<string, number>();
  for (const m of plan.days.flatMap((d) => d.meals))
    if (packed.has(m.slotKey)) counts.set(m.dishId, (counts.get(m.dishId) ?? 0) + 1);
  const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (best === undefined) throw new Error("F1's week has no packed meal");
  return { dishId: best[0], count: best[1] };
}

describe("planned weeks with a dish excluded from the packed slots (R-83, G1)", () => {
  it("keep the dish out of every packed slot and still offer it in the others", async () => {
    const { dishId, count } = await mostPackedDish();
    expect(count).toBeGreaterThan(0);
    const cfg = withRows([dishExclusion(dishId, packedKeys(f1PlanConfig()))]);
    expect(packedKeys(cfg)).toEqual(["packed_school_lunch", "packed_work_lunch"]);
    expect(await packedExclusionViolations(cfg, dishId)).toEqual([]);
    // The dish is eligible at some non-packed meal of the week, and stays so.
    const run = new Run(cfg, lib.dishes, lib.adjusters, 1);
    const offered = F1_WEEK.flatMap((date) =>
      mealsOfDate(cfg, date).filter(
        (spec) => !spec.slot.isPacked && run.eligiblePool(spec).some((d) => d.id === dishId),
      ),
    );
    expect(offered.length).toBeGreaterThan(0);
  }, 300_000);

  it("negative control: without the exclusion the same assertion fails", async () => {
    const { dishId } = await mostPackedDish();
    const violations = await packedExclusionViolations(f1PlanConfig(), dishId);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/served .* packed_/);
  }, 300_000);
});

describe("dishExclusionReason (R-83)", () => {
  const pool = new Pool(lib.dishes, lib.adjusters);
  const dish = lib.dishes[0];
  if (dish === undefined) throw new Error("empty seed library");
  const household = (rows: ExclusionRow[]) => new Household(withRows(rows), pool);
  const SCHOOL = "packed_school_lunch";

  it("a household row covers every attendee in its slots only", () => {
    const hh = household([dishExclusion(dish.id, [SCHOOL])]);
    expect(dishExclusionReason(dish, ["c1"], SCHOOL, hh)).toMatch(
      /excluded at packed_school_lunch/,
    );
    expect(dishExclusionReason(dish, ["c1"], "dinner", hh)).toBeNull();
  });
  it("a member row covers that member only", () => {
    const hh = household([dishExclusion(dish.id, [SCHOOL], "c3")]);
    expect(dishExclusionReason(dish, ["c1", "c2"], SCHOOL, hh)).toBeNull();
    expect(dishExclusionReason(dish, ["c1", "c3"], SCHOOL, hh)).not.toBeNull();
  });
  it("an unscoped row applies in every slot, and only to that dish", () => {
    const hh = household([dishExclusion(dish.id, null)]);
    for (const slot of ["breakfast", "lunch", "dinner", SCHOOL])
      expect(dishExclusionReason(dish, ["adult_a"], slot, hh)).not.toBeNull();
    const other = lib.dishes.find((d) => d.id !== dish.id);
    if (other === undefined) throw new Error("one-dish library");
    expect(dishExclusionReason(other, ["adult_a"], "dinner", hh)).toBeNull();
  });
  it("other kinds with the same key do not exclude the dish", () => {
    const row = { ...dishExclusion(dish.id, null), kind: "ingredient" as const };
    expect(dishExclusionReason(dish, ["adult_a"], "dinner", household([row]))).toBeNull();
  });
});

describe("exclusion.add with kind dish (R-83)", () => {
  const DISH = "50000000-0000-4000-8000-0000000000d1";
  const payload = (over: object = {}) => ({
    memberId: null,
    kind: "dish",
    key: DISH,
    reason: "other",
    hard: false,
    slotKeys: ["packed_work_lunch", "packed_school_lunch"],
    ...over,
  });
  const parse = (p: object) => ChangeOpSchema.safeParse({ kind: "exclusion.add", payload: p });

  it("parses a dish id key and stores the scope sorted", () => {
    const r = parse(payload());
    expect(r.success && r.data.kind === "exclusion.add" && r.data.payload.slotKeys).toEqual([
      "packed_school_lunch",
      "packed_work_lunch",
    ]);
  });
  it("refuses a key that is not a dish id", () => {
    expect(parse(payload({ key: "chicken-shawarma-bowl" })).success).toBe(false);
  });

  async function setup(dishHousehold: "own" | "global" | "none") {
    const tx = new MemoryTx(idFactory(9));
    await newHousehold(tx);
    if (dishHousehold !== "none") {
      const row: Partial<DishRow> = {
        id: DISH,
        householdId: dishHousehold === "own" ? tx.householdId : null,
        name: "Chicken shawarma bowl",
        slug: "chicken-shawarma-bowl",
        slotKeys: ["lunch", "dinner"],
        status: "active",
      };
      await tx.insert("dish", row as DishRow);
    }
    const add = (over: object = {}) =>
      tx.applyAll([{ kind: "exclusion.add", payload: payload(over) } as unknown as ChangeOp]);
    return { tx, add };
  }

  it("writes the row for a household dish and for a seed dish", async () => {
    for (const where of ["own", "global"] as const) {
      const { tx, add } = await setup(where);
      await add();
      expect(tx.rows("exclusion")).toEqual([
        expect.objectContaining({
          memberId: null,
          kind: "dish",
          key: DISH,
          reason: "other",
          hard: false,
          slotKeys: ["packed_school_lunch", "packed_work_lunch"],
        }),
      ]);
    }
  });
  it("refuses a dish the household cannot see", async () => {
    const { tx, add } = await setup("none");
    await expect(add()).rejects.toThrow(/dish/);
    expect(tx.rows("exclusion")).toEqual([]);
  });
});
