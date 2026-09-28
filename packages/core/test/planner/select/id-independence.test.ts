// Leaf 1.2.7 G1 (W-17, R-73, PLN-11): the plan does not depend on surrogate ids. The F1 week is
// planned, then planned again with every surrogate id of the input replaced by a fresh
// UUIDv7-shaped id, once in reversed sort order (every id comparison flips) and once in preserved
// order (only the bits change, the salted-prefix case); mapped back, each plan equals the first,
// reasons and flags included. A different seed still changes the plan. The verify script runs
// seeds 1–10 and the negative control on the pre-fix planner.
import { beforeAll, describe, expect, it } from "vitest";
import { planDays, type PlanInput, type PlanResult } from "../../../src/planner/index.js";
import { f1PlanConfig, F1_WEEK } from "./f1.js";
import {
  freshIds,
  mapBack,
  mealsDiffering,
  remapInput,
  seedLibrary,
  stable,
  surrogateIds,
  type IdOrder,
} from "./support.js";

const SEEDS = [1, 2];
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function f1Input(): PlanInput {
  const lib = seedLibrary();
  const config = f1PlanConfig();
  config.planningWeights = { ...config.planningWeights, aiGeneration: "off" };
  return { config, dates: [...F1_WEEK], dishes: lib.dishes, adjusters: lib.adjusters };
}

/** Every string value in `value`, with the name of the field holding it. */
function strings(value: unknown, key = ""): Array<[string, string]> {
  if (typeof value === "string") return [[key, value]];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, key));
  if (value === null || typeof value !== "object" || value instanceof Date) return [];
  return Object.entries(value).flatMap(([k, v]) => strings(v, k));
}

describe("surrogate id remap (G1 harness)", () => {
  const input = f1Input();
  const ids = new Set(surrogateIds(input));

  it("collects every kind of surrogate id: dishes, components, variants, ingredients, adjusters, members, slot types and config rows", () => {
    const cfg = input.config;
    const expected = [
      ...input.dishes.flatMap((d) => [
        d.id,
        ...d.components.flatMap((c) => [
          c.id,
          ...c.variants.flatMap((v) => [v.id, ...v.ingredients.map((i) => i.id)]),
        ]),
      ]),
      ...input.adjusters.flatMap((d) => [
        d.id,
        ...d.components.flatMap((c) => [c.id, ...c.variants.map((v) => v.id)]),
      ]),
      cfg.household.id,
      ...cfg.members.map((m) => m.id),
      ...cfg.slotTypes.map((s) => s.id),
      ...cfg.targetProfiles.map((t) => t.id),
      ...cfg.tolerances.map((t) => t.memberId),
      ...cfg.memberSlotSchedules.flatMap((r) => [r.memberId, r.slotTypeId]),
      ...cfg.mealDistributions.flatMap((r) => [r.memberId, r.slotTypeId]),
      ...cfg.exclusions.map((e) => e.id),
      ...cfg.preferences.map((p) => p.id),
    ];
    for (const id of expected) expect(ids.has(id), id).toBe(true);
    console.log(
      `G1 harness: ${String(ids.size)} surrogate ids (${String(input.dishes.length)} dishes, ${String(input.adjusters.length)} adjusters, ${String(cfg.members.length)} members, ${String(cfg.slotTypes.length)} slot types)`,
    );
  });

  it.each<IdOrder>(["reverse", "preserve"])(
    "%s order: fresh UUIDv7-shaped ids, one per id, and no original id left outside natural keys",
    (order) => {
      const { input: remapped, forward } = remapInput(input, 7, order);
      expect(forward.size).toBe(ids.size);
      expect(new Set(forward.values()).size).toBe(ids.size);
      for (const f of forward.values()) expect(f).toMatch(UUID_V7);
      // Natural keys stay: a test-library dish id equals its slug, so `slug` fields are exempt.
      const left = strings(remapped).filter(([k, v]) => k !== "slug" && ids.has(v));
      expect(left).toEqual([]);
      expect(new Set(surrogateIds(remapped))).toEqual(new Set(forward.values()));
      const sorted = [...ids].sort();
      const fresh = sorted.map((id) => forward.get(id) ?? "");
      const expectedOrder = order === "reverse" ? [...fresh].sort().reverse() : [...fresh].sort();
      expect(fresh).toEqual(expectedOrder);
    },
  );

  it("mapBack restores every id inside strings and object keys", () => {
    const forward = freshIds(["a", "b"], 3);
    const back = new Map([...forward].map(([o, f]) => [f, o]));
    const fa = forward.get("a") ?? "";
    expect(mapBack({ [fa]: [`x ${fa} y`, 1, null] }, back)).toEqual({ a: ["x a y", 1, null] });
  });
});

describe("F1 week plans do not depend on surrogate ids (W-17, PLN-11)", () => {
  const input = f1Input();
  const plans = new Map<number, PlanResult>();
  beforeAll(async () => {
    for (const seed of [...SEEDS, Math.max(...SEEDS) + 1])
      plans.set(seed, await planDays(input, { seed }));
  }, 600_000);

  for (const seed of SEEDS)
    it.each<IdOrder>(["reverse", "preserve"])(
      `seed ${String(seed)}, %s-order remap: mapped back, the same plan (dishes, grams, flags, reasons)`,
      async (order) => {
        const original = plans.get(seed);
        if (original === undefined) throw new Error("no plan");
        const r = remapInput(input, seed, order);
        const back = mapBack(await planDays(r.input, { seed }), r.back);
        expect(mealsDiffering(original, back)).toBe(0);
        expect(stable(back)).toEqual(stable(original));
      },
      300_000,
    );

  it("a different seed changes the plan", () => {
    for (const seed of SEEDS) {
      const a = plans.get(seed);
      const b = plans.get(seed + 1);
      if (a === undefined || b === undefined) throw new Error("no plan");
      expect(mealsDiffering(a, b)).toBeGreaterThan(0);
    }
  });
});
