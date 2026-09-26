// R-38 (leaf-1.2.3 ADR-2): the MILP objective cutoff keeps the appeal term. A combination whose
// MILP optimum (appeal excluded) is above the incumbent's objective can still win through
// λ_appeal · appeal, so its cutoff is best + λ_appeal · (its best appeal) + slack. These tests run
// solvePlate with and without the cutoff (the only difference: `solveMilp` ignores the argument)
// and require identical solutions, on a constructed case that only the appeal term decides and on
// seed dishes with randomised non-zero appeal.
//
// Both runs lift the per-combination time limit (PLN-5, 0.25 s), so every MILP is solved to proven
// optimality and the comparison does not depend on machine speed. Under the 0.25 s limit, a model
// that runs out of time without the cutoff returns its incumbent, which can differ from the proven
// optimum the cutoff run reaches in time (ADR-2, "Time limit").
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadPortionSolver,
  solvePlate,
  solverConfig,
  type ComponentForSolve,
  type DishForSolve,
  type MemberCtx,
  type PlateSolution,
  type VariantForSolve,
} from "../../../src/planner/solver/index.js";
import type { SlotTarget } from "../../../src/planner/targets/index.js";
import { seedLibrary } from "../select/support.js";
import {
  DEFAULT_TOL,
  MACRO_KEYS,
  gridOf,
  macroOf,
  memberCtx,
  prng,
  slotTarget,
  type MacroKey,
} from "./fixtures/cases.js";

/** `unlimitedS`: the per-MILP limit for both runs, far above any plate model's solve time. */
const milp = vi.hoisted(() => ({ cutoff: true, cutoffCalls: 0, unlimitedS: 60 }));

vi.mock("../../../src/planner/solver/highs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/planner/solver/highs.js")>();
  return {
    ...actual,
    solveMilp: (...[model, , cutoff]: Parameters<typeof actual.solveMilp>) => {
      if (cutoff !== undefined) milp.cutoffCalls++;
      return actual.solveMilp(model, milp.unlimitedS, milp.cutoff ? cutoff : undefined);
    },
  };
});

beforeAll(async () => {
  await loadPortionSolver();
});

type Input = Parameters<typeof solvePlate>[0];

/** The solution with and without the cutoff, and how many MILPs were given a cutoff. */
function bothWays(input: Input): { cut: PlateSolution; plain: PlateSolution; cutoffs: number } {
  milp.cutoff = true;
  milp.cutoffCalls = 0;
  const cut = solvePlate(input);
  const cutoffs = milp.cutoffCalls;
  milp.cutoff = false;
  const plain = solvePlate(input);
  milp.cutoff = true;
  return { cut, plain, cutoffs };
}

const nutrients = (n: Partial<VariantForSolve["per100g"]>): VariantForSolve["per100g"] => ({
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  satFat: 0,
  fibre: 0,
  solubleFibre: null,
  sugar: null,
  sodiumMg: null,
  ...n,
});

const variant = (id: string, per100g: VariantForSolve["per100g"]): VariantForSolve => ({
  id,
  isDefault: false,
  per100g,
  ingredients: [],
});

describe("solvePlate cutoff with non-zero appeal", () => {
  // One protein component with variants a and b, one fixed side d. a and d at their defaults hit
  // the target exactly; b carries 0.25 g more protein per 100 g, so its best plate is 0.5 g of
  // protein off (+0.1 objective at tol 5). Appeal: a −1, b +1, d +1.
  //   Combination A = (a, d): bound = LP − 0.3 · max(−1, 1), objective = MILP − 0.3 · mean = MILP.
  //   Combination B = (b, d): bound = LP − 0.3 · 1,          objective = MILP − 0.3 · 1.
  // A's bound is lower, so A is solved first and becomes the incumbent. B's MILP optimum is above
  // A's objective, and B wins only through λ_appeal · appeal: without the appeal term in its cutoff
  // (cutoff = best.objective), HiGHS would cut B off and A would be returned.
  const a = variant(
    "x.main.a",
    nutrients({ kcal: 150, protein: 20, carbs: 5, fat: 5, satFat: 1, fibre: 1 }),
  );
  const b = variant("x.main.b", { ...a.per100g, protein: 20.25 });
  const d = variant(
    "x.side.d",
    nutrients({ kcal: 50, protein: 2, carbs: 8, fat: 1, satFat: 0.2, fibre: 3 }),
  );
  const component = (over: Partial<ComponentForSolve>): ComponentForSolve => ({
    id: "x.main",
    role: "protein",
    portioning: "continuous",
    minServingG: 100,
    maxServingG: 300,
    defaultServingG: 200,
    stepG: 10,
    unitWeightG: null,
    required: true,
    variants: [a, b],
    ...over,
  });
  const dishOf = (mainVariants: VariantForSolve[]): DishForSolve => ({
    id: "x",
    isPackable: false,
    servedColdOk: false,
    components: [
      component({ variants: mainVariants }),
      component({
        id: "x.side",
        role: "vegetable",
        portioning: "fixed",
        minServingG: 100,
        maxServingG: 100,
        defaultServingG: 100,
        variants: [d],
      }),
    ],
  });
  // a at 200 g + d at 100 g: kcal 350, protein 42, carbs (total basis) 10 + 2 + 8 + 3 = 23, fat 11.
  const target = slotTarget({ kcal: 350, protein: 42, carbs: 23, fat: 11 }, "total");
  const appeal = { [a.id]: -1, [b.id]: 1, [d.id]: 1 };
  const lambda = solverConfig.LAMBDA_APPEAL;

  it("returns the combination that wins only through appeal, as without the cutoff", () => {
    // Each combination's objective without appeal, solved on its own.
    const alone = (v: VariantForSolve) =>
      solvePlate({ dish: dishOf([v]), target, member: memberCtx(), adjusters: [] });
    const milpA = alone(a).objective;
    const milpB = alone(b).objective;
    // The case is discriminating: B's optimum is above A's objective, but within λ_appeal · 1.
    expect(milpB).toBeGreaterThan(milpA + 0.05);
    expect(milpB).toBeLessThan(milpA + lambda - 0.05);

    const input: Input = {
      dish: dishOf([a, b]),
      target,
      member: memberCtx({ variantAppeal: appeal }),
      adjusters: [],
    };
    const { cut, plain, cutoffs } = bothWays(input);
    expect(cutoffs).toBeGreaterThan(0);
    expect(plain.items.find((i) => i.componentId === "x.main")?.variantId).toBe(b.id);
    expect(plain.objective).toBeCloseTo(milpB - lambda, 9);
    expect(cut).toEqual(plain);
  });
});

