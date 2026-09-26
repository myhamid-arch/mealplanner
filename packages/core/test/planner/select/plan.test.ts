// PLN-8, PLN-9 §6.4, PLN-11, PLN-12: plan search on F1 and on small pools.
import { describe, expect, it } from "vitest";
import {
  planDays,
  type PlanDish,
  type PlanGenerationRequest,
  type PlanProgress,
} from "../../../src/planner/index.js";
import { variantToMerge } from "../../../src/planner/select/run.js";
import { f1PlanConfig } from "./f1.js";
import { MONDAY, TUESDAY, planF1, platesOf, seedLibrary, stable } from "./support.js";

describe("planDays on F1", () => {
  it("is deterministic for a seed; every targeted plate is in tolerance or flagged with a reason", async () => {
    const events: PlanProgress["type"][] = [];
    const lib = seedLibrary();
    const run = (seed: number) =>
      planDays(
        {
          config: f1PlanConfig(),
          dates: [MONDAY, TUESDAY],
          dishes: lib.dishes,
          adjusters: lib.adjusters,
        },
        { seed, onProgress: (e) => events.push(e.type) },
      );
    const a = await run(7);
    const b = await run(7);
    expect(stable(a)).toEqual(stable(b));
    expect(events).toContain("day_started");
    expect(events).toContain("retargeting");
    expect(events.at(-1)).toBe("done");
    for (const { meal, plate } of platesOf(a)) {
      if (!plate.targeted) {
        expect(plate.fitStatus).toBe("untargeted");
        continue;
      }
      if (plate.fitStatus === "in_tolerance") expect(plate.flag).toBeNull();
      else {
        expect(plate.flag).toBeTruthy();
        expect(
          a.flags.some(
            (f) =>
              f.date === meal.date && f.slotKey === meal.slotKey && f.memberId === plate.memberId,
          ),
        ).toBe(true);
      }
    }
    // Every attendee of every meal has a plate; every dish used is in the result.
    for (const d of a.days)
      for (const m of d.meals) {
        expect(m.plates.map((p) => p.memberId)).toEqual(m.attendees);
        expect(a.dishes[m.dishId]).toBeDefined();
        expect(m.scoreBreakdown.total).toBeGreaterThan(0);
      }
  }, 120_000);

  it("never serves the same dish to a member twice within the minimum gap", async () => {
    const plan = await planF1([MONDAY, TUESDAY]);
    const seen = new Map<string, string>();
    for (const { meal, plate } of platesOf(plan)) {
      const key = `${plate.memberId}|${meal.dishId}`;
      expect(seen.has(key), `${key} twice`).toBe(false);
      seen.set(key, meal.date);
    }
  }, 120_000);
});

describe("PLN-9 §6.4 variant limit", () => {
  it("merges the least-appealing variant into the nearest one", () => {
    const d = seedLibrary().dishes.find((x) => x.components.some((c) => c.variants.length >= 2));
    if (d === undefined) throw new Error("no multi-variant dish");
    const c = d.components.find((x) => x.variants.length >= 2);
    const [v1, v2] = c?.variants ?? [];
    if (c === undefined || v1 === undefined || v2 === undefined) throw new Error("fixture");
    const plate = (memberId: string, variantId: string) => ({
      memberId,
      targeted: false,
      fitStatus: "untargeted" as const,
      target: null,
      resolverTarget: null,
      flag: null,
      solution: {
        status: "untargeted" as const,
        items: [{ componentId: c.id, variantId, cookedG: 100 }],
        adjusters: [],
        actual: v1.per100g,
        deviation: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
        shortfall: { fibre: 0, solubleFibre: 0 },
        objective: 0,
        fit: 1,
        explain: [],
      },
    });
    const plates = [plate("a", v1.id), plate("b", v2.id)];
    const appeal = (_m: string, v: string) => (v === v1.id ? 0.5 : -0.5);
    expect(variantToMerge(d, plates, 2, appeal)).toBeNull();
    expect(variantToMerge(d, plates, 1, appeal)).toMatchObject({
      componentId: c.id,
      dropped: v2.id,
      into: v1.id,
    });
  });

  it("with max_variants_per_component_per_meal = 1, no meal serves two variants of a component", async () => {
    const cfg = f1PlanConfig();
    cfg.planningWeights = { ...cfg.planningWeights, maxVariantsPerComponent: 1 };
    const plan = await planF1([MONDAY], { config: cfg });
    for (const d of plan.days)
      for (const m of d.meals) {
        const per = new Map<string, Set<string>>();
        for (const p of m.plates)
          for (const i of p.solution.items)
            per.set(i.componentId, (per.get(i.componentId) ?? new Set()).add(i.variantId));
        for (const [, vs] of per) expect(vs.size).toBe(1);
      }
  }, 120_000);
});

