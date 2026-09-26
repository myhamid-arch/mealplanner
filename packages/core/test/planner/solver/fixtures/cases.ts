// Generated solver cases for ledger G2 and G3, deterministic for a seed.
//
// Feasible: a random on-grid plate of a test dish is the witness; its nutrients plus noise inside
// ±0.6·tol (then rounded to whole units) are the target, so a feasible plate is known to exist.
// Infeasible: one macro of such a target is moved outside the dish's reachable interval by more
// than its tolerance (or the sat-fat cap below the dish's minimum), an analytic certificate.
// Adjuster: the witness is the dish at its maximum for one macro plus one or two eligible adjusters
// that push that macro beyond the dish's reach + tolerance.
import { plateNutrients, type Nutrients } from "../../../../src/nutrition/index.js";
import type {
  ComponentForSolve,
  DishForSolve,
  MemberCtx,
  VariantForSolve,
} from "../../../../src/planner/solver/index.js";
import type { CarbBasis, SlotTarget } from "../../../../src/planner/targets/index.js";
import { testDishes } from "./build.js";

export type MacroKey = "kcal" | "protein" | "carbs" | "fat";
export const MACRO_KEYS: readonly MacroKey[] = ["kcal", "protein", "carbs", "fat"];
export const DEFAULT_TOL: Record<MacroKey, number> = { kcal: 50, protein: 5, carbs: 5, fat: 2 };

/** mulberry32: a small deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, xs: readonly T[]): T => {
  const x = xs[Math.floor(rand() * xs.length)];
  if (x === undefined) throw new Error("pick from an empty list");
  return x;
};

export function memberCtx(overrides: Partial<MemberCtx> = {}): MemberCtx {
  return {
    memberId: "member",
    appetite: "medium",
    roleBias: {},
    variantAppeal: {},
    dishAppeal: {},
    exclusions: { ingredientIds: [], categories: [], dietaryFlags: [] },
    slot: { key: "dinner", isPacked: false, reheatAvailable: false },
    ...overrides,
  };
}

export function macroOf(n: Nutrients, m: MacroKey, basis: CarbBasis): number {
  if (m === "carbs") return basis === "total" ? n.carbs + n.fibre : n.carbs;
  return n[m];
}

export function slotTarget(
  values: Record<MacroKey, number>,
  basis: CarbBasis,
  extra: Partial<SlotTarget> = {},
): SlotTarget {
  return {
    memberId: "member",
    date: "2026-09-28",
    slotKey: "dinner",
    slotTypeId: "slot:dinner",
    dayKind: "default",
    kcal: values.kcal,
    protein: values.protein,
    carbs: values.carbs,
    fat: values.fat,
    tol: { ...DEFAULT_TOL },
    mode: "strict",
    carbBasis: basis,
    ...extra,
  };
}

/** Grid of a component: grams = unit · k, k in [kMin, kMax]; 0 allowed when optional. */
export function gridOf(c: ComponentForSolve): { unit: number; kMin: number; kMax: number } {
  if (c.portioning === "fixed") return { unit: c.defaultServingG, kMin: 1, kMax: 1 };
  const unit = c.portioning === "unit" ? (c.unitWeightG ?? c.stepG) : c.stepG;
  return {
    unit,
    kMin: Math.max(0, Math.ceil(c.minServingG / unit - 1e-9)),
    kMax: Math.floor(c.maxServingG / unit + 1e-9),
  };
}

export type Witness = {
  items: Array<{ componentId: string; variantId: string; cookedG: number; per100g: Nutrients }>;
  adjusters: Array<{ dishId: string; variantId: string; cookedG: number; per100g: Nutrients }>;
};

export function witnessNutrients(w: Witness): Nutrients {
  return plateNutrients([...w.items, ...w.adjusters].filter((x) => x.cookedG > 0));
}

export type SolverCase = {
  id: string;
  dish: DishForSolve;
  target: SlotTarget;
  member: MemberCtx;
  adjusters: DishForSolve[];
  witness?: Witness;
};

