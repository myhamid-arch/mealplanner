// R-28 / OQ-2 member-day kcal re-targeting (ADR-1 §2, SPEC-Q-2, SPEC-Q-3).
//
// For each targeted member, the day's plates are re-solved in time order. At the member's i-th
// slot, with D = the kcal deviation of the plates before it and Bᵢ = the resolver's kcal bands of
// slots 1…i summed:
//   kcal target = resolver kcal − D,   kcal tolerance = Bᵢ   (P/C/F unchanged, per meal).
// An in-tolerance plate keeps the running deviation within ±Bᵢ, so a member-day whose plates are
// all in tolerance ends within ±Bₙ = ±tolerance.kcal. Locked plates are kept and carry their
// deviation forward. Re-solves keep the variants the meal already serves, so the PLN-9 §6.4 limit
// still holds.
import type { PlateSolution } from "../solver/index.js";
import type { SlotTarget } from "../targets/index.js";
import { MACRO_EPSILON } from "./config.js";
import { flagOf, withinTarget, type Run, type VariantLimits } from "./run.js";
import type { MemberDayTotal, PlannedMeal, PlannedPlate } from "./types.js";

/** The re-targeted slot target for running deviation `d` and cumulative band `band`. */
export function retargeted(base: SlotTarget, d: number, band: number): SlotTarget {
  return { ...base, kcal: base.kcal - d, tol: { ...base.tol, kcal: band } };
}

/** The plate measured against another target: deviation, fit and status recomputed. */
export function rebase(solution: PlateSolution, target: SlotTarget): PlateSolution {
  const n = solution.actual;
  const deviation = {
    kcal: n.kcal - target.kcal,
    protein: n.protein - target.protein,
    carbs: (target.carbBasis === "total" ? n.carbs + n.fibre : n.carbs) - target.carbs,
    fat: n.fat - target.fat,
  };
  const keys = ["kcal", "protein", "carbs", "fat"] as const;
  const fit =
    1 -
    keys.reduce((s, k) => s + (target.tol[k] > 0 ? Math.abs(deviation[k]) / target.tol[k] : 0), 0) /
      keys.length;
  return {
    ...solution,
    status: "in_tolerance",
    deviation,
    fit: Math.min(1, Math.max(0, fit)),
    explain: [...solution.explain, "Kept after kcal re-targeting: within the re-targeted band"],
  };
}

/** Variants a re-solve may use: those the meal already serves, per served component. */
function servedLimits(meal: PlannedMeal): VariantLimits {
  const limits: VariantLimits = {};
  for (const p of meal.plates)
    for (const item of p.solution.items) {
      const list = (limits[item.componentId] ??= []);
      if (!list.includes(item.variantId)) list.push(item.variantId);
    }
  for (const list of Object.values(limits)) list.sort();
  return limits;
}

/** Re-targets one date's meals (returns new meal objects; the input is not changed). */
export function retargetDay(run: Run, meals: readonly PlannedMeal[]): PlannedMeal[] {
  const out = meals.map((m) => ({ ...m, plates: [...m.plates] }));
  const members = new Set(
    out.flatMap((m) => m.plates.filter((p) => p.targeted).map((p) => p.memberId)),
  );
  for (const memberId of members) {
    const slots = out
      .flatMap((meal, mi) =>
        meal.plates.flatMap((plate, pi) =>
          plate.memberId === memberId && plate.resolverTarget !== null
            ? [{ meal, mi, plate, pi }]
            : [],
        ),
      )
      .sort((a, b) => {
        const ta = run.timeKeyOf(a.meal.slotTypeId);
        const tb = run.timeKeyOf(b.meal.slotTypeId);
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
    let d = 0;
    let band = 0;
    for (const { meal, mi, plate, pi } of slots) {
      const base = plate.resolverTarget as SlotTarget;
      band += base.tol.kcal;
      if (meal.locked) {
        d += plate.solution.actual.kcal - base.kcal;
        continue;
      }
      const target = retargeted(base, d, band);
      if (d === 0 && band === base.tol.kcal) {
        // Same target as the day search solved against: the plate is already optimal for it.
        const mealOut = out[mi];
        if (mealOut !== undefined) mealOut.plates[pi] = { ...plate, target };
        d += plate.solution.actual.kcal - base.kcal;
        continue;
      }
      const dish = run.pool.dish(meal.dishId);
      const slot = run.cfg.slotTypes.find((s) => s.id === meal.slotTypeId);
      if (dish === undefined || slot === undefined) {
        d += plate.solution.actual.kcal - base.kcal;
        continue;
      }
      const fresh = run.solve(dish, memberId, slot, target, servedLimits(meal));
      let solution = fresh;
      if (fresh.status !== "in_tolerance" && withinTarget(plate.solution, target))
        solution = rebase(plate.solution, target);
      const next: PlannedPlate = {
        ...plate,
        target,
        solution,
        fitStatus: solution.status,
        flag: flagOf(solution),
      };
      const mealOut = out[mi];
      if (mealOut !== undefined) mealOut.plates[pi] = next;
      d += solution.actual.kcal - base.kcal;
    }
  }
  return out;
}

/** R-28: every targeted member's day total against ±tolerance.kcal (SPEC-Q-2). */
export function memberDayTotals(
  run: Run,
  date: string,
  meals: readonly PlannedMeal[],
): MemberDayTotal[] {
  const out: MemberDayTotal[] = [];
  for (const member of run.household.members.filter((m) => m.isTargeted)) {
    const targets = run.targetsOf(date, member.id);
    if (targets.length === 0) continue;
    const plates = meals.flatMap((meal) =>
      meal.plates.filter((p) => p.memberId === member.id).map((plate) => ({ meal, plate })),
    );
    const kcalTarget = targets.reduce((s, t) => s + t.kcal, 0);
    const band = targets.reduce((s, t) => s + t.tol.kcal, 0);
    const kcalActual = plates.reduce((s, x) => s + x.plate.solution.actual.kcal, 0);
    const flaggedSlots = targets
      .filter((t) => {
        const x = plates.find((p) => p.meal.slotTypeId === t.slotTypeId);
        return x === undefined || x.plate.fitStatus !== "in_tolerance";
      })
      .map((t) => t.slotKey);
    out.push({
      memberId: member.id,
      date,
      kcalTarget,
      kcalActual,
      band,
      within: Math.abs(kcalActual - kcalTarget) <= band + MACRO_EPSILON,
      flaggedSlots,
    });
  }
  return out;
}
