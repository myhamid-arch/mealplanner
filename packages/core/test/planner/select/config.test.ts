// Planning settings: weight presets (SPEC-Q-13), the household adjuster list (PLN-6, SPEC-Q-7) and
// the frequency fallback when no dish is left (SPEC-Q-15).
import { describe, expect, it } from "vitest";
import { planDays } from "../../../src/planner/index.js";
import { weightsFor } from "../../../src/planner/select/weights.js";
import type { HouseholdConfig, WeightPresetRow } from "../../../src/types/index.js";
import { f1PlanConfig } from "./f1.js";
import { MONDAY, TUESDAY, platesOf, seedLibrary } from "./support.js";

const preset = (
  name: string,
  values: WeightPresetRow["values"],
  days: number[] | null,
): WeightPresetRow => ({
  id: `preset-${name}`,
  householdId: "household-test",
  name,
  values,
  appliesToWeekdays: days,
});

describe("weightsFor (SPEC-Q-13)", () => {
  it("uses planning_weights when no preset matches the weekday", () => {
    const cfg = f1PlanConfig();
    cfg.weightPresets = [preset("Weekend", { appeal: 1 }, [5, 6])];
    const w = weightsFor(cfg, MONDAY);
    expect(w).toMatchObject({ appeal: 0.6, ingredientEconomy: 0.4, presetName: null });
  });
  it("overrides the named weights with the first matching preset by name", () => {
    const cfg = f1PlanConfig();
    cfg.weightPresets = [
      preset("Zeta", { appeal: 0.1 }, [0]),
      preset("Busy week", { appeal: 1, ingredientEconomy: 0 }, [0, 1]),
      preset("Unscheduled", { appeal: 0.2 }, null),
    ];
    const w = weightsFor(cfg, MONDAY);
    expect(w).toMatchObject({
      appeal: 1,
      ingredientEconomy: 0,
      macroPrecision: 1,
      presetName: "Busy week",
    });
  });
});

/** F1 with only the given active slots and members. */
function narrow(slots: string[], members: string[]): HouseholdConfig {
  const cfg = f1PlanConfig();
  cfg.slotTypes = cfg.slotTypes.map((s) => ({ ...s, active: slots.includes(s.key) }));
  cfg.members = cfg.members.filter((m) => members.includes(m.id));
  return cfg;
}

describe("household adjuster list (PLN-6, SPEC-Q-7)", () => {
  const lib = seedLibrary();
  const adjusterIds = (plan: Awaited<ReturnType<typeof planDays>>) =>
    new Set(platesOf(plan).flatMap(({ plate }) => plate.solution.adjusters.map((a) => a.dishId)));

  it("never serves an adjuster the household disabled, nor any when adjusters are off", async () => {
    const plan = (config: HouseholdConfig) =>
      planDays(
        { config, dates: [MONDAY], dishes: lib.dishes, adjusters: lib.adjusters },
        { seed: 1 },
      );
    const used = adjusterIds(await plan(f1PlanConfig()));
    expect(used.size).toBeGreaterThan(0);
    const disabled = f1PlanConfig();
    disabled.adjusters = [...used].map((dishId) => ({
      householdId: "household-test",
      dishId,
      enabled: false,
    }));
    for (const id of adjusterIds(await plan(disabled))) expect(used.has(id)).toBe(false);
    const off = f1PlanConfig();
    off.planningWeights = { ...off.planningWeights, adjustersEnabled: false };
    expect(adjusterIds(await plan(off)).size).toBe(0);
  }, 120_000);
});

describe("frequency fallback (SPEC-Q-15)", () => {
  it("relaxes only frequency when it blocks every suitable dish, and flags the meal", async () => {
    const lib = seedLibrary();
    const snack = lib.dishes.filter((d) => d.slotKeys.includes("snack")).slice(0, 1);
    const plan = await planDays(
      {
        config: narrow(["snack"], ["c1"]),
        dates: [MONDAY, TUESDAY],
        dishes: snack,
        adjusters: lib.adjusters,
      },
      { seed: 1 },
    );
    const [mon, tue] = plan.days.map((d) => d.meals[0]);
    expect(mon?.frequencyRelaxed).toBeNull();
    expect(tue?.dishId).toBe(mon?.dishId);
    expect(tue?.frequencyRelaxed).toMatch(/Frequency relaxed/);
    expect(plan.flags.filter((f) => f.kind === "frequency_relaxed").map((f) => f.date)).toEqual([
      TUESDAY,
    ]);
  }, 60_000);

  it("never relaxes an exclusion: an excluded-only pool leaves the meal empty and flagged", async () => {
    const lib = seedLibrary();
    const sesame = lib.dishes.filter((d) =>
      d.components.some(
        (c) =>
          c.required &&
          c.variants.every((v) =>
            v.ingredients.some((i) => i.dietaryFlags.includes("contains_sesame")),
          ),
      ),
    );
    expect(sesame.length).toBeGreaterThan(0);
    const cfg = narrow(["breakfast", "lunch", "dinner", "snack", "packed_school_lunch"], ["c3"]);
    const plan = await planDays(
      { config: cfg, dates: [MONDAY], dishes: sesame, adjusters: lib.adjusters },
      { seed: 1 },
    );
    expect(plan.days[0]?.meals).toEqual([]);
    expect(plan.flags.every((f) => f.kind === "no_candidate")).toBe(true);
    expect(plan.flags.length).toBeGreaterThan(0);
  }, 60_000);
});