function randomPlate(rand: () => number, dish: DishForSolve): Witness {
  const items: Witness["items"] = [];
  for (const c of dish.components) {
    const variant = pick(rand, c.variants);
    const { unit, kMin, kMax } = gridOf(c);
    const zero = !c.required && rand() < 0.25;
    const k = zero ? 0 : kMin + Math.floor(rand() * (kMax - kMin + 1));
    items.push({
      componentId: c.id,
      variantId: variant.id,
      cookedG: k * unit,
      per100g: variant.per100g,
    });
  }
  return { items, adjusters: [] };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** G2 feasible cases, round-robin over the test dishes. */
export function feasibleCases(n: number, basis: CarbBasis, seed: number): SolverCase[] {
  const rand = prng(seed);
  const { dishes } = testDishes();
  const cases: SolverCase[] = [];
  for (let i = 0; i < n; i++) {
    const dish = dishes[i % dishes.length];
    if (dish === undefined) throw new Error("no test dishes");
    const witness = randomPlate(rand, dish);
    const actual = witnessNutrients(witness);
    const values = {} as Record<MacroKey, number>;
    for (const m of MACRO_KEYS)
      values[m] = Math.max(
        0,
        Math.round(macroOf(actual, m, basis) + (rand() * 1.2 - 0.6) * DEFAULT_TOL[m]),
      );
    const target = slotTarget(values, basis);
    if (i % 2 === 0) target.satFatMax = round1(actual.satFat + 0.5 + rand());
    cases.push({
      id: `feasible-${basis}-${String(i)}`,
      dish,
      target,
      member: memberCtx(),
      adjusters: [],
      witness,
    });
  }
  return cases;
}

/** Per-gram macro of a variant. */
const perGram = (v: VariantForSolve, m: MacroKey, basis: CarbBasis) =>
  macroOf(v.per100g, m, basis) / 100;

/** The interval a dish can reach for one macro: required minimums to all maximums. */
export function reach(
  dish: DishForSolve,
  m: MacroKey,
  basis: CarbBasis,
  allowed: (v: VariantForSolve) => boolean = () => true,
): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const c of dish.components) {
    const vs = c.variants.filter(allowed);
    if (vs.length === 0) continue;
    const { unit, kMin, kMax } = gridOf(c);
    const per = vs.map((v) => perGram(v, m, basis));
    max += kMax * unit * Math.max(...per);
    if (c.required) min += kMin * unit * Math.min(...per);
  }
  return { min, max };
}

/** Minimum sat fat of any plate of the dish (required components at their minimum). */
export function minSatFat(dish: DishForSolve): number {
  let min = 0;
  for (const c of dish.components) {
    if (!c.required) continue;
    const { unit, kMin } = gridOf(c);
    min += (kMin * unit * Math.min(...c.variants.map((v) => v.per100g.satFat))) / 100;
  }
  return min;
}

export type InfeasibleKind = MacroKey | "satFat";

/** G2 infeasible cases, each with its certificate kind. */
export function infeasibleCases(
  n: number,
  basis: CarbBasis,
  seed: number,
): Array<SolverCase & { kind: InfeasibleKind; direction: "above" | "below" }> {
  const rand = prng(seed);
  const { dishes } = testDishes();
  const kinds: InfeasibleKind[] = ["protein", "carbs", "fat", "kcal", "satFat"];
  const out: Array<SolverCase & { kind: InfeasibleKind; direction: "above" | "below" }> = [];
  for (let i = 0; out.length < n; i++) {
    if (i > n * 20) throw new Error("could not generate enough infeasible cases");
    const dish = dishes[i % dishes.length];
    if (dish === undefined) throw new Error("no test dishes");
    const witness = randomPlate(rand, dish);
    const actual = witnessNutrients(witness);
    const kind = kinds[out.length % kinds.length] ?? "protein";
    const values = {} as Record<MacroKey, number>;
    for (const m of MACRO_KEYS) values[m] = Math.round(macroOf(actual, m, basis));
    const target = slotTarget(values, basis);
    let direction: "above" | "below" = "above";
    if (kind === "satFat") {
      const min = minSatFat(dish);
      if (min < 1) continue;
      target.satFatMax = round1(min * 0.5);
    } else {
      const r = reach(dish, kind, basis);
      const below = Math.floor(r.min - DEFAULT_TOL[kind] - 1 - rand() * 5);
      if (out.length % 2 === 1 && below >= 0) {
        direction = "below";
        target[kind] = below;
      } else {
        target[kind] = Math.ceil(r.max + DEFAULT_TOL[kind] + 1 + rand() * 20);
      }
    }
    out.push({
      id: `infeasible-${basis}-${String(out.length)}`,
      dish,
      target,
      member: memberCtx(),
      adjusters: [],
      kind,
      direction,
    });
  }
  return out;
}

/** Adjusters rich in each macro (by the macro they are used to raise). */
const RICH_IN: Record<MacroKey, readonly string[]> = {
  protein: [
    "adjuster.greek_yogurt_0",
    "adjuster.egg_whites",
    "adjuster.cottage_cheese",
    "adjuster.labneh",
    "adjuster.grilled_chicken_side",
  ],
  carbs: ["adjuster.apple", "adjuster.banana", "adjuster.dates", "adjuster.rice_cakes"],
  fat: ["adjuster.olive_oil"],
  kcal: ["adjuster.olive_oil", "adjuster.dates", "adjuster.banana"],
};

/**
 * Member contexts that make some adjusters ineligible (PLN-6): a dairy allergy, low appeal,
 * a packed slot without reheat, and ingredient and category exclusions.
 */