/** A random on-grid plate of a dish: its macros (plus noise) become the target. */
function randomTarget(
  rand: () => number,
  dish: DishForSolve,
  i: number,
): { target: SlotTarget; shifted: boolean } {
  const items: Array<{ per100g: VariantForSolve["per100g"]; cookedG: number }> = [];
  for (const c of dish.components) {
    const v = c.variants[Math.floor(rand() * c.variants.length)];
    const { unit, kMin, kMax } = gridOf(c);
    const k = !c.required && rand() < 0.25 ? 0 : kMin + Math.floor(rand() * (kMax - kMin + 1));
    if (v !== undefined && k > 0) items.push({ per100g: v.per100g, cookedG: k * unit });
  }
  const total = (m: MacroKey) =>
    items.reduce((s, x) => s + (macroOf(x.per100g, m, "total") * x.cookedG) / 100, 0);
  const tol = { ...DEFAULT_TOL, kcal: i % 2 === 0 ? 15 : 50 };
  // Every eighth case asks for more protein than the plate can hold, so the adjuster stage runs.
  const shifted = i % 8 === 7;
  const values = {} as Record<MacroKey, number>;
  for (const m of MACRO_KEYS)
    values[m] = Math.max(0, Math.round(total(m) + (rand() * 1.2 - 0.6) * tol[m]));
  if (shifted) values.protein += 25;
  return {
    target: slotTarget(values, "total", { tol, mode: i % 3 === 2 ? "flexible" : "strict" }),
    shifted,
  };
}

/** Appeal in [−1, 1] for every variant of the dish and every adjuster, from the stream. */
function randomAppeal(
  rand: () => number,
  dish: DishForSolve,
  adjusters: readonly DishForSolve[],
): Pick<MemberCtx, "variantAppeal" | "dishAppeal"> {
  const variantAppeal: Record<string, number> = {};
  for (const c of dish.components)
    for (const v of c.variants) variantAppeal[v.id] = Math.round((rand() * 2 - 1) * 100) / 100;
  const dishAppeal: Record<string, number> = {};
  for (const x of adjusters) dishAppeal[x.id] = Math.round((rand() * 2 - 1) * 100) / 100;
  return { variantAppeal, dishAppeal };
}

describe("solvePlate cutoff equivalence on seed dishes with random appeal", () => {
  it("returns identical plates with and without the cutoff (200 plates, seed 38)", () => {
    const { dishes, adjusters } = seedLibrary();
    const multi = dishes.filter((x) => x.components.some((c) => c.variants.length > 1));
    const rand = prng(38);
    let cutoffs = 0;
    let appealDecided = 0;
    let adjusted = 0;
    for (let i = 0; i < 200; i++) {
      const dish = multi[i % multi.length];
      if (dish === undefined) throw new Error("no multi-variant seed dishes");
      const { target } = randomTarget(rand, dish, i);
      const member = memberCtx(randomAppeal(rand, dish, adjusters));
      const input: Input = { dish, target, member, adjusters };
      const result = bothWays(input);
      expect(result.cut, `plate ${String(i)} (${dish.id})`).toEqual(result.plain);
      cutoffs += result.cutoffs;
      if (result.cut.adjusters.length > 0) adjusted++;
      // Non-vacuity: plates where appeal changed the served variants.
      const neutral = solvePlate({ ...input, member: memberCtx() });
      const variants = (s: PlateSolution) => s.items.map((x) => x.variantId).join(",");
      if (variants(neutral) !== variants(result.cut)) appealDecided++;
    }
    expect(multi.length).toBeGreaterThan(10);
    expect(cutoffs).toBeGreaterThan(200);
    expect(appealDecided).toBeGreaterThan(30);
    expect(adjusted).toBeGreaterThan(5);
  }, 300_000);
});
