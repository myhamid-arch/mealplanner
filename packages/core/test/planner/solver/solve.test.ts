// PLN-5 … 8 portion solver (ledger G2 … G4 and the rules behind them).
import { beforeAll, describe, expect, it } from "vitest";
import {
  SolverError,
  loadPortionSolver,
  solvePlate,
  solverConfig,
  type DishForSolve,
  type PlateSolution,
  type SolvePlateInput,
} from "../../../src/planner/solver/index.js";
import { resolveSlotTargets } from "../../../src/planner/targets/index.js";
import { plateNutrients } from "../../../src/nutrition/index.js";
import { F1_WEEK, f1Config } from "../targets/config.js";
import { dishSlots, testDishes } from "./fixtures/build.js";
import {
  DEFAULT_TOL,
  MACRO_KEYS,
  adjusterCases,
  eligibleAdjusterIds,
  feasibleCases,
  gridOf,
  infeasibleCases,
  macroOf,
  memberCtx,
  reach,
  slotTarget,
} from "./fixtures/cases.js";

const SLOW = 120_000;

beforeAll(async () => {
  await loadPortionSolver();
});

function componentOf(dish: DishForSolve, id: string) {
  const c = dish.components.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no component ${id}`);
  return c;
}

/** Grams on the grid and within [min, max]; actual and deviation recomputed. */
function expectConsistent(input: SolvePlateInput, r: PlateSolution) {
  const perItem: Array<{
    per100g: (typeof input.dish.components)[number]["variants"][number]["per100g"];
    cookedG: number;
  }> = [];
  for (const item of r.items) {
    const c = componentOf(input.dish, item.componentId);
    const { unit } = gridOf(c);
    expect(item.cookedG).toBeGreaterThan(0);
    expect(Number.isInteger(item.cookedG)).toBe(true);
    expect(item.cookedG / unit).toBeCloseTo(Math.round(item.cookedG / unit), 9);
    expect(item.cookedG).toBeGreaterThanOrEqual(c.minServingG);
    expect(item.cookedG).toBeLessThanOrEqual(c.maxServingG);
    const v = c.variants.find((x) => x.id === item.variantId);
    if (v === undefined) throw new Error("unknown variant");
    perItem.push({ per100g: v.per100g, cookedG: item.cookedG });
  }
  for (const c of input.dish.components)
    if (c.required && r.status !== "infeasible" && r.status !== "untargeted")
      expect(r.items.some((i) => i.componentId === c.id)).toBe(true);
  for (const a of r.adjusters) {
    const dish = input.adjusters.find((d) => d.id === a.dishId);
    const c = dish?.components[0];
    if (c === undefined) throw new Error("unknown adjuster");
    const v = c.variants.find((x) => x.id === a.variantId);
    if (v === undefined) throw new Error("unknown adjuster variant");
    expect(a.cookedG).toBeGreaterThanOrEqual(c.minServingG);
    expect(a.cookedG).toBeLessThanOrEqual(c.maxServingG);
    perItem.push({ per100g: v.per100g, cookedG: a.cookedG });
  }
  const actual = plateNutrients(perItem);
  expect(r.actual.kcal).toBeCloseTo(actual.kcal, 6);
  if (input.target !== null && r.status !== "untargeted") {
    for (const m of MACRO_KEYS)
      expect(r.deviation[m]).toBeCloseTo(
        macroOf(actual, m, input.target.carbBasis) - input.target[m],
        6,
      );
    const soluble = perItem.reduce(
      (a, x) => a + ((x.per100g.solubleFibre ?? 0) * x.cookedG) / 100,
      0,
    );
    const { fibreGoal, solubleFibreGoal } = input.target;
    expect(r.shortfall.fibre).toBeCloseTo(
      fibreGoal === undefined ? 0 : Math.max(0, fibreGoal - actual.fibre),
      6,
    );
    expect(r.shortfall.solubleFibre).toBeCloseTo(
      solubleFibreGoal === undefined ? 0 : Math.max(0, solubleFibreGoal - soluble),
      6,
    );
  }
}

function inTolerance(input: SolvePlateInput, r: PlateSolution): boolean {
  const t = input.target;
  if (t === null) return false;
  return (
    MACRO_KEYS.every((m) => Math.abs(r.deviation[m]) <= t.tol[m] + 1e-6) &&
    (t.satFatMax === undefined || r.actual.satFat <= t.satFatMax + 1e-6)
  );
}

describe("known-feasible cases are in tolerance on the grid (G2, PLN-5)", () => {
  it(
    "200 cases on total carbohydrate",
    () => {
      for (const c of feasibleCases(200, "total", 1)) {
        const r = solvePlate(c);
        expect(r.status, c.id).toBe("in_tolerance");
        expect(inTolerance(c, r), c.id).toBe(true);
        expect(r.fit).toBeGreaterThanOrEqual(0);
        expectConsistent(c, r);
      }
    },
    SLOW,
  );
  it(
    "40 cases on available carbohydrate",
    () => {
      for (const c of feasibleCases(40, "available", 2)) {
        const r = solvePlate(c);
        expect(r.status, c.id).toBe("in_tolerance");
        expectConsistent(c, r);
      }
    },
    SLOW,
  );
  it(
    "reports zero fibre shortfall for plates that meet both goals (OQ-4, R-28)",
    () => {
      let meeting = 0;
      for (const c of feasibleCases(60, "total", 1).filter(
        (x) => x.target.fibreGoal !== undefined,
      )) {
        const r = solvePlate(c);
        expectConsistent(c, r);
        const soluble = r.shortfall.solubleFibre;
        if (r.shortfall.fibre === 0 && soluble === 0) meeting++;
        const fibre = r.actual.fibre;
        if (fibre >= (c.target.fibreGoal ?? 0) && r.shortfall.solubleFibre === 0)
          expect(r.shortfall.fibre).toBe(0);
      }
      expect(meeting).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe("known-infeasible cases (G2, PLN-8)", () => {
  const cases = infeasibleCases(50, "total", 3);
  it("carry an analytic certificate", () => {
    for (const c of cases) {
      if (c.kind === "satFat") continue;
      const r = reach(c.dish, c.kind, "total");
      const v = c.target[c.kind];
      expect(v > r.max + DEFAULT_TOL[c.kind] || v < r.min - DEFAULT_TOL[c.kind], c.id).toBe(true);
    }
  });
  it(
    "are infeasible in strict mode, with the least-deviation plate and fit 0",
    () => {
      for (const c of cases) {
        const r = solvePlate(c);
        expect(r.status, c.id).toBe("infeasible");
        expect(r.fit).toBe(0);
        expect(r.items.length).toBeGreaterThan(0);
        expectConsistent(c, r);
      }
    },
    SLOW,
  );
  it(
    "are flexible misses in flexible mode",
    () => {
      for (const c of cases) {
        const input = { ...c, target: { ...c.target, mode: "flexible" as const } };
        const r = solvePlate(input);
        expect(r.status, c.id).toBe("flexible_miss");
        expectConsistent(input, r);
      }
    },
    SLOW,
  );
});

describe("adjusters (G3, PLN-6)", () => {
  const cases = adjusterCases(60, "total", 4);
  it(
    "cases infeasible without adjusters become feasible with at most 2",
    () => {
      for (const c of cases) {
        expect(solvePlate({ ...c, adjusters: [] }).status, c.id).toBe("infeasible");
        const r = solvePlate(c);
        expect(r.status, c.id).toBe("in_tolerance");
        expect(r.adjusters.length).toBeGreaterThanOrEqual(1);
        expect(r.adjusters.length).toBeLessThanOrEqual(solverConfig.MAX_ADJUSTERS);
        expect(new Set(r.adjusters.map((a) => a.dishId)).size).toBe(r.adjusters.length);
        expectConsistent(c, r);
      }
    },
    SLOW,
  );
  it(
    "never uses an excluded, disliked or unsuitable adjuster",
    () => {
      for (const c of cases) {
        const eligible = eligibleAdjusterIds(c.adjusters, c.member);
        const r = solvePlate(c);
        for (const a of r.adjusters) expect(eligible, c.id).toContain(a.dishId);
      }
    },
    SLOW,
  );
  it("uses no adjusters when the dish alone is feasible", () => {
    const { adjusters } = testDishes();
    for (const c of feasibleCases(25, "total", 9))
      expect(solvePlate({ ...c, adjusters }).adjusters).toEqual([]);
  });
  it("applies the flexible-mode adjuster retry (SPEC-Q-11)", () => {
    const c = cases[0];
    if (c === undefined) throw new Error("no case");
    const r = solvePlate({ ...c, target: { ...c.target, mode: "flexible" } });
    expect(r.status).toBe("in_tolerance");
    expect(r.adjusters.length).toBeGreaterThan(0);
  });
});

describe("plate naturalness on F1 targets (G4)", () => {
  it(
    "keeps every component within [min, max] for targeted and untargeted plates",
    () => {
      const { dishes } = testDishes();
      const cfg = f1Config();
      for (const date of F1_WEEK.slice(0, 2))
        for (const t of resolveSlotTargets(cfg, date))
          for (const dish of dishes.filter((d) => dishSlots(d.id).includes(t.slotKey))) {
            const input = {
              dish,
              target: t,
              member: memberCtx({ memberId: t.memberId }),
              adjusters: [],
            };
            expectConsistent(input, solvePlate(input));
          }
      for (const appetite of ["small", "medium", "large"] as const)
        for (const bias of [0.6, 1, 1.6])
          for (const dish of dishes) {
            const member = memberCtx({
              appetite,
              roleBias: { protein: bias, carb: bias, vegetable: bias },
            });
            const input = { dish, target: null, member, adjusters: [] };
            const r = solvePlate(input);
            expect(r.status).toBe("untargeted");
            expectConsistent(input, r);
          }
    },
    SLOW,
  );
});

describe("solver rules", () => {
  const { dishes, adjusters } = testDishes();
  const nth = (d: DishForSolve, i: number) => {
    const c = d.components[i];
    if (c === undefined) throw new Error(`dish ${d.id} has no component ${String(i)}`);
    return c;
  };
  const dish = (id: string) => {
    const d = dishes.find((x) => x.id === id);
    if (d === undefined) throw new Error(`no dish ${id}`);
    return d;
  };

  it("penalises a fibre shortfall: the higher-fibre twin wins only when there is a goal", () => {
    const base = dish("cod_quinoa_spinach");
    const spinach = nth(base, 2);
    const steamed = spinach.variants.find((v) => v.id.endsWith(".steamed"));
    if (steamed === undefined) throw new Error("dish shape");
    // Identical except for 3 g more fibre and 1 g more soluble fibre per 100 g.
    const twin = {
      ...steamed,
      id: `${spinach.id}.fibre_twin`,
      isDefault: false,
      per100g: {
        ...steamed.per100g,
        fibre: steamed.per100g.fibre + 3,
        solubleFibre: (steamed.per100g.solubleFibre ?? 0) + 1,
      },
    };
    const d: DishForSolve = {
      ...base,
      components: [nth(base, 0), nth(base, 1), { ...spinach, variants: [steamed, twin] }],
    };
    // Available-carbohydrate basis, so the extra fibre changes no macro.
    // Targets taken from a plate of the dish itself, so they are reachable.
    const seed = solvePlate({
      dish: { ...d, components: [nth(base, 0), nth(base, 1), { ...spinach, variants: [steamed] }] },
      target: slotTarget({ kcal: 520, protein: 45, carbs: 50, fat: 13 }, "total"),
      member: memberCtx(),
      adjusters: [],
    });
    const values = {
      kcal: Math.round(seed.actual.kcal),
      protein: Math.round(seed.actual.protein),
      carbs: Math.round(seed.actual.carbs),
      fat: Math.round(seed.actual.fat),
    };
    const plain = solvePlate({
      dish: d,
      target: slotTarget(values, "available"),
      member: memberCtx(),
      adjusters: [],
    });
    const spinachOf = (r: PlateSolution) =>
      r.items.find((i) => i.componentId === spinach.id)?.variantId;
    expect(plain.status).toBe("in_tolerance");
    expect(spinachOf(plain)).toBe(steamed.id);
    expect(plain.shortfall).toEqual({ fibre: 0, solubleFibre: 0 });
    const goals = slotTarget(values, "available", { fibreGoal: 40, solubleFibreGoal: 20 });
    const withGoals = solvePlate({ dish: d, target: goals, member: memberCtx(), adjusters: [] });
    expect(spinachOf(withGoals)).toBe(twin.id);
    expect(withGoals.shortfall.fibre).toBeGreaterThan(0);
    expect(withGoals.explain.some((e) => e.includes("fibre goals"))).toBe(true);
  });

  it("matches carbs on the target's basis (R-20)", () => {
    const [c] = feasibleCases(1, "total", 11);
    if (c === undefined) throw new Error("no case");
    const total = solvePlate(c);
    const avail = solvePlate({ ...c, target: { ...c.target, carbBasis: "available" } });
    expect(total.deviation.carbs).toBeCloseTo(
      total.actual.carbs + total.actual.fibre - c.target.carbs,
      6,
    );
    expect(avail.deviation.carbs).toBeCloseTo(avail.actual.carbs - c.target.carbs, 6);
  });

  it("serves untargeted plates at default × appetite × role bias, snapped to the grid (PLN-7)", () => {
    const d = dish("chicken_rice_salad");
    const r = solvePlate({
      dish: d,
      target: null,
      member: memberCtx({ appetite: "large", roleBias: { carb: 1.2 } }),
      adjusters,
    });
    expect(r.status).toBe("untargeted");
    expect(r.fit).toBe(1);
    expect(r.adjusters).toEqual([]);
    const grams = Object.fromEntries(
      r.items.map((i) => [i.componentId.split(".")[1] ?? "", i.cookedG]),
    );
    expect(grams).toEqual({ chicken: 235, rice: 235, salad: 130 }); // 180·1.3 = 234 → 235; 150·1.3·1.2 = 234 → 235; 100·1.3
  });

  it("clamps untargeted grams to [min, max] and uses the unit grid", () => {
    const d = dish("eggs_toast_avocado");
    const r = solvePlate({
      dish: d,
      target: null,
      member: memberCtx({ appetite: "large", roleBias: { protein: 1.6 } }),
      adjusters: [],
    });
    const eggs = r.items.find((i) => i.componentId === "eggs_toast_avocado.eggs");
    expect(eggs?.cookedG).toBe(200); // 100·1.3·1.6 = 208 → 4 eggs of 50 g, max 200
  });

  it("picks the member's highest-appeal variant for untargeted plates", () => {
    const d = dish("chicken_rice_salad");
    const r = solvePlate({
      dish: d,
      target: null,
      member: memberCtx({ variantAppeal: { "chicken_rice_salad.chicken.breaded": 0.9 } }),
      adjusters: [],
    });
    expect(r.items.find((i) => i.componentId === "chicken_rice_salad.chicken")?.variantId).toBe(
      "chicken_rice_salad.chicken.breaded",
    );
  });

  it("skips variants that break the member's exclusions (SPEC-Q-13)", () => {
    const [c] = feasibleCases(1, "total", 5);
    if (c === undefined) throw new Error("no case");
    const d = dish("chicken_rice_salad");
    const member = memberCtx({
      exclusions: {
        ingredientIds: [],
        categories: [],
        dietaryFlags: ["contains_gluten", "contains_egg"],
      },
    });
    const values = { kcal: 600, protein: 50, carbs: 60, fat: 15 };
    const r = solvePlate({ dish: d, target: slotTarget(values, "total"), member, adjusters: [] });
    expect(r.items.some((i) => i.variantId.endsWith(".breaded"))).toBe(false);
    const all = memberCtx({
      exclusions: { ingredientIds: ["chicken-breast"], categories: [], dietaryFlags: [] },
    });
    const blocked = solvePlate({
      dish: d,
      target: slotTarget(values, "total"),
      member: all,
      adjusters: [],
    });
    expect(blocked.status).toBe("infeasible");
    expect(blocked.items).toEqual([]);
  });

  it("breaks ties between equal plates towards the member's preferred variant (λ_appeal)", () => {
    const base = dish("cod_quinoa_spinach");
    const spinach = base.components[2];
    const steamed = spinach?.variants.find((v) => v.id.endsWith(".steamed"));
    if (spinach === undefined || steamed === undefined) throw new Error("dish shape");
    // Two nutritionally identical variants: only appeal can separate them.
    const twin = { ...steamed, id: `${spinach.id}.twin`, isDefault: false };
    const d: DishForSolve = {
      ...base,
      components: [nth(base, 0), nth(base, 1), { ...spinach, variants: [steamed, twin] }],
    };
    const t = slotTarget({ kcal: 520, protein: 45, carbs: 50, fat: 13 }, "total");
    const pick = (appeal: Record<string, number>) => {
      const r = solvePlate({
        dish: d,
        target: t,
        member: memberCtx({ variantAppeal: appeal }),
        adjusters: [],
      });
      return { r, variant: r.items.find((i) => i.componentId === spinach.id)?.variantId };
    };
    expect(pick({}).variant).toBe(steamed.id); // equal objective: the first combination
    const liked = pick({ [twin.id]: 0.6 });
    expect(liked.variant).toBe(twin.id);
    // The appeal term lowers the objective by λ_appeal · mean appeal of the served variants.
    const served = liked.r.items.length;
    expect(pick({}).r.objective - liked.r.objective).toBeCloseTo(
      (solverConfig.LAMBDA_APPEAL * 0.6) / served,
      6,
    );
  });

  it("keeps the top 3 variants per component beyond 24 combinations", () => {
    const base = dish("chicken_rice_salad");
    const chicken = base.components[0];
    const rice = base.components[1];
    const salad = base.components[2];
    if (chicken === undefined || rice === undefined || salad === undefined)
      throw new Error("dish shape");
    const nthVariant = (c: typeof chicken, i: number) => {
      const v = c.variants[i % c.variants.length];
      if (v === undefined) throw new Error("no variant");
      return v;
    };
    const more = (c: typeof chicken, n: number) => ({
      ...c,
      variants: Array.from({ length: n }, (_, i) => ({
        ...nthVariant(c, i),
        id: `${c.id}.v${String(i)}`,
        isDefault: i === 0,
      })),
    });
    const wide: DishForSolve = {
      ...base,
      components: [more(chicken, 4), more(rice, 4), more(salad, 4)],
    };
    const appeal = { [`${chicken.id}.v3`]: -1 };
    const r = solvePlate({
      dish: wide,
      target: slotTarget({ kcal: 600, protein: 50, carbs: 60, fat: 12 }, "total"),
      member: memberCtx({ variantAppeal: appeal }),
      adjusters: [],
    });
    expect(r.explain.some((e) => e.includes("top 3"))).toBe(true);
    expect(r.items.some((i) => i.variantId === `${chicken.id}.v3`)).toBe(false);
  });

  it("serves fixed components at their default serving (SPEC-Q-10)", () => {
    const base = dish("pasta_bolognese");
    const parmesan = base.components[2];
    if (parmesan === undefined) throw new Error("dish shape");
    const fixed: DishForSolve = {
      ...base,
      components: [
        nth(base, 0),
        nth(base, 1),
        { ...parmesan, portioning: "fixed", required: true },
      ],
    };
    const r = solvePlate({
      dish: fixed,
      target: slotTarget({ kcal: 560, protein: 35, carbs: 60, fat: 18 }, "total"),
      member: memberCtx(),
      adjusters: [],
    });
    expect(r.items.find((i) => i.componentId === parmesan.id)?.cookedG).toBe(
      parmesan.defaultServingG,
    );
  });

  it("is deterministic", () => {
    const [c] = adjusterCases(1, "total", 21);
    if (c === undefined) throw new Error("no case");
    expect(solvePlate(c)).toEqual(solvePlate(c));
  });

  it("rejects invalid input with typed errors", () => {
    const d = dish("chicken_rice_salad");
    const t = slotTarget({ kcal: 600, protein: 50, carbs: 60, fat: 15 }, "total");
    const badUnit: DishForSolve = {
      ...d,
      components: d.components.map((c, i) =>
        i === 0 ? { ...c, portioning: "unit" as const, unitWeightG: null } : c,
      ),
    };
    expect(() =>
      solvePlate({ dish: badUnit, target: t, member: memberCtx(), adjusters: [] }),
    ).toThrow(SolverError);
    const noGrid: DishForSolve = {
      ...d,
      components: d.components.map((c, i) =>
        i === 0 ? { ...c, minServingG: 81, maxServingG: 84 } : c,
      ),
    };
    expect(() =>
      solvePlate({ dish: noGrid, target: t, member: memberCtx(), adjusters: [] }),
    ).toThrow(/no 5 g grid point/);
    expect(() =>
      solvePlate({ dish: d, target: t, member: memberCtx({ memberId: "other" }), adjusters: [] }),
    ).toThrow(SolverError);
    expect(() =>
      solvePlate({ dish: { ...d, components: [] }, target: t, member: memberCtx(), adjusters: [] }),
    ).toThrow(SolverError);
  });
});