export const G3_MEMBERS: readonly MemberCtx[] = [
  memberCtx({
    exclusions: { ingredientIds: [], categories: [], dietaryFlags: ["contains_dairy"] },
  }),
  memberCtx({
    dishAppeal: {
      "adjuster.greek_yogurt_0": -0.5,
      "adjuster.dates": -0.3,
      "adjuster.olive_oil": -0.25,
    },
  }),
  memberCtx({ slot: { key: "packed_school_lunch", isPacked: true, reheatAvailable: false } }),
  memberCtx({
    exclusions: { ingredientIds: ["egg-white"], categories: ["fruit"], dietaryFlags: [] },
  }),
];

function allowedFor(member: MemberCtx) {
  const { ingredientIds, categories, dietaryFlags } = member.exclusions;
  return (v: VariantForSolve) =>
    v.ingredients.every(
      (i) =>
        !ingredientIds.includes(i.id) &&
        !categories.includes(i.category) &&
        !i.dietaryFlags.some((f) => dietaryFlags.includes(f)),
    );
}

/** Adjusters eligible for a member (the generator's own rule, used to build witnesses). */
export function eligibleAdjusterIds(
  adjusters: readonly DishForSolve[],
  member: MemberCtx,
): string[] {
  const allowed = allowedFor(member);
  return adjusters
    .filter(
      (a) =>
        a.components.length === 1 &&
        (member.dishAppeal[a.id] ?? 0) >= -0.2 &&
        (!member.slot.isPacked || a.isPackable) &&
        (!member.slot.isPacked || member.slot.reheatAvailable || a.servedColdOk) &&
        (a.components[0]?.variants.some(allowed) ?? false),
    )
    .map((a) => a.id);
}

/** G3 cases: infeasible for the dish alone (certificate), feasible with ≤ 2 eligible adjusters. */
export function adjusterCases(
  n: number,
  basis: CarbBasis,
  seed: number,
): Array<SolverCase & { macro: MacroKey }> {
  const rand = prng(seed);
  const { dishes, adjusters } = testDishes();
  const macros: MacroKey[] = ["protein", "carbs", "fat", "kcal"];
  const out: Array<SolverCase & { macro: MacroKey }> = [];
  for (let i = 0; out.length < n; i++) {
    if (i > n * 50) throw new Error("could not generate enough adjuster cases");
    const member = G3_MEMBERS[i % G3_MEMBERS.length] ?? memberCtx();
    const macro = macros[Math.floor(i / G3_MEMBERS.length) % macros.length] ?? "protein";
    const dish = pick(rand, dishes);
    const allowed = allowedFor(member);
    // The dish at its maximum for the macro, in allowed variants.
    const items: Witness["items"] = [];
    let blocked = false;
    for (const c of dish.components) {
      const vs = c.variants.filter(allowed);
      if (vs.length === 0) {
        if (c.required) blocked = true;
        continue;
      }
      const best = vs.reduce((a, b) =>
        perGram(b, macro, basis) > perGram(a, macro, basis) ? b : a,
      );
      const { unit, kMax } = gridOf(c);
      items.push({
        componentId: c.id,
        variantId: best.id,
        cookedG: kMax * unit,
        per100g: best.per100g,
      });
    }
    if (blocked) continue;
    const eligible = eligibleAdjusterIds(adjusters, member);
    const rich = RICH_IN[macro].filter((id) => eligible.includes(id));
    if (rich.length === 0) continue;
    const count = i % 3 === 0 && rich.length > 1 ? 2 : 1;
    const chosen = [...rich].sort(() => rand() - 0.5).slice(0, count);
    const adjusterItems: Witness["adjusters"] = [];
    for (const id of chosen) {
      const a = adjusters.find((x) => x.id === id);
      const c = a?.components[0];
      if (a === undefined || c === undefined) continue;
      const variant = c.variants.find(allowed);
      if (variant === undefined) continue;
      const { unit, kMin, kMax } = gridOf(c);
      const k = Math.max(1, kMin) + Math.floor(rand() * (kMax - Math.max(1, kMin) + 1));
      adjusterItems.push({
        dishId: a.id,
        variantId: variant.id,
        cookedG: k * unit,
        per100g: variant.per100g,
      });
    }
    const witness: Witness = { items, adjusters: adjusterItems };
    const actual = witnessNutrients(witness);
    const values = {} as Record<MacroKey, number>;
    for (const m of MACRO_KEYS)
      values[m] = Math.max(
        0,
        Math.round(macroOf(actual, m, basis) + (rand() * 0.8 - 0.4) * DEFAULT_TOL[m]),
      );
    const r = reach(dish, macro, basis, allowed);
    if (!(values[macro] > r.max + DEFAULT_TOL[macro] + 0.5)) continue;
    const target = slotTarget(values, basis, { slotKey: member.slot.key });
    target.satFatMax = round1(actual.satFat + 1);
    out.push({
      id: `adjuster-${basis}-${String(out.length)}`,
      dish,
      target,
      member,
      adjusters,
      witness,
      macro,
    });
  }
  return out;
}