describe("PLN-12 generation trigger", () => {
  const lib = seedLibrary();
  const dinner = lib.dishes.filter((d) => d.slotKeys.includes("dinner"));
  const cfg = (mode: "auto" | "ask" | "off") => {
    const c = f1PlanConfig();
    c.planningWeights = { ...c.planningWeights, aiGeneration: mode };
    // Only dinner, for the adults, so the test stays small.
    c.slotTypes = c.slotTypes.map((s) => ({ ...s, active: s.key === "dinner" }));
    c.members = c.members.filter((m) => m.id.startsWith("adult"));
    return c;
  };
  const small = dinner.slice(0, 2);
  const extra = dinner.slice(2, 8);

  it("auto: requests dishes when fewer than 4 candidates survive, and plans with them", async () => {
    const requests: PlanGenerationRequest[] = [];
    const generated: PlanDish[] = extra.map((d) => ({
      ...d,
      id: `ai-${d.id}`,
      name: `New ${d.name}`,
    }));
    const plan = await planDays(
      { config: cfg("auto"), dates: [MONDAY], dishes: small, adjusters: lib.adjusters },
      {
        seed: 1,
        requestDishes: (r) => {
          requests.push(r);
          return Promise.resolve(generated);
        },
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ date: MONDAY, slotKey: "dinner", count: 3 });
    expect(requests[0]?.reason).toMatch(/candidate/);
    expect(plan.generationRequests).toEqual([]);
    const meal = plan.days[0]?.meals[0];
    expect(meal).toBeDefined();
  }, 120_000);

  it("ask: returns the request instead of calling the generator; off: neither", async () => {
    let called = 0;
    const requestDishes = () => {
      called++;
      return Promise.resolve([]);
    };
    const ask = await planDays(
      { config: cfg("ask"), dates: [MONDAY], dishes: small, adjusters: lib.adjusters },
      { seed: 1, requestDishes },
    );
    expect(called).toBe(0);
    expect(ask.generationRequests.map((r) => r.slotKey)).toEqual(["dinner"]);
    const off = await planDays(
      { config: cfg("off"), dates: [MONDAY], dishes: small, adjusters: lib.adjusters },
      { seed: 1, requestDishes },
    );
    expect(called).toBe(0);
    expect(off.generationRequests).toEqual([]);
    expect(off.days[0]?.meals).toHaveLength(1);
  }, 120_000);

  it("an empty pool flags the meal instead of inventing one", async () => {
    const plan = await planDays(
      { config: cfg("off"), dates: [MONDAY], dishes: [], adjusters: lib.adjusters },
      { seed: 1 },
    );
    expect(plan.days[0]?.meals).toEqual([]);
    expect(plan.flags.map((f) => f.kind)).toContain("no_candidate");
    expect(plan.memberDays.every((m) => m.flaggedSlots.includes("dinner"))).toBe(true);
  }, 60_000);
});

describe("locked meals (PLN-13)", () => {
  it("keeps a locked meal unchanged and plans around it", async () => {
    const first = await planF1([MONDAY]);
    const dinner = first.days[0]?.meals.find((m) => m.slotKey === "dinner");
    if (dinner === undefined) throw new Error("no dinner");
    const lockedMeal = { ...dinner, locked: true };
    const lib = seedLibrary();
    const again = await planDays(
      {
        config: f1PlanConfig(),
        dates: [MONDAY],
        dishes: lib.dishes,
        adjusters: lib.adjusters,
        locked: [lockedMeal],
      },
      { seed: 99 },
    );
    const kept = again.days[0]?.meals.find((m) => m.slotKey === "dinner");
    expect(kept?.locked).toBe(true);
    expect(kept?.dishId).toBe(dinner.dishId);
    expect(kept?.plates).toEqual(lockedMeal.plates);
  }, 120_000);
});
